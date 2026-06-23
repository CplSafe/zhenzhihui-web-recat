/*
  ProjectManagementView — 项目管理(2.1 新版)
  - 壳:与首页一致的 AppSidebar + AppTopbar(不再用旧 2.0 CreativeSidebar)。
  - 我的项目:渐变彩色文件夹,首格「创建项目」弹窗填名。点文件夹进入项目详情。
  - 待归类:智能成片 / 爆款复制保存的视频(后端暂无该概念,先占位假数据);可拖入上方项目。
  - 项目详情:① 最终视频(含历史,可播放/下载) ② 分镜(每个分镜图 + 用到的元素)。
*/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import '@/styles/creative.css'
import '@/styles/project-management.css'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import AppToast from '@/components/AppToast'
import {
  createCreativeProject,
  deleteCreativeProject,
  getAssetDownloadUrl,
  getBusinessErrorMessage,
  getCreativeProject,
  listCreativeProjects,
} from '@/api/business'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { useWorkspaceId } from '@/stores/workspaceSession'

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

// ---- 纯函数工具 ----
function toPlainObject(value: any): any {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return null
}

function normalizeArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function normalizeCreativeProjectDraft(payload: any): any {
  const candidates = [
    payload?.draft_json,
    payload?.draftJson,
    payload?.draft,
    payload?.data?.draft_json,
    payload?.data?.draft,
  ]
  for (const item of candidates) {
    const parsed = toPlainObject(item)
    if (parsed) return parsed
  }
  return null
}

function imgOf(value: any): { url: string; assetId: number } {
  if (typeof value === 'string') return { url: value.trim(), assetId: 0 }
  if (!value || typeof value !== 'object') return { url: '', assetId: 0 }
  const url = String(
    value.src ||
      value.url ||
      value.image ||
      value.imageUrl ||
      value.image_url ||
      value.thumbnailUrl ||
      value.thumbnail_url ||
      '',
  ).trim()
  return { url, assetId: Number(value.assetId || value.asset_id || 0) || 0 }
}

