/*
  ProjectManagementView — 项目管理(2.1 新版)
  - 我的项目:每个创意项目以「渐变彩色文件夹」展示;首格「创建项目」点击弹窗填项目名。点文件夹进入查看其中视频。
  - 待归类:智能成片 / 爆款复制保存的视频先落在这里(后端暂无该概念,先用占位假数据);可拖进上方项目文件夹。
  - 视频卡:hover 显示下载;点击播放(预览弹窗)。
*/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import '@/styles/creative.css'
import '@/styles/project-management.css'
import AppLayout from '@/components/layout/AppLayout'
import AppToast from '@/components/AppToast'
import {
  createCreativeProject,
  deleteCreativeProject,
  deleteCreativeProjectVersion,
  getAssetDownloadUrl,
  getBusinessErrorMessage,
  getCreativeProject,
  getCreativeProjectVersion,
  listCreativeProjects,
  listCreativeProjectVersions,
} from '@/api/business'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { useWorkspaceId } from '@/stores/workspaceSession'

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

function pickFirstText(...candidates: any[]): string {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (value) return value
  }
  return ''
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

function normalizeCreativeProjectVersions(payload: any): any[] {
  const raw = toPlainObject(payload) ?? payload
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.list)
        ? raw.list
        : Array.isArray(raw?.versions)
          ? raw.versions
          : []
  return list.filter((item: any) => item && typeof item === 'object')
}

function resolveVersionId(item: any): number {
  return Number(item?.vid || item?.version_id || item?.versionId || item?.id || item?.version_no || 0)
}

