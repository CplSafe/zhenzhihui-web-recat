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
import { Pagination } from 'antd'
import '@/styles/creative.css'
import '@/styles/project-management.css'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import AppToast from '@/components/AppToast'
import AiBadge from '@/components/common/AiBadge'
import {
  createCreativeProject,
  deleteCreativeProject,
  getAssetDownloadUrl,
  getBusinessErrorMessage,
  getCreativeProject,
  listCreativeProjects,
} from '@/api/business'
import { listProjectVideos, addClassifiedVideo, type ProjectVideo } from '@/api/projectVideos'
import { loadClassifiedKeys, markVideoClassified, videoKeyOf } from '@/utils/unclassifiedVideos'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { openComingSoon } from '@/stores/ui'
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

const toneOf = (_i: number) => 'a' as const

// 鉴权直传地址:cookie 鉴权、非预签名,永不过期。替换草稿里会过期(X-Amz-Expires=900)的 S3 URL。
function assetStreamUrl(assetId: number, workspaceId: number): string {
  return `/api/v1/assets/${Math.floor(assetId)}/download?workspace_id=${Math.floor(workspaceId)}`
}

// 项目封面:封面字段 → 入口素材 → 分镜图,取第一张(assetId 优先转直传地址,避免过期)
function extractCover(project: any, wsId: number): string {
  const coverAid = Number(project?.cover_asset_id || project?.coverAssetId || 0) || 0
  if (coverAid && wsId) return assetStreamUrl(coverAid, wsId)
  const draft = normalizeCreativeProjectDraft(project)
  if (draft) {
    const smart = toPlainObject(draft.smart) || draft
    for (const u of normalizeArray(smart?.entryMeta?.images)) {
      const s = String(u || '').trim()
      if (s) return s
    }
    for (const sh of normalizeArray(smart?.shots)) {
      const im = imgOf(sh.image ? { url: sh.image, assetId: sh.imageAssetId } : sh)
      if (im.assetId && wsId) return assetStreamUrl(im.assetId, wsId)
      if (im.url) return im.url
    }
  }
  for (const v of [project?.cover_url, project?.coverUrl, project?.thumbnail_url, project?.thumbnailUrl]) {
    const u = String(v || '').trim()
    if (u) return u
  }
  return ''
}