function getProjectTimestamp(project: any, keys: string[]): number {
  const raw = keys.map((key) => project?.[key]).find((value) => typeof value === 'string' && value.trim())
  const timestamp = Date.parse(raw || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

const TONES = ['a', 'b', 'c', 'd', 'e', 'f']
const toneOf = (i: number) => TONES[i % TONES.length]

// 待归类:后端暂无「未归类视频」概念,先用占位假数据(UI 先行,接口好了再换真数据)
const PLACEHOLDER_UNCLASSIFIED = [
  { id: 'ph-1', title: '禧悦造型宣传片' },
  { id: 'ph-2', title: '李山山茶事品牌故事' },
  { id: 'ph-3', title: '禧悦造型幕后花絮' },
  { id: 'ph-4', title: '李山山茶事产品展示' },
  { id: 'ph-5', title: '禧悦造型发布会V1' },
]

interface DetailVideo {
  url: string
  assetId: number
  label: string
}

// 占位状态:后端暂无「发布状态」字段,先按下标给出确定性占位(多数已发布、少量草稿),接口就绪后替换
function placeStatus(i: number): 'published' | 'draft' {
  return i % 4 === 1 ? 'draft' : 'published'
}

function fmtDur(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function fmtDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 分页页码(超过 7 页时折叠中间为省略号)
function buildPageList(cur: number, count: number): (number | '...')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const out: (number | '...')[] = [1]
  const start = Math.max(2, cur - 1)
  const end = Math.min(count - 1, cur + 1)
  if (start > 2) out.push('...')
  for (let i = start; i <= end; i++) out.push(i)
  if (end < count - 1) out.push('...')
  out.push(count)
  return out
}

// 从项目草稿解析「视频列表」(smart.videoVersions 优先,降级 videoHistoryList / generatedVideo*)
function parseProjectVideos(draft: any): { videos: DetailVideo[]; flow: string } {
  const flow = String(draft?.flow || draft?.smart?.flow || '')
  const smart = draft?.smart && typeof draft.smart === 'object' ? draft.smart : null
  let videos: DetailVideo[] = []
  const vv = normalizeArray(smart?.videoVersions)
  const vh = normalizeArray(draft?.videoHistoryList || draft?.video_history_list)
  const src = vv.length ? vv : vh
  videos = src
    .map((v: any, i: number) => {
      const img = imgOf(v)
      return { url: img.url, assetId: img.assetId, label: `版本 ${src.length - i}` }
    })
    .filter((v) => v.url || v.assetId)
  if (!videos.length) {
    const url = String(draft?.generatedVideoUrl || draft?.generated_video_url || smart?.fullVideoUrl || '')
    const assetId = Number(draft?.generatedVideoAssetId || smart?.fullVideoAssetId || 0) || 0
    if (url || assetId) videos = [{ url, assetId, label: '当前成片' }]
  }
  // 最新的放最前
  videos.reverse()
  return { videos, flow }
}

// 从草稿里取若干「预览图」(优先用户上传的入口素材 → 元素图 → 分镜图),供项目文件夹拼图预览
function extractPreviewCandidates(draft: any): { url: string; assetId: number }[] {
  const smart = draft?.smart && typeof draft.smart === 'object' ? draft.smart : draft
  const out: { url: string; assetId: number }[] = []
  // ① 入口上传的素材(用户上传)
  const em = smart?.entryMeta || {}
  const imgs = normalizeArray(em.images)
  const aids = normalizeArray(em.imageAssetIds || em.imageAssetIDs)
  imgs.forEach((u: any, i: number) => {
    const url = String(u || '').trim()
    if (url) out.push({ url, assetId: Number(aids[i] || 0) || 0 })
  })
  // ② 元素(素材主体)
  normalizeArray(smart?.shots).forEach((s: any) =>
    normalizeArray(s.subjects).forEach((su: any) => {
      const im = imgOf(su.image ? { url: su.image, assetId: su.assetId } : su)
      if (im.url || im.assetId) out.push(im)
    }),
  )
  // ③ 分镜图(兜底)
  normalizeArray(smart?.shots).forEach((s: any) => {
    const im = imgOf(s.image ? { url: s.image, assetId: s.imageAssetId } : s)
    if (im.url || im.assetId) out.push(im)
  })
  // 去重(按 assetId 优先,否则按 url)
  const seen = new Set<string>()
  const uniq: { url: string; assetId: number }[] = []
  for (const c of out) {
    const key = c.assetId ? `a${c.assetId}` : `u${c.url}`
    if (seen.has(key)) continue
    seen.add(key)
    uniq.push(c)
    if (uniq.length >= 4) break
  }
  return uniq
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  )
}
function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M3 11v1.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V11M5 7l3 3 3-3M8 2.5V10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
function FolderGlyph() {
  return (
    <svg className="pm2-folder-glyph" viewBox="0 0 100 76" aria-hidden="true">
      <path
        d="M10 22c0-4 3-7 7-7h18l7 7h34c4 0 7 3 7 7v33c0 4-3 7-7 7H17c-4 0-7-3-7-7V22z"
        fill="rgba(255,255,255,0.92)"
      />
      <rect x="10" y="30" width="80" height="36" rx="6" fill="rgba(255,255,255,0.55)" />
    </svg>
  )
}

// 项目封面:有预览图则拼图展示(最多 4 张),图片失效/缺失时回退为渐变文件夹图标
function FolderThumb({ urls }: { urls: string[] }) {
  const [broken, setBroken] = useState(false)
  const list = urls.slice(0, 4)
  if (!list.length || broken) return <FolderGlyph />
  return (
    <span className="pm2-folder-collage" data-n={list.length}>
      {list.map((u, i) => (
        <img key={i} src={u} alt="" loading="lazy" onError={() => setBroken(true)} />
      ))}
    </span>
  )
}

export default function ProjectManagementView() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const workspaceId = useWorkspaceId()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [projectItems, setProjectItems] = useState<any[]>([])
  const [openMenuId, setOpenMenuId] = useState(0)
  const [deletingProjectId, setDeletingProjectId] = useState(0)
  const [dragOverFolderId, setDragOverFolderId] = useState(0)

  // 创建项目弹窗
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  // 项目详情
  const [viewMode, setViewMode] = useState<'root' | 'detail'>('root')
  const [activeProject, setActiveProject] = useState<{ id: number; title: string; updatedAt: number } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailVideos, setDetailVideos] = useState<DetailVideo[]>([])
  const [detailFlow, setDetailFlow] = useState('')
  const [durations, setDurations] = useState<Record<number, string>>({})
  const [bigVideo, setBigVideo] = useState<{ url: string; title: string } | null>(null)
  // 筛选 / 排序 / 分页
  const [sortBy, setSortBy] = useState<'recent' | 'oldest'>('recent')
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const workspaceIdRef = useRef(0)
  useEffect(() => {
    workspaceIdRef.current = Number(workspaceId || 0)
  }, [workspaceId])

  const folders = useMemo(() => {
    return projectItems
      .map((project) => {
        // 预览图只用「列表已返回」的内容(封面字段 / 内联草稿),不为此发额外请求,保证列表快
        const coverFields = [
          project?.cover_url,
          project?.coverUrl,
          project?.thumbnail_url,
          project?.thumbnailUrl,
          project?.cover,
        ]
          .map((v) => String(v || '').trim())
          .filter(Boolean)
        const draftInline = normalizeCreativeProjectDraft(project)
        const draftUrls = draftInline
          ? extractPreviewCandidates(draftInline)
              .map((c) => c.url)
              .filter(Boolean)
          : []
        const preview = (coverFields.length ? coverFields : draftUrls).slice(0, 4)
        return {
          id: Number(project?.id || 0),
          title: String(project?.title || project?.name || '').trim() || '未命名项目',
          updatedAt: getProjectTimestamp(project, [
            'updated_at',
            'updatedAt',
            'last_saved_at',
            'created_at',
            'createdAt',
          ]),
          preview,
        }
      })
      .filter((p) => p.id > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [projectItems])

  const handleNavigate = useCallback(
    (key: string) => {
      const path = ROUTE_MAP[key]
      if (path) navigate(path)
      else showToast('功能待开放', 'info')
    },
    [navigate, showToast],
  )

  const loadProjects = useCallback(async () => {
    const wsId = Number(workspaceIdRef.current || 0)
    if (!wsId) {
      setProjectItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // 只拉「项目列表」这一项核心数据(单次请求);素材/分镜/视频等点进项目再拉
      const items = await listCreativeProjects({ workspaceId: wsId, limit: 60 })
      if (Number(workspaceIdRef.current || 0) !== wsId) return
      setProjectItems(Array.isArray(items) ? items : [])
    } catch {
      if (Number(workspaceIdRef.current || 0) === wsId) {
        setProjectItems([])
        showToast('项目列表加载失败,请稍后重试', 'error')
      }
    } finally {
      if (Number(workspaceIdRef.current || 0) === wsId) setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    setViewMode('root')
    setActiveProject(null)
    loadProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (openMenuId && !target.closest('.pm2-folder-more')) setOpenMenuId(0)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [openMenuId])

  const submitCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name) {
      showToast('请输入项目名称', 'info')
      return
    }
    const wsId = Number(workspaceId || 0)
    if (!wsId) {
      showToast('workspace_id 缺失,无法创建', 'error')
      return
    }
    setCreating(true)
    try {
      await createCreativeProject({ workspace_id: wsId, title: name })
      showToast('项目已创建', 'success')
      setCreateOpen(false)
      setNewName('')
      await loadProjects()
    } catch (error) {
      showToast(getBusinessErrorMessage(error, '创建失败,请稍后重试'), 'error')
    } finally {
      setCreating(false)
    }
  }, [newName, workspaceId, showToast, loadProjects])

  // 进入项目详情:取草稿 → 解析分镜/元素/视频 → 按 assetId 刷新过期签名URL
  const openFolder = useCallback(
    async (folder: { id: number; title: string; updatedAt?: number }) => {
      const wsId = Number(workspaceId || 0)
      if (!folder.id || !wsId) {
        showToast('workspace_id 缺失,无法打开项目', 'error')
        return
      }
      setActiveProject({ id: folder.id, title: folder.title, updatedAt: Number(folder.updatedAt || 0) })
      setViewMode('detail')
      setDetailLoading(true)
      setDetailVideos([])
      setDetailFlow('')
      setDurations({})
      setPage(1)
      setStatusFilter('all')
      setSortBy('recent')
      try {
        const project = await getCreativeProject({ projectId: folder.id, workspaceId: wsId })
        if (Number(workspaceIdRef.current || 0) !== wsId) return
        const draft = normalizeCreativeProjectDraft(project || {})
        const { videos, flow } = parseProjectVideos(draft || {})
        // 收集视频 assetId,刷新过期签名 URL
        const ids = new Set<number>()
        videos.forEach((v) => v.assetId && ids.add(v.assetId))
        const map = new Map<number, string>()
        await Promise.all(
          [...ids].map(async (id) => {
            const u = await getAssetDownloadUrl({ workspaceId: wsId, assetId: id }).catch(() => '')
            if (u) map.set(id, u)
          }),
        )
        if (Number(workspaceIdRef.current || 0) !== wsId) return
        const fix = (url: string, assetId: number) => (assetId && map.get(assetId)) || url
        setDetailVideos(videos.map((v) => ({ ...v, url: fix(v.url, v.assetId) })))
        setDetailFlow(flow)
      } catch (error) {
        showToast(getBusinessErrorMessage(error, '项目内容加载失败,请稍后重试'), 'error')
      } finally {
        if (Number(workspaceIdRef.current || 0) === wsId) setDetailLoading(false)
      }
    },
    [workspaceId, showToast],
  )

  const backToRoot = useCallback(() => {
    setViewMode('root')
    setActiveProject(null)
  }, [])

  const createVideo = useCallback(() => {
    navigate(detailFlow === 'creative' ? '/creative/blank' : '/smart')
  }, [detailFlow, navigate])

  const downloadFromUrl = useCallback(
    async (url: string, title: string) => {
      if (!url) {
        showToast('没有可下载的视频', 'error')
        return
      }
      const date = new Date()
      const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
      const safeName =
        String(title || '视频')
          .replace(/[\\/:*?"<>|]/g, '')
          .trim() || '视频'
      const fileName = `${safeName}_${dateStr}.mp4`

      // ① 「另存为」对话框必须在用户手势内先弹出(放在 fetch 之前,避免手势失效)
      let fileHandle: any = null
      if ((window as any).showSaveFilePicker) {
        try {
          fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }],
          })
        } catch (err: any) {
          if (err?.name === 'AbortError') return // 用户取消
        }
      }

      // ② 取视频数据(资源域名允许 CORS,与上传 ensureAssetId 同样 fetch)
      let blob: Blob | null = null
      try {
        showToast('视频下载中…', 'success')
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        blob = new Blob([await response.blob()], { type: 'video/mp4' })
      } catch {
        // 取不到(CORS/网络)→ 新标签打开兜底,用户可右键另存
        window.open(url, '_blank', 'noopener')
        showToast('无法直接下载,已在新标签打开,可右键另存', 'info')
        return
      }

      // ③ 写入:优先 showSaveFilePicker,否则 a[download](blob: 同源,download 一定生效)
      if (fileHandle) {
        try {
          const writable = await fileHandle.createWritable()
          await writable.write(blob)
          await writable.close()
          showToast('视频已保存', 'success')
          return
        } catch (err: any) {
          if (err?.name === 'AbortError') return
        }
      }
      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objUrl
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(objUrl), 4000)
      showToast('视频已开始下载', 'success')
    },
    [showToast],
  )

  const deleteProject = useCallback(
    async (folder: { id: number; title: string }) => {
      if (deletingProjectId) return
      setOpenMenuId(0)
      const confirmed = await requestConfirm(
        `确定删除项目「${folder.title}」吗?项目内所有版本和草稿将一并删除,不可恢复。`,
      )
      if (!confirmed) return
      const wsId = Number(workspaceId || 0)
      if (!wsId) {
        showToast('workspace_id 缺失,无法删除', 'error')
        return
      }
      setDeletingProjectId(folder.id)
      try {
        await deleteCreativeProject({ projectId: folder.id, workspaceId: wsId })
        setProjectItems((prev) => prev.filter((item) => Number(item?.id || 0) !== folder.id))
        showToast('项目已删除', 'success')
      } catch (error) {
        showToast(getBusinessErrorMessage(error, '删除失败,请稍后重试'), 'error')
      } finally {
        setDeletingProjectId(0)
      }
    },
    [deletingProjectId, requestConfirm, workspaceId, showToast],
  )

  const handleDropToFolder = useCallback(
    (folder: { id: number; title: string }, payload: string) => {
      setDragOverFolderId(0)
      let video: any = null
      try {
        video = JSON.parse(payload)
      } catch {
        video = null
      }
      if (!video?.title) return
      showToast(`「${video.title}」已移动到「${folder.title}」(归类接口待接入)`, 'success')
    },
    [showToast],
  )

  const viewVideos = useMemo(() => {
    let arr = detailVideos.map((v, i) => ({ ...v, _i: i }))
    if (statusFilter !== 'all') arr = arr.filter((v) => placeStatus(v._i) === statusFilter)
    if (sortBy === 'oldest') arr = [...arr].reverse()
    return arr
  }, [detailVideos, statusFilter, sortBy])

  const pageCount = Math.max(1, Math.ceil(viewVideos.length / pageSize))
  const pageVideos = viewVideos.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  return (
    <div className="pm2-page">
      <AppSidebar
        activeKey="projects"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="pm2-shell">
        <AppTopbar onMenu={() => setSidebarOpen(true)} onMember={() => showToast('会员中心待开放', 'info')} />
        <AppToast />

        <section className="pm2-main" aria-label="项目管理">
          {viewMode === 'root' ? (
            <>
              {/* 我的项目 */}
              <section className="pm2-section">
                <h2 className="pm2-section-title">我的项目</h2>
                <div className="pm2-folder-grid">
                  <button type="button" className="pm2-folder pm2-folder--create" onClick={() => setCreateOpen(true)}>
                    <span className="pm2-folder-icon pm2-folder-icon--create">
                      <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
                        <path
                          d="M24 14v20M14 24h20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <span className="pm2-folder-name">创建项目</span>
                  </button>

                  {loading && !folders.length ? (
                    <div className="pm2-hint">正在加载项目…</div>
                  ) : (
                    folders.map((folder, i) => (
                      <div
                        key={folder.id}
                        className={`pm2-folder${dragOverFolderId === folder.id ? ' is-dropover' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => openFolder(folder)}
                        onKeyDown={(e) => e.key === 'Enter' && openFolder(folder)}
                        onDragOver={(e) => {
                          e.preventDefault()
                          if (dragOverFolderId !== folder.id) setDragOverFolderId(folder.id)
                        }}
                        onDragLeave={() => dragOverFolderId === folder.id && setDragOverFolderId(0)}
                        onDrop={(e) => {
                          e.preventDefault()
                          handleDropToFolder(folder, e.dataTransfer.getData('text/plain'))
                        }}
                      >
                        <span className={`pm2-folder-icon pm2-tone-${toneOf(i)}`}>
                          <FolderThumb urls={folder.preview} />
                          <button
                            type="button"
                            className="pm2-folder-more"
                            aria-label="更多操作"
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenMenuId((prev) => (prev === folder.id ? 0 : folder.id))
                            }}
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true" width="18" height="18">
                              <circle cx="4" cy="10" r="1.4" fill="currentColor" />
                              <circle cx="10" cy="10" r="1.4" fill="currentColor" />
                              <circle cx="16" cy="10" r="1.4" fill="currentColor" />
                            </svg>
                            {openMenuId === folder.id && (
                              <div className="pm2-folder-menu" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  className="pm2-folder-menu-item is-danger"
                                  disabled={deletingProjectId === folder.id}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    deleteProject(folder)
                                  }}
                                >
                                  {deletingProjectId === folder.id ? '删除中…' : '删除项目'}
                                </button>
                              </div>
                            )}
                          </button>
                        </span>
                        <span className="pm2-folder-name" title={folder.title}>
                          {folder.title}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* 待归类(占位假数据,可拖入上方项目) */}
              <section className="pm2-section">
                <h2 className="pm2-section-title">待归类</h2>
                <div className="pm2-video-grid">
                  {PLACEHOLDER_UNCLASSIFIED.map((video, i) => (
                    <div
                      key={video.id}
                      className="pm2-vid"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify(video))}
                    >
                      <span
                        className={`pm2-vid-thumb pm2-tone-${toneOf(i)}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => showToast('占位视频,接口接入后可播放', 'info')}
                      >
                        <span className="pm2-vid-play">
                          <PlayIcon />
                        </span>
                      </span>
                      <span className="pm2-vid-title" title={video.title}>
                        {video.title}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            /* 项目详情:项目内视频网格(对齐 Figma 432:4334) */
            <>
              <div className="pm2-vl-head">
                <button type="button" className="pm2-crumb" onClick={() => navigate('/home')}>
                  首页
                </button>
                <span className="pm2-crumb-sep">/</span>
                <button type="button" className="pm2-crumb" onClick={backToRoot}>
                  项目管理
                </button>
                <span className="pm2-crumb-sep">/</span>
                <span className="pm2-crumb-cur">
                  {activeProject?.title || '项目'}({detailVideos.length}个视频)
                </span>
              </div>

              <div className="pm2-vl-toolbar">
                <div className="pm2-vl-filters">
                  <label className="pm2-select">
                    排序
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'recent' | 'oldest')}>
                      <option value="recent">修改时间</option>
                      <option value="oldest">最早创建</option>
                    </select>
                  </label>
                  <label className="pm2-select">
                    状态
                    <select
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(e.target.value as 'all' | 'published' | 'draft')
                        setPage(1)
                      }}
                    >
                      <option value="all">全部</option>
                      <option value="published">已发布</option>
                      <option value="draft">草稿</option>
                    </select>
                  </label>
                  <label className="pm2-select">
                    时长
                    <select defaultValue="all">
                      <option value="all">全部</option>
                    </select>
                  </label>
                </div>
                <button type="button" className="pm2-vl-new" onClick={createVideo}>
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <path
                      d="M10 4v12M4 10h12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  新建视频
                </button>
              </div>

              {detailLoading ? (
                <div className="pm2-hint">正在加载项目内容…</div>
              ) : pageVideos.length ? (
                <>
                  <div className="pm2-vl-grid">
                    {pageVideos.map((v) => {
                      const i = v._i
                      const published = placeStatus(i) === 'published'
                      return (
                        <div className="pm2-vcard" key={i}>
                          <div
                            className="pm2-vcard-thumb"
                            role="button"
                            tabIndex={0}
                            onClick={() =>
                              v.url &&
                              setBigVideo({ url: v.url, title: `${activeProject?.title || '视频'}-${v.label}` })
                            }
                          >
                            {v.url ? (
                              <video
                                src={v.url}
                                muted
                                preload="metadata"
                                onLoadedMetadata={(e) => {
                                  const d = e.currentTarget.duration
                                  if (Number.isFinite(d) && d > 0)
                                    setDurations((prev) => (prev[i] ? prev : { ...prev, [i]: fmtDur(d) }))
                                }}
                              />
                            ) : null}
                            {published && (
                              <span className="pm2-vcard-flag">
                                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                                  <path
                                    d="M3 8.5 6.5 12 13 4.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </span>
                            )}
                            <span className="pm2-vcard-play">
                              <PlayIcon />
                            </span>
                            {durations[i] && <span className="pm2-vcard-dur">{durations[i]}</span>}
                          </div>
                          <div className="pm2-vcard-body">
                            <div className="pm2-vcard-titlerow">
                              <span className="pm2-vcard-title" title={activeProject?.title}>
                                {activeProject?.title || '未命名视频'}
                              </span>
                              <span className={`pm2-status ${published ? 'is-published' : 'is-draft'}`}>
                                {published ? '已发布' : '草稿'}
                              </span>
                            </div>
                            <div className="pm2-vcard-meta">
                              <span className="pm2-vcard-no">{`#${String(i + 1).padStart(4, '0')}`}</span>
                              <span className="pm2-vcard-author">
                                <span className="pm2-vcard-avatar">我</span>我
                              </span>
                              <span className="pm2-vcard-date">{fmtDate(activeProject?.updatedAt || 0)}</span>
                              <button
                                type="button"
                                className="pm2-vcard-dl"
                                aria-label="下载视频"
                                title="下载视频"
                                disabled={!v.url}
                                onClick={() => downloadFromUrl(v.url, `${activeProject?.title || '视频'}-${v.label}`)}
                              >
                                <DownloadIcon />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="pm2-vl-pager">
                    <button
                      type="button"
                      className="pm2-page-btn"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      ‹
                    </button>
                    {buildPageList(page, pageCount).map((p, idx) =>
                      p === '...' ? (
                        <span key={`e${idx}`} className="pm2-page-ellipsis">
                          …
                        </span>
                      ) : (
                        <button
                          type="button"
                          key={p}
                          className={`pm2-page-btn${p === page ? ' is-active' : ''}`}
                          onClick={() => setPage(p)}
                        >
                          {p}
                        </button>
                      ),
                    )}
                    <button
                      type="button"
                      className="pm2-page-btn"
                      disabled={page >= pageCount}
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    >
                      ›
                    </button>
                    <label className="pm2-select pm2-page-size">
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value))
                          setPage(1)
                        }}
                      >
                        <option value={20}>20 条/页</option>
                        <option value={50}>50 条/页</option>
                        <option value={100}>100 条/页</option>
                      </select>
                    </label>
                  </div>
                </>
              ) : (
                <div className="pm2-hint">这个项目还没有生成视频。</div>
              )}
            </>
          )}
        </section>
      </div>

      {/* 创建项目弹窗(基础版,后续由设计稿细化) */}
      {createOpen &&
        createPortal(
          <div
            className="pm2-modal-mask"
            onClick={(e) => {
              if (e.target === e.currentTarget && !creating) setCreateOpen(false)
            }}
          >
            <div className="pm2-modal" role="dialog" aria-label="创建项目">
              <div className="pm2-modal-head">
                <span>创建项目</span>
                <button
                  type="button"
                  className="pm2-modal-close"
                  aria-label="关闭"
                  disabled={creating}
                  onClick={() => setCreateOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="pm2-modal-body">
                <label className="pm2-modal-label">项目名称</label>
                <input
                  className="pm2-modal-input"
                  value={newName}
                  autoFocus
                  maxLength={40}
                  placeholder="给项目起个名字…"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
                />
              </div>
              <div className="pm2-modal-foot">
                <button
                  type="button"
                  className="pm2-modal-btn"
                  disabled={creating}
                  onClick={() => setCreateOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="pm2-modal-btn pm2-modal-btn--primary"
                  disabled={creating}
                  onClick={submitCreate}
                >
                  {creating ? '创建中…' : '创建'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 视频播放灯箱 */}
      {bigVideo &&
        createPortal(
          <div className="pm2-videobox" onClick={() => setBigVideo(null)} role="dialog" aria-label="视频播放">
            <video src={bigVideo.url} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
            <button type="button" className="pm2-videobox-close" aria-label="关闭" onClick={() => setBigVideo(null)}>
              ×
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