function resolveVersionLabel(item: any, fallbackTitle = '未命名视频'): string {
  const explicit = pickFirstText(item?.label, item?.name, item?.title)
  if (explicit) return explicit
  const versionNo = Number(item?.version_no || item?.versionNo || 0)
  if (Number.isFinite(versionNo) && versionNo > 0) return `视频保存 ${versionNo}`
  const versionId = resolveVersionId(item)
  if (versionId > 0) return `视频保存 ${versionId}`
  return fallbackTitle
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

function FolderGlyph() {
  // 白色半透明文件夹图标,叠在渐变底色上
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

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
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

export default function ProjectManagementView() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const workspaceId = useWorkspaceId()

  const [loading, setLoading] = useState(false)
  const [projectItems, setProjectItems] = useState<any[]>([])
  const [openMenuId, setOpenMenuId] = useState(0)
  const [deletingProjectId, setDeletingProjectId] = useState(0)
  const [dragOverFolderId, setDragOverFolderId] = useState(0)

  // 创建项目弹窗
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  // 文件夹(项目)内视频
  const [viewMode, setViewMode] = useState<'root' | 'folder'>('root')
  const [activeProject, setActiveProject] = useState<{ id: number; title: string; flow: string } | null>(null)
  const [projectVersions, setProjectVersions] = useState<any[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [deletingVersionId, setDeletingVersionId] = useState(0)

  // 视频预览
  const [videoPreviewOpen, setVideoPreviewOpen] = useState(false)
  const [videoPreviewUrl, setVideoPreviewUrl] = useState('')
  const [videoPreviewLoading, setVideoPreviewLoading] = useState(false)
  const [videoPreviewTitle, setVideoPreviewTitle] = useState('')

  const workspaceIdRef = useRef(0)
  useEffect(() => {
    workspaceIdRef.current = Number(workspaceId || 0)
  }, [workspaceId])

  const folders = useMemo(() => {
    return projectItems
      .map((project) => ({
        id: Number(project?.id || 0),
        title: String(project?.title || project?.name || '').trim() || '未命名项目',
        updatedAt: getProjectTimestamp(project, ['updated_at', 'updatedAt', 'last_saved_at', 'created_at', 'createdAt']),
      }))
      .filter((p) => p.id > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [projectItems])

  const folderVideos = useMemo(() => {
    return projectVersions
      .map((item, index) => ({
        id: resolveVersionId(item),
        title: resolveVersionLabel(item, `${activeProject?.title || '视频'} ${index + 1}`),
        createdAt: getProjectTimestamp(item, ['created_at', 'createdAt', 'updated_at', 'updatedAt']),
        tone: toneOf(index),
        raw: item,
      }))
      .filter((item) => item.id > 0 && String(item.raw?.label || '').startsWith('视频保存'))
      .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
  }, [projectVersions, activeProject])

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
    setProjectVersions([])
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

  // 创建项目:弹窗填名 → 调后端建空项目 → 刷新列表
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

  const openFolder = useCallback(
    async (folder: { id: number; title: string }) => {
      const wsId = Number(workspaceId || 0)
      if (!folder.id || !wsId) {
        showToast('workspace_id 缺失,无法打开项目', 'error')
        return
      }
      setActiveProject({ id: folder.id, title: folder.title, flow: '' })
      setProjectVersions([])
      setViewMode('folder')
      setVersionsLoading(true)
      try {
        const [versions, detail] = await Promise.all([
          listCreativeProjectVersions({ projectId: folder.id, workspaceId: wsId, limit: 100 }).catch(() => []),
          getCreativeProject({ projectId: folder.id, workspaceId: wsId }).catch(() => null),
        ])
        const flow = String(normalizeCreativeProjectDraft(detail || {})?.flow || '')
        setActiveProject((prev) => (prev && prev.id === folder.id ? { ...prev, flow } : prev))
        setProjectVersions(normalizeCreativeProjectVersions(versions))
      } catch (error) {
        setProjectVersions([])
        showToast(getBusinessErrorMessage(error, '项目内容加载失败,请稍后重试'), 'error')
      } finally {
        setVersionsLoading(false)
      }
    },
    [workspaceId, showToast],
  )

  const backToRoot = useCallback(() => {
    setViewMode('root')
    setActiveProject(null)
    setProjectVersions([])
  }, [])

  const openProjectEditor = useCallback(() => {
    if (!activeProject?.id) return
    navigate(activeProject.flow === 'smart' ? `/smart/${activeProject.id}` : `/creative/${activeProject.id}`)
  }, [activeProject, navigate])

  const resolveVideoUrl = useCallback(
    async (versionId: number): Promise<string> => {
      const wsId = Number(workspaceId || 0)
      if (!activeProject?.id || !versionId || !wsId) return ''
      try {
        const detail = await getCreativeProjectVersion({
          projectId: activeProject.id,
          versionId,
          vid: versionId,
          workspaceId: wsId,
        })
        const raw = toPlainObject(detail) ?? detail
        const versionObj =
          (raw?.version && typeof raw.version === 'object'
            ? raw.version
            : raw?.data?.version && typeof raw.data.version === 'object'
              ? raw.data.version
              : raw?.data && typeof raw.data === 'object'
                ? raw.data
                : raw) || {}
        const draft =
          normalizeCreativeProjectDraft(versionObj) ||
          normalizeCreativeProjectDraft(raw) ||
          toPlainObject(versionObj?.snapshot_json) ||
          toPlainObject(versionObj?.snapshotJson) ||
          null
        if (!draft) return ''
        let url = String(draft.generatedVideoUrl || draft.generated_video_url || '')
        const assetId = Number(draft.generatedVideoAssetId || draft.generated_video_asset_id || 0)
        if (assetId > 0) {
          const fresh = await getAssetDownloadUrl({ workspaceId: wsId, assetId }).catch(() => '')
          if (fresh) url = fresh
        }
        return url || ''
      } catch {
        return ''
      }
    },
    [activeProject, workspaceId],
  )

  const previewVideo = useCallback(
    async (video: { id: number; title: string }) => {
      if (videoPreviewLoading) return
      setVideoPreviewLoading(true)
      setVideoPreviewTitle(video.title || '视频预览')
      setVideoPreviewUrl('')
      const url = await resolveVideoUrl(video.id)
      if (!url) {
        setVideoPreviewLoading(false)
        showToast('该视频暂时无法播放', 'info')
        return
      }
      setVideoPreviewUrl(url)
      setVideoPreviewOpen(true)
      setVideoPreviewLoading(false)
    },
    [videoPreviewLoading, resolveVideoUrl, showToast],
  )

  // 把已解析出的视频 URL 触发下载(同源支持「另存为」,跨域走隐藏 iframe)
  const downloadFromUrl = useCallback(
    async (url: string, title: string) => {
      if (!url) {
        showToast('没有可下载的视频', 'error')
        return
      }
      const date = new Date()
      const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
      const safeName = String(title || '视频').replace(/[\\/:*?"<>|]/g, '').trim() || '视频'
      const fileName = `${safeName}_${dateStr}.mp4`

      const isSameOrigin = (() => {
        try {
          return new URL(url, window.location.href).origin === window.location.origin
        } catch {
          return false
        }
      })()

      if ((window as any).showSaveFilePicker && isSameOrigin) {
        try {
          const fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }],
          })
          showToast('视频下载中…', 'success')
          const response = await fetch(url)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const blob = new Blob([await response.blob()], { type: 'video/mp4' })
          const writable = await fileHandle.createWritable()
          await writable.write(blob)
          await writable.close()
          showToast('视频已保存', 'success')
          return
        } catch (err: any) {
          if (err?.name === 'AbortError') return
        }
      }

      const iframe = document.createElement('iframe')
      iframe.style.display = 'none'
      iframe.src = url
      document.body.appendChild(iframe)
      setTimeout(() => document.body.removeChild(iframe), 3000)
      showToast('视频已开始下载', 'success')
    },
    [showToast],
  )

  const downloadVideo = useCallback(
    async (video: { id: number; title: string }) => {
      const url = await resolveVideoUrl(video.id)
      await downloadFromUrl(url, video.title)
    },
    [resolveVideoUrl, downloadFromUrl],
  )

  const deleteFolderVideo = useCallback(
    async (video: { id: number; title: string }) => {
      if (deletingVersionId || !activeProject?.id) return
      const confirmed = await requestConfirm(`确定删除「${video.title}」吗?删除后不可恢复。`)
      if (!confirmed) return
      const wsId = Number(workspaceId || 0)
      if (!wsId) {
        showToast('workspace_id 缺失,无法删除', 'error')
        return
      }
      setDeletingVersionId(video.id)
      try {
        await deleteCreativeProjectVersion({
          projectId: activeProject.id,
          versionId: video.id,
          vid: video.id,
          workspaceId: wsId,
        })
        setProjectVersions((prev) => prev.filter((item) => resolveVersionId(item) !== video.id))
        showToast('已删除', 'success')
      } catch (error) {
        showToast(getBusinessErrorMessage(error, '删除失败,请稍后重试'), 'error')
      } finally {
        setDeletingVersionId(0)
      }
    },
    [deletingVersionId, activeProject, requestConfirm, workspaceId, showToast],
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

  // 把「待归类」视频拖入项目文件夹(后端暂无归类接口,先占位提示;接口好了在此调用)
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

  const closeVideoPreview = useCallback(() => {
    setVideoPreviewOpen(false)
    setVideoPreviewUrl('')
  }, [])

  // 视频卡(待归类 / 文件夹内共用)。placeholder=占位假数据(无真实视频)
  const renderVideoCard = (
    video: { id: any; title: string; tone?: string },
    index: number,
    opts: { placeholder?: boolean } = {},
  ) => {
    const tone = video.tone || toneOf(index)
    const isPlaceholder = !!opts.placeholder
    const realVideo = { id: Number(video.id) || 0, title: video.title }
    return (
      <div
        key={video.id}
        className="pm2-vid"
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ id: video.id, title: video.title }))}
      >
        <span
          className={`pm2-vid-thumb pm2-tone-${tone}`}
          role="button"
          tabIndex={0}
          onClick={() => (isPlaceholder ? showToast('占位视频,接口接入后可播放', 'info') : previewVideo(realVideo))}
          onKeyDown={(e) =>
            e.key === 'Enter' && (isPlaceholder ? showToast('占位视频,接口接入后可播放', 'info') : previewVideo(realVideo))
          }
        >
          <span className="pm2-vid-play">
            <PlayIcon />
          </span>
          {/* hover 下载 */}
          <button
            type="button"
            className="pm2-vid-dl"
            aria-label="下载视频"
            title="下载视频"
            onClick={(e) => {
              e.stopPropagation()
              if (isPlaceholder) showToast('占位视频,暂不可下载', 'info')
              else downloadVideo(realVideo)
            }}
          >
            <DownloadIcon />
          </button>
        </span>
        <span className="pm2-vid-title" title={video.title}>
          {video.title}
        </span>
      </div>
    )
  }

  return (
    <AppLayout activeNav="项目管理">
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
                      <path d="M24 14v20M14 24h20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
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
                        <FolderGlyph />
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
                {PLACEHOLDER_UNCLASSIFIED.map((video, i) => renderVideoCard(video, i, { placeholder: true }))}
              </div>
            </section>
          </>
        ) : (
          /* 文件夹内:项目视频 */
          <section className="pm2-section">
            <div className="pm2-folder-head">
              <button type="button" className="pm2-back" onClick={backToRoot}>
                <svg viewBox="0 0 12 12" aria-hidden="true" width="12" height="12">
                  <path d="M7.5 2.5 4 6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                返回
              </button>
              <h2 className="pm2-section-title pm2-section-title--inline">{activeProject?.title || '项目'}</h2>
              <span className="pm2-folder-count">
                {versionsLoading ? '加载中…' : `共 ${folderVideos.length} 个视频`}
              </span>
              <button type="button" className="pm2-open-editor" onClick={openProjectEditor}>
                进入编辑
              </button>
            </div>

            <div className="pm2-video-grid">
              {versionsLoading ? (
                <div className="pm2-hint">正在加载项目内的视频…</div>
              ) : !folderVideos.length ? (
                <div className="pm2-hint">这个项目还没有保存的视频,生成视频后点击「保存视频」即可。</div>
              ) : (
                folderVideos.map((video, i) => (
                  <div key={video.id} className="pm2-vid-wrap">
                    {renderVideoCard(video, i)}
                    <button
                      type="button"
                      className="pm2-vid-del"
                      disabled={deletingVersionId === video.id}
                      onClick={() => deleteFolderVideo(video)}
                    >
                      {deletingVersionId === video.id ? '删除中…' : '删除'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </section>

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
                <button type="button" className="pm2-modal-close" aria-label="关闭" disabled={creating} onClick={() => setCreateOpen(false)}>
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
                <button type="button" className="pm2-modal-btn" disabled={creating} onClick={() => setCreateOpen(false)}>
                  取消
                </button>
                <button type="button" className="pm2-modal-btn pm2-modal-btn--primary" disabled={creating} onClick={submitCreate}>
                  {creating ? '创建中…' : '创建'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 视频预览弹窗 */}
      {videoPreviewOpen &&
        createPortal(
          <div
            className="pm-video-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeVideoPreview()
            }}
          >
            <div className="pm-video-modal">
              <div className="pm-video-modal-header">
                <span>{videoPreviewTitle}</span>
                <button type="button" className="pm-video-modal-close" aria-label="关闭" onClick={closeVideoPreview}>
                  <svg viewBox="0 0 14 14" aria-hidden="true" width="16" height="16">
                    <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="pm-video-modal-body">
                {videoPreviewUrl ? (
                  <video src={videoPreviewUrl} controls autoPlay playsInline />
                ) : (
                  <div className="pm-video-modal-loading">加载中...</div>
                )}
                {videoPreviewUrl && (
                  <div className="pm-video-modal-actions">
                    <button
                      type="button"
                      className="pm2-modal-btn pm2-modal-btn--primary"
                      onClick={() => downloadFromUrl(videoPreviewUrl, videoPreviewTitle)}
                    >
                      下载视频
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </AppLayout>
  )
}