// 相对更新时间:「X分钟前更新」
function relativeUpdated(ts: number): string {
  if (!ts) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return '刚刚更新'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}分钟前更新`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前更新`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}天前更新`
  const mo = Math.floor(d / 30)
  return mo < 12 ? `${mo}个月前更新` : `${Math.floor(mo / 12)}年前更新`
}

// 从项目列表中提取「待归类」=【草稿状态】项目:有在制内容(分镜/入口素材)但【还没有成片视频】。
// 已生成成片视频的项目视为已完成,不进待归类;封面用图片(extractCover),不用视频。
function extractUnclassified(projectItems: any[], workspaceId: number): { id: number; title: string; cover: string }[] {
  const out: { id: number; title: string; cover: string }[] = []
  const hasUrl = (list: any[]) => normalizeArray(list).some((v: any) => String(v?.url || v?.src || '').trim())
  for (const project of projectItems) {
    const draft = normalizeCreativeProjectDraft(project)
    if (!draft) continue
    const smart = toPlainObject(draft.smart) || draft
    // 已有成片视频(版本/历史/最终)→ 已完成,不算待归类草稿
    const hasFinalVideo =
      hasUrl(smart?.videoVersions) ||
      hasUrl(draft?.videoHistoryList || draft?.video_history_list) ||
      !!String(draft?.generatedVideoUrl || draft?.generated_video_url || smart?.fullVideoUrl || '').trim()
    if (hasFinalVideo) continue
    // 草稿:有在制内容(分镜 / 旧版分镜 / 入口素材)才展示
    const hasWork =
      normalizeArray(smart?.shots).length > 0 ||
      normalizeArray(draft?.storyboardItems || draft?.storyboard_items).length > 0 ||
      normalizeArray(smart?.entryMeta?.images).length > 0
    if (!hasWork) continue
    out.push({
      id: Number(project?.id || 0),
      title: String(project?.title || project?.name || '').trim() || '未命名项目',
      cover: extractCover(project, workspaceId),
    })
  }
  return out
}

interface DetailElement {
  tag: string
  kind: string
  url: string
  assetId: number
}
interface DetailShot {
  id: string | number
  no: string
  duration: string
  url: string
  assetId: number
  elements: DetailElement[]
}
interface DetailVideo {
  url: string
  assetId: number
  label: string
}

// 从项目草稿解析「分镜 + 元素 + 视频历史」(优先 smart 原生块,降级 storyboardItems)
function parseProjectDetail(draft: any): { shots: DetailShot[]; videos: DetailVideo[]; flow: string } {
  const flow = String(draft?.flow || draft?.smart?.flow || '')
  const smart = draft?.smart && typeof draft.smart === 'object' ? draft.smart : null

  // 分镜
  let shots: DetailShot[] = []
  const smartShots = normalizeArray(smart?.shots)
  if (smartShots.length) {
    shots = smartShots.map((s: any, i: number) => {
      const cur = imgOf(s.image ? { url: s.image, assetId: s.imageAssetId } : s)
      return {
        id: s.id ?? i,
        no: String(s.no || `镜头${i + 1}`),
        duration: String(s.duration || ''),
        url: cur.url,
        assetId: cur.assetId,
        elements: normalizeArray(s.subjects).map((su: any) => {
          const img = imgOf(su.image ? { url: su.image, assetId: su.assetId } : su)
          return {
            tag:
              String(su.tag || '')
                .replace(/^@/, '')
                .trim() || '元素',
            kind: String(su.kind || ''),
            url: img.url,
            assetId: img.assetId,
          }
        }),
      }
    })
  } else {
    shots = normalizeArray(draft?.storyboardItems || draft?.storyboard_items).map((s: any, i: number) => {
      const cur = imgOf(s.currentImage || s.current_image || s)
      return { id: s.id ?? i, no: `镜头${i + 1}`, duration: '', url: cur.url, assetId: cur.assetId, elements: [] }
    })
  }

  // 视频历史:smart.videoVersions 优先,降级 videoHistoryList / generatedVideo*
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
  return { shots, videos, flow }
}

// 修进度条 bug:部分 MP4 初始 duration=Infinity(moov 在文件尾),进度条会从中间窜到结尾。
// 跳到极大时间强制浏览器算出真实时长,再跳回 0。
function fixVideoDuration(e: React.SyntheticEvent<HTMLVideoElement>) {
  const v = e.currentTarget
  if (!Number.isFinite(v.duration)) {
    const back = () => {
      v.currentTime = 0
      v.removeEventListener('timeupdate', back)
    }
    v.addEventListener('timeupdate', back)
    v.currentTime = 1e7
  }
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

  // 我的项目分页:只展示两行,其余分页。列数随容器宽度变化,运行时实测。
  const gridRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(4)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('') // 搜索项目名称/团队
  const [typeFilter, setTypeFilter] = useState<'all' | '个人项目' | '协作项目'>('all')
  const [sortDesc, setSortDesc] = useState(true) // 时间降序/升序
  // 待归类分页(两行一页,列数随宽度实测)
  const vidGridRef = useRef<HTMLDivElement>(null)
  const [vidCols, setVidCols] = useState(5)
  const [vidPage, setVidPage] = useState(1)

  // 创建项目弹窗
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  // 项目详情
  const [viewMode, setViewMode] = useState<'root' | 'detail'>('root')
  const [activeProject, setActiveProject] = useState<{ id: number; title: string } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailShots, setDetailShots] = useState<DetailShot[]>([])
  const [detailVideos, setDetailVideos] = useState<DetailVideo[]>([])
  const [detailFlow, setDetailFlow] = useState('')
  const [activeVideoIdx, setActiveVideoIdx] = useState(0)
  const [bigImg, setBigImg] = useState('')

  const workspaceIdRef = useRef(0)
  useEffect(() => {
    workspaceIdRef.current = Number(workspaceId || 0)
  }, [workspaceId])

  const folders = useMemo(() => {
    const wsId = Number(workspaceId || 0)
    return projectItems
      .map((project) => {
        // 成员数/项目数:后端列表暂未稳定提供,按可用字段取,缺省给 1 / 草稿作品数
        const members = Number(project?.member_count || project?.members?.length || 1) || 1
        const draft = normalizeCreativeProjectDraft(project)
        const smart = draft ? toPlainObject(draft.smart) || draft : null
        const worksCount =
          normalizeArray(smart?.videoVersions).length ||
          normalizeArray(draft?.videoHistoryList || draft?.video_history_list).length ||
          normalizeArray(smart?.shots).length ||
          0
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
          cover: extractCover(project, wsId),
          members,
          type: members > 1 ? '协作项目' : '个人项目',
          works: worksCount,
        }
      })
      .filter((p) => p.id > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [projectItems, workspaceId])

  // 实测网格列数(auto-fill 解析后的轨道数),用于「两行」分页
  useEffect(() => {
    if (viewMode !== 'root') return
    const el = gridRef.current
    if (!el) return
    const measure = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length
      setCols(Math.max(1, tracks))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [viewMode])

  // 搜索 + 类型过滤 + 时间排序
  const shownFolders = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = folders.filter(
      (f) => (typeFilter === 'all' || f.type === typeFilter) && (!q || f.title.toLowerCase().includes(q)),
    )
    return sortDesc ? list : [...list].reverse()
  }, [folders, query, typeFilter, sortDesc])

  // 每页 = 两行(新建项目移到顶栏,卡片网格不再占首格)
  const pageSize = Math.max(1, cols * 2)
  const totalPages = Math.max(1, Math.ceil(shownFolders.length / pageSize))
  const pagedFolders = useMemo(
    () => shownFolders.slice((page - 1) * pageSize, page * pageSize),
    [shownFolders, page, pageSize],
  )

  // 列数变化 / 项目减少导致当前页越界时,夹回最后一页
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])
  // 搜索 / 过滤 / 排序变化时回到第一页
  useEffect(() => {
    setPage(1)
  }, [query, typeFilter, sortDesc])

  // 已归类(拖入项目)的视频 → 从待归类隐藏。纯前端 localStorage 占位。
  const [classifiedKeys, setClassifiedKeys] = useState<Set<string>>(new Set())
  useEffect(() => {
    setClassifiedKeys(loadClassifiedKeys(Number(workspaceId || 0)))
  }, [workspaceId])

  const unclassified = useMemo(
    () =>
      extractUnclassified(projectItems, Number(workspaceId || 0)).filter(
        (v) => !classifiedKeys.has(videoKeyOf(v.id, v.cover)),
      ),
    [projectItems, classifiedKeys, workspaceId],
  )

  // 待归类里的草稿本身就是各自的项目(同 id),打开项目卡即可在其下看到草稿(buildDerivedVideos 派生占位)。
  // 因此项目加载后自动把每个待归类草稿归类到它对应的项目 → 待归类恒为空,草稿仍在其项目下可续作。
  // 只标记「已归类」隐藏即可,不写入本地视频清单(否则会与派生的草稿占位重复)。
  useEffect(() => {
    const wsId = Number(workspaceId || 0)
    if (!wsId) return
    const raw = extractUnclassified(projectItems, wsId)
    if (!raw.length) return
    const next = loadClassifiedKeys(wsId)
    let changed = false
    for (const v of raw) {
      const key = videoKeyOf(v.id, v.cover)
      if (!next.has(key)) {
        markVideoClassified(wsId, key)
        next.add(key)
        changed = true
      }
    }
    if (changed) setClassifiedKeys(new Set(next))
  }, [projectItems, workspaceId])

  // 待归类:实测视频网格列数(grid 仅在有数据时渲染,故依赖 unclassified.length 重新挂载观察)
  useEffect(() => {
    if (viewMode !== 'root' || !unclassified.length) return
    const el = vidGridRef.current
    if (!el) return
    const measure = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length
      setVidCols(Math.max(1, tracks))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [viewMode, unclassified.length])

  // 待归类每页 = 两行
  const vidPageSize = Math.max(1, vidCols * 2)
  const vidTotalPages = Math.max(1, Math.ceil(unclassified.length / vidPageSize))
  const pagedUnclassified = useMemo(
    () => unclassified.slice((vidPage - 1) * vidPageSize, vidPage * vidPageSize),
    [unclassified, vidPage, vidPageSize],
  )
  useEffect(() => {
    if (vidPage > vidTotalPages) setVidPage(vidTotalPages)
  }, [vidPage, vidTotalPages])

  const handleNavigate = useCallback(
    (key: string) => {
      const path = ROUTE_MAP[key]
      if (path) navigate(path)
      else openComingSoon() // 未上线项:弹全局「功能待开放」弹窗
    },
    [navigate],
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
      const items = await listCreativeProjects({ workspaceId: wsId, limit: 60 })
      if (Number(workspaceIdRef.current || 0) !== wsId) return
      const merged = Array.isArray(items) ? [...items] : []
      try {
        const key = `zzh_created_${wsId}`
        const cached = JSON.parse(localStorage.getItem(key) || '[]')
        if (Array.isArray(cached)) {
          const ids = new Set(merged.map((p: any) => Number(p?.id || 0)))
          for (const cp of cached) {
            if (!ids.has(Number(cp?.id || 0))) {
              merged.unshift(cp)
              ids.add(Number(cp?.id || 0))
            }
          }
        }
      } catch {
        /* ignore */
      }
      setProjectItems(merged)
    } catch (err: any) {
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
    setPage(1)
    setVidPage(1)
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
      const created = await createCreativeProject({ workspace_id: wsId, title: name })
      showToast('项目已创建', 'success')
      setCreateOpen(false)
      setNewName('')
      // 立即塞入本地列表头部 + 写 localStorage，刷新不丢
      setProjectItems((prev) => [created, ...prev])
      try {
        const key = `zzh_created_${wsId}`
        const cached = JSON.parse(localStorage.getItem(key) || '[]')
        cached.unshift({
          id: created.id,
          title: name,
          created_at: created.created_at,
          updated_at: created.updated_at,
          workspace_id: created.workspace_id,
        })
        localStorage.setItem(key, JSON.stringify(cached.slice(0, 30)))
      } catch {
        /* ignore */
      }
    } catch (error: any) {
      showToast(getBusinessErrorMessage(error, '创建失败,请稍后重试'), 'error')
    } finally {
      setCreating(false)
    }
  }, [newName, workspaceId, showToast])

  // 项目管理主入口改为进入「项目下视频列表」
  const openFolder = useCallback(
    async (folder: { id: number; title: string }) => {
      const wsId = Number(workspaceId || 0)
      if (!folder.id || !wsId) {
        showToast('workspace_id 缺失,无法打开项目', 'error')
        return
      }
      navigate(`/projects/${folder.id}/videos`)
    },
    [workspaceId, showToast, navigate],
  )

  const backToRoot = useCallback(() => {
    setViewMode('root')
    setActiveProject(null)
  }, [])

  const openProjectEditor = useCallback(() => {
    if (!activeProject?.id) return
    const wsId = Number(workspaceId || 0)
    const qs = wsId ? `?workspace_id=${wsId}` : ''
    // 按流程分流:爆款复制 → /hot-copy/:id;其余 → /smart/:id
    const base = String(detailFlow || '').toLowerCase() === 'hot-copy' ? '/hot-copy' : '/smart'
    navigate(`${base}/${activeProject.id}${qs}`)
  }, [activeProject, detailFlow, workspaceId, navigate])

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
      if (!video?.id) return
      const wsId = Number(workspaceId || 0)
      if (!wsId || !folder.id) {
        showToast('workspace_id 缺失,无法归类', 'error')
        return
      }
      // ① 写入目标项目的本地清单(占位草稿,带封面图),使其出现在该项目里
      addClassifiedVideo({
        projectId: folder.id,
        workspaceId: wsId,
        title: video.title,
        videoUrl: video.cover || '',
      })
      // ② 标记已归类 → 从待归类隐藏
      const key = videoKeyOf(Number(video.id || 0), video.cover || '')
      markVideoClassified(wsId, key)
      setClassifiedKeys((prev) => new Set(prev).add(key))
      showToast(`已归类到「${folder.title}」`, 'success')
    },
    [workspaceId, showToast],
  )

  const activeVideo = detailVideos[activeVideoIdx] || null

  return (
    <div
      className="pm2-page"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', overflow: 'hidden' }}
    >
      <AppSidebar
        activeKey="projects"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div
        className="pm2-shell"
        style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <AppTopbar onMenu={() => setSidebarOpen(true)} />

        <section
          className="pm2-main"
          aria-label="项目管理"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '28px 36px 56px' }}
        >
          {viewMode === 'root' ? (
            <>
              {/* 项目管理:头部(标题/副标题 + 搜索 + 新建)*/}
              <div className="pm2-head">
                <div className="pm2-head-titles">
                  <h1 className="pm2-head-title">项目管理</h1>
                  <p className="pm2-head-sub">管理个人项目与团队协作项目</p>
                </div>
                <div className="pm2-head-actions">
                  <div className="pm2-search">
                    <input
                      className="pm2-search-input"
                      value={query}
                      placeholder="搜索项目名称、团队"
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
                      <path
                        d="m20 20-3.5-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                  <button type="button" className="pm2-new-btn" onClick={() => setCreateOpen(true)}>
                    ＋ 新建项目
                  </button>
                </div>
              </div>

              {/* 筛选条:类型 / 状态(占位) / 排序 */}
              <div className="pm2-filters">
                <span className="pm2-filter">
                  项目类型:
                  <select
                    className="pm2-filter-select"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
                  >
                    <option value="all">全部类型</option>
                    <option value="个人项目">个人项目</option>
                    <option value="协作项目">协作项目</option>
                  </select>
                </span>
                <span className="pm2-filter">
                  项目状态:
                  <select className="pm2-filter-select" disabled>
                    <option>全部状态</option>
                  </select>
                </span>
                <button
                  type="button"
                  className="pm2-sort"
                  onClick={() => setSortDesc((v) => !v)}
                  title="按更新时间排序"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <path
                      d="M4 3v10M4 13l-2-2M4 13l2-2M9 4h5M9 8h4M9 12h3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  时间{sortDesc ? '降序' : '升序'}
                </button>
              </div>

              {/* 项目卡片网格 */}
              <section className="pm2-section">
                {loading && !folders.length ? (
                  <div className="pm2-hint">正在加载项目…</div>
                ) : !shownFolders.length ? (
                  <div className="pm2-hint">
                    {query || typeFilter !== 'all' ? '没有匹配的项目' : '还没有项目,点右上角「新建项目」开始'}
                  </div>
                ) : (
                  <div className="pm2-card-grid" ref={gridRef}>
                    {pagedFolders.map((folder) => (
                      <div
                        key={folder.id}
                        className={`pm2-pcard${dragOverFolderId === folder.id ? ' is-dropover' : ''}`}
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
                        <div
                          className="pm2-pcard-cover"
                          style={folder.cover ? { backgroundImage: `url(${folder.cover})` } : undefined}
                        >
                          {!folder.cover && <FolderGlyph />}
                        </div>
                        <div className="pm2-pcard-body">
                          <div className="pm2-pcard-head">
                            <span className="pm2-pcard-title" title={folder.title}>
                              {folder.title}
                            </span>
                            <button
                              type="button"
                              className="pm2-pcard-more"
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
                          </div>
                          <div className="pm2-pcard-meta">
                            <span className="pm2-pcard-type">
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                <circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
                                <path
                                  d="M5 19c0-3.3 3.1-5 7-5s7 1.7 7 5"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                />
                              </svg>
                              {folder.type}
                            </span>
                            <span className="pm2-pcard-counts">
                              {folder.members} 成员 · {folder.works} 项目
                            </span>
                          </div>
                          <div className="pm2-pcard-foot">
                            <span className="pm2-pcard-avatar">{folder.title.slice(0, 1)}</span>
                            <span className="pm2-pcard-time">{relativeUpdated(folder.updatedAt)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {totalPages > 1 && (
                  <div className="pm2-pager">
                    <Pagination
                      current={page}
                      pageSize={pageSize}
                      total={shownFolders.length}
                      showSizeChanger={false}
                      onChange={setPage}
                    />
                  </div>
                )}
              </section>

              {/* 待归类:草稿状态项目(未出成片);封面用图片,点击进编辑续作 */}
              <section className="pm2-section">
                <h2 className="pm2-section-title">待归类</h2>
                {!unclassified.length ? (
                  <div className="pm2-hint">暂无待归类草稿，未完成的创作会出现在这里</div>
                ) : (
                  <div className="pm2-video-grid" ref={vidGridRef}>
                    {pagedUnclassified.map((video, i) => (
                      <div key={`${video.id}-${i}`} className="pm2-vid-wrap">
                        <div
                          className="pm2-vid"
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify(video))}
                        >
                          <span
                            className={`pm2-vid-thumb pm2-tone-${toneOf(i)}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              // 草稿 → 进智能成片编辑页续作
                              if (video.id) navigate(`/smart/${video.id}`)
                              else showToast('无法打开草稿', 'info')
                            }}
                          >
                            {video.cover ? (
                              <img
                                className="pm2-vid-media"
                                src={video.cover}
                                alt={video.title}
                                onError={(e) => {
                                  ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                                }}
                              />
                            ) : (
                              <span className="pm2-vid-play">
                                <PlayIcon />
                              </span>
                            )}
                            <span className="pm2-vid-draft-tag">草稿</span>
                          </span>
                          <span className="pm2-vid-title" title={video.title}>
                            {video.title}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {vidTotalPages > 1 && (
                  <div className="pm2-pager">
                    <Pagination
                      current={vidPage}
                      pageSize={vidPageSize}
                      total={unclassified.length}
                      showSizeChanger={false}
                      onChange={setVidPage}
                    />
                  </div>
                )}
              </section>
            </>
          ) : (
            /* 项目详情:最终视频 + 分镜(含元素) */
            <>
              <div className="pm2-detail-head">
                <button type="button" className="pm2-back" onClick={backToRoot}>
                  <svg viewBox="0 0 12 12" aria-hidden="true" width="12" height="12">
                    <path
                      d="M7.5 2.5 4 6l3.5 3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  返回
                </button>
                <h2 className="pm2-section-title pm2-section-title--inline">{activeProject?.title || '项目'}</h2>
                <button type="button" className="pm2-open-editor" onClick={openProjectEditor}>
                  进入编辑
                </button>
              </div>

              {detailLoading ? (
                <div className="pm2-hint">正在加载项目内容…</div>
              ) : (
                <>
                  {/* 最终视频(含历史) */}
                  <section className="pm2-section">
                    <h3 className="pm2-section-sub">最终视频</h3>
                    {activeVideo ? (
                      <div className="pm2-detail-video">
                        <div className="pm2-detail-player">
                          {activeVideo.url ? (
                            <video
                              src={activeVideo.url}
                              controls
                              playsInline
                              preload="metadata"
                              onLoadedMetadata={fixVideoDuration}
                            />
                          ) : (
                            <div className="pm2-hint">该版本视频暂时无法播放</div>
                          )}
                        </div>
                        {activeVideo?.url && (
                          <div className="pm-video-modal-actions">
                            <button
                              type="button"
                              className="pm-video-download-btn"
                              onClick={() =>
                                downloadFromUrl(
                                  activeVideo.url,
                                  `${activeProject?.title || '视频'}-${activeVideo.label}`,
                                )
                              }
                            >
                              <DownloadIcon /> 下载视频
                            </button>
                          </div>
                        )}
                        <div className="pm2-detail-video-side">
                          <div className="pm2-detail-history-title">
                            {detailVideos.length > 1 ? '历史版本' : '视频'}
                          </div>
                          <div className="pm2-detail-history-list">
                            {detailVideos.map((v, i) => (
                              <div
                                key={i}
                                className={`pm2-detail-history-item${i === activeVideoIdx ? ' is-active' : ''}`}
                              >
                                <button
                                  type="button"
                                  className="pm2-detail-history-pick"
                                  onClick={() => setActiveVideoIdx(i)}
                                >
                                  {v.url ? (
                                    <video src={v.url} muted preload="metadata" />
                                  ) : (
                                    <span className="pm2-vid-play">
                                      <PlayIcon />
                                    </span>
                                  )}
                                  <span>{v.label}</span>
                                </button>
                                <button
                                  type="button"
                                  className="pm2-detail-dl"
                                  aria-label="下载视频"
                                  title="下载视频"
                                  disabled={!v.url}
                                  onClick={() => downloadFromUrl(v.url, `${activeProject?.title || '视频'}-${v.label}`)}
                                >
                                  <DownloadIcon />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="pm2-hint">这个项目还没有生成视频。</div>
                    )}
                  </section>

                  {/* 分镜(每个分镜图 + 用到的元素) */}
                  <section className="pm2-section">
                    <h3 className="pm2-section-sub">分镜 · 共 {detailShots.length} 个</h3>
                    {detailShots.length ? (
                      <div className="pm2-shot-grid">
                        {detailShots.map((shot, i) => (
                          <div className="pm2-shot-card" key={shot.id}>
                            <div
                              className={`pm2-shot-thumb pm2-tone-${toneOf(i)}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => shot.url && setBigImg(shot.url)}
                            >
                              {shot.url ? (
                                <>
                                  <img src={shot.url} alt={shot.no} loading="lazy" />
                                  <AiBadge />
                                </>
                              ) : (
                                <span className="pm2-shot-empty">暂无分镜图</span>
                              )}
                            </div>
                            <div className="pm2-shot-meta">
                              <strong>{shot.no}</strong>
                              {shot.duration && <span>{shot.duration}</span>}
                            </div>
                            {shot.elements.length > 0 && (
                              <div className="pm2-shot-els">
                                {shot.elements.map((el, j) => (
                                  <span
                                    className="pm2-shot-el"
                                    key={j}
                                    title={`${el.tag}${el.kind ? ' · ' + el.kind : ''}`}
                                  >
                                    <span className="pm2-shot-el-thumb">
                                      {el.url ? <img src={el.url} alt={el.tag} loading="lazy" /> : <span>@</span>}
                                    </span>
                                    <span className="pm2-shot-el-name">@{el.tag}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="pm2-hint">这个项目还没有分镜。</div>
                    )}
                  </section>
                </>
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

      {/* 分镜图放大 */}
      {bigImg &&
        createPortal(
          <div className="pm2-lightbox" onClick={() => setBigImg('')} role="dialog" aria-label="分镜图放大">
            <img src={bigImg} alt="" onClick={(e) => e.stopPropagation()} />
            <button type="button" className="pm2-lightbox-close" aria-label="关闭" onClick={() => setBigImg('')}>
              ×
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
