/**
 * 项目视频详情页
 *
 * 页面效果：根据路由中的 projectId + videoId 精确加载一条视频，展示播放器、生成状态、创建人、
 * 时间和时长信息；支持返回来源列表、进入对应创作流程和下载视频，并适配横屏/竖屏播放。
 *
 * 权限边界：有项目访问权的成员可以查看详情和下载；仅视频创建者显示编辑入口；仅项目创建者
 * 或空间 owner/admin 可以删除。错误 videoId 只会显示未找到，不会回退打开或删除第一条视频。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import { useCurrentUser, useCurrentWorkspace, useWorkspaceId } from '@/stores/workspaceSession'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { useWorkspaceMemberAccess } from '@/composables/useWorkspaceMemberAccess'
import {
  deleteProjectVideo,
  formatVideoDate,
  formatVideoDuration,
  getProjectVideo,
  getVideoStatusText,
  type ProjectVideo,
} from '@/api/projectVideos'
import { downloadToDisk, buildDownloadName, isWeChatBrowser } from '@/utils/downloadToDisk'
import {
  isCreativeProjectRestrictedForUser,
  resolveCreativeProjectOwnerId,
  resolveUserId,
} from '@/utils/creativeDraftMetadata'
import './ProjectVideoDetailView.css'

/** 精确加载并渲染路由指定的视频详情，同时执行查看、下载和删除权限控制。 */
export default function ProjectVideoDetailView() {
  const navigate = useNavigate()
  const params = useParams()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const currentUser = useCurrentUser() as any
  const currentWorkspace = useCurrentWorkspace() as any
  const workspaceId = useWorkspaceId()
  const [searchParams] = useSearchParams()
  const fromUnclassified = searchParams.get('from') === 'unclassified' // 来自「待归类」:换面包屑、隐藏发布
  const projectId = Number(params.projectId || 0)
  const videoId = String(params.videoId || '')
  const userName =
    currentUser?.nickname || currentUser?.name || currentUser?.username || currentUser?.email || '当前用户'
  const currentUserId = resolveUserId(currentUser)
  // 编辑权跟随视频创建者；普通项目成员只保留查看和下载能力。
  const canModify = (item: ProjectVideo | null) => {
    if (!item) return false
    const ownerId = Number(item.createdByUserId ?? 0) || 0
    return ownerId > 0 && ownerId === currentUserId
  }

  const { workspaceMembers: effectiveWorkspaceMembers, currentWorkspaceRole } = useWorkspaceMemberAccess({
    workspaceId,
    currentUserId,
    currentWorkspace,
  })

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [projectTitle, setProjectTitle] = useState('')
  const [editorCount, setEditorCount] = useState(0)
  const [detail, setDetail] = useState<ProjectVideo | null>(null)
  const [projectOwnerId, setProjectOwnerId] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const detailRequestSequenceRef = useRef(0)
  const mountedRef = useRef(false)
  const routeContextRef = useRef({ workspaceId: 0, projectId: 0, videoId: '' })
  routeContextRef.current = { workspaceId: Number(workspaceId || 0), projectId, videoId }
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  // 删除权跟随项目创建者/空间管理员，而不是“能进入详情页”这一查看权限。
  const canDelete = useCallback(
    (_item: ProjectVideo | null) =>
      currentUserId > 0 &&
      (currentUserId === projectOwnerId || currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin'),
    [currentUserId, currentWorkspaceRole, projectOwnerId],
  )
  const canDeleteRef = useRef(canDelete)
  canDeleteRef.current = canDelete
  useEffect(() => {
    setDeleting(false)
  }, [projectId, videoId, workspaceId])
  // 竖屏视频:按屏幕高展示(横屏保持按宽,不变)。加载元数据后据真实宽高判断。
  const [isPortrait, setIsPortrait] = useState(false)
  // 视频缓冲完成(canplay)前显示 loading,避免"空白等半天才蹦出画面";加载失败显示错误(不再永久转圈);换视频时重置。
  const [videoReady, setVideoReady] = useState(false)
  const [videoError, setVideoError] = useState(false)
  useEffect(() => {
    setVideoReady(false)
    setVideoError(false)
  }, [detail?.videoUrl])

  const handleNavigate = useSidebarNavigate()

  // 必须同时命中路由中的 projectId 和 videoId；请求序号防止旧详情响应覆盖新路由。
  const loadDetail = useCallback(async () => {
    const wsId = Number(workspaceId || 0)
    const requestSequence = ++detailRequestSequenceRef.current
    if (!projectId || !videoId || !wsId) {
      setProjectTitle('')
      setProjectOwnerId(0)
      setDetail(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setDetail(null)
    try {
      const payload = await getProjectVideo({
        projectId,
        workspaceId: wsId,
        videoId,
        currentUserName: userName,
        currentUserId,
        workspaceMembers: effectiveWorkspaceMembers,
      })
      if (requestSequence !== detailRequestSequenceRef.current) return
      if (isCreativeProjectRestrictedForUser(payload.project, currentUserId)) {
        showToast('您没有权限访问该项目', 'error')
        navigate('/projects', { replace: true })
        return
      }
      setProjectTitle(String(payload.project?.title || payload.project?.name || '未命名项目'))
      setProjectOwnerId(resolveCreativeProjectOwnerId(payload.project))
      const count =
        Number(
          payload.project?.editor_count ?? payload.project?.editorCount ?? payload.project?.data?.editor_count ?? 0,
        ) || 0
      setEditorCount(Number.isFinite(count) && count > 0 ? Math.floor(count) : 0)
      setDetail(payload.video)
      if (!payload.video) {
        showToast('未找到该视频记录', 'error')
      }
    } catch (error: any) {
      if (requestSequence !== detailRequestSequenceRef.current) return
      setDetail(null)
      setProjectOwnerId(0)
      showToast(error?.message || '视频详情加载失败，请稍后重试', 'error')
    } finally {
      if (requestSequence === detailRequestSequenceRef.current) setLoading(false)
    }
  }, [projectId, videoId, workspaceId, userName, currentUserId, effectiveWorkspaceMembers, showToast, navigate])

  useEffect(() => {
    void loadDetail()
    return () => {
      detailRequestSequenceRef.current += 1
    }
  }, [loadDetail])

  const backToList = useCallback(() => {
    // 待归类来源没有「项目视频列表」上下文,返回项目管理页
    navigate(fromUnclassified ? '/projects' : `/projects/${projectId}/videos`)
  }, [navigate, projectId, fromUnclassified])

  const openEditor = useCallback(() => {
    if (!detail) return
    const query = new URLSearchParams()
    const targetWorkspaceId = Number(workspaceId || detail.workspaceId || 0)
    if (targetWorkspaceId > 0) query.set('workspace_id', String(targetWorkspaceId))
    query.set('video_id', String(detail.id))
    const videoAssetId = Number(detail.videoAssetId || 0)
    const selectedVideoAssetId = Number.isFinite(videoAssetId) && videoAssetId > 0 ? Math.floor(videoAssetId) : 0
    if (selectedVideoAssetId > 0) query.set('video_asset_id', String(selectedVideoAssetId))
    // 按视频所属流程进对应编辑器:爆款复制 → /hot-copy,其余(智能成片/旧版)→ /smart(与列表页 openEditor 一致)
    const base = (detail as any).flow === 'hot-copy' ? '/hot-copy' : '/smart'
    navigate(`${base}/${projectId}?${query.toString()}`, {
      state: {
        projectVideoSelection: {
          projectId,
          workspaceId: targetWorkspaceId,
          videoId: String(detail.id),
          ...(selectedVideoAssetId > 0 ? { videoAssetId: selectedVideoAssetId } : {}),
        },
      },
    })
  }, [detail, navigate, projectId, workspaceId])

  // 下载对所有可访问项目的成员开放，不与编辑或删除权限绑定。
  const downloadVideo = useCallback(async () => {
    if (!detail?.videoUrl) {
      showToast('当前视频暂无可下载地址', 'info')
      return
    }
    const url = detail.videoUrl
    const fileName = buildDownloadName(detail.title || '视频', new Date())
    try {
      showToast('视频下载中…', 'success')
      const r = await downloadToDisk({ fileName, resolveUrl: () => url })
      if (r === 'done') showToast('视频已保存', 'success')
      else if (r === 'started') {
        showToast(isWeChatBrowser() ? '已打开视频，请使用播放器菜单保存' : '已开始下载，请查看浏览器下载列表', 'info')
      }
    } catch (err: any) {
      showToast(err?.message || '下载失败,请稍后重试', 'error')
    }
  }, [detail, showToast])

  // 删除前校验权限、视频 id 和路由快照；确认弹窗返回后再次核对，避免误删已切走的目标。
  const handleDelete = useCallback(async () => {
    const wsId = Number(workspaceId || 0)
    if (!detail || !projectId || !wsId || deleting) return
    if (!canDeleteRef.current(detail)) {
      showToast('仅项目创建者或空间管理员可以删除视频', 'error')
      return
    }
    if (String(detail.id) !== videoId) {
      setDetail(null)
      showToast('视频标识已变化，请返回列表后重新打开', 'error')
      return
    }
    const target = { workspaceId: wsId, projectId, videoId }
    const isCurrentTarget = () => {
      const current = routeContextRef.current
      return (
        mountedRef.current &&
        current.workspaceId === target.workspaceId &&
        current.projectId === target.projectId &&
        current.videoId === target.videoId
      )
    }
    const confirmed = await requestConfirm(`确定删除视频「${detail.title}」吗？该操作不可恢复。`)
    if (!confirmed) return
    if (!isCurrentTarget()) return
    if (!canDeleteRef.current(detail)) {
      showToast('仅项目创建者或空间管理员可以删除视频', 'error')
      return
    }
    setDeleting(true)
    try {
      await deleteProjectVideo({
        projectId: target.projectId,
        workspaceId: target.workspaceId,
        videoId: target.videoId,
      })
      if (!isCurrentTarget()) return
      showToast('视频已删除', 'success')
      navigate(`/projects/${target.projectId}/videos`)
    } catch (error: any) {
      if (isCurrentTarget()) showToast(error?.message || '删除失败，请稍后重试', 'error')
    } finally {
      if (isCurrentTarget()) setDeleting(false)
    }
  }, [detail, projectId, videoId, workspaceId, deleting, requestConfirm, showToast, navigate])

  return (
    <div className="pvdetail-page">
      <AppSidebar
        activeKey="projects"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="pvdetail-shell">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <main className="pvdetail-main">
          <div className="pvdetail-breadcrumb">
            <button type="button" className="pvdetail-breadcrumb__link" onClick={() => navigate('/home')}>
              首页
            </button>
            <span>/</span>
            <button type="button" className="pvdetail-breadcrumb__link" onClick={() => navigate('/projects')}>
              项目管理
            </button>
            <span>/</span>
            <button type="button" className="pvdetail-breadcrumb__link" onClick={backToList}>
              {fromUnclassified ? '待归类' : projectTitle || '项目视频'}
            </button>
            <span>/</span>
            <span className="pvdetail-breadcrumb__current">{detail?.title || '视频详情'}</span>
          </div>

          {loading ? (
            <div className="pvdetail-empty">视频详情加载中...</div>
          ) : !detail ? (
            <div className="pvdetail-empty">未找到该视频记录</div>
          ) : (
            <>
              <section className="pvdetail-header">
                <div className="pvdetail-header__main">
                  <button type="button" className="pvdetail-back" onClick={backToList}>
                    ← 返回列表
                  </button>
                  <h1>{detail.title}</h1>
                  <div className={`pvdetail-status is-${detail.status}`}>{getVideoStatusText(detail.status)}</div>
                  {editorCount ? <div className="pvdetail-meta">{editorCount} 编辑者</div> : null}
                </div>
                <div className="pvdetail-header__actions">
                  {canModify(detail) ? (
                    <button type="button" className="pvdetail-action" onClick={openEditor}>
                      进入编辑
                    </button>
                  ) : null}
                  <button type="button" className="pvdetail-action" onClick={downloadVideo}>
                    下载视频
                  </button>
                  {canDelete(detail) ? (
                    <button
                      type="button"
                      className="pvdetail-action pvdetail-action--danger"
                      onClick={handleDelete}
                      disabled={deleting}
                    >
                      {deleting ? '删除中...' : '删除视频'}
                    </button>
                  ) : null}
                </div>
              </section>

              <section className="pvdetail-content">
                <div className={`pvdetail-player${isPortrait ? ' is-portrait' : ''}`}>
                  {detail.videoUrl ? (
                    <>
                      <video
                        src={detail.videoUrl}
                        poster={detail.coverUrl || undefined}
                        controls
                        playsInline
                        preload="auto"
                        className={`pvdetail-video${videoReady ? ' is-ready' : ''}`}
                        onLoadedMetadata={(e) => {
                          const v = e.currentTarget
                          setIsPortrait(v.videoHeight > v.videoWidth)
                        }}
                        onLoadedData={() => setVideoReady(true)}
                        onCanPlay={() => setVideoReady(true)}
                        onError={() => {
                          setVideoError(true)
                          setVideoReady(true) // 收起 loading 转圈,改显错误
                        }}
                      />
                      {!videoReady && !videoError && (
                        <div className="pvdetail-player__loading" aria-live="polite">
                          <span className="pvdetail-spinner" aria-hidden="true" />
                          <span>视频加载中…</span>
                        </div>
                      )}
                      {videoError && (
                        <div className="pvdetail-player__loading" aria-live="polite">
                          <span>视频加载失败,请稍后重试</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="pvdetail-player__empty">该视频尚未生成内容，当前为草稿记录</div>
                  )}
                </div>
                <aside className="pvdetail-meta">
                  <div className="pvdetail-meta__block">
                    <h2>基础信息</h2>
                    <dl>
                      <div>
                        <dt>所属项目</dt>
                        <dd>{projectTitle || '--'}</dd>
                      </div>
                      <div>
                        <dt>创建人</dt>
                        <dd>{detail.createdByName || '--'}</dd>
                      </div>
                      <div>
                        <dt>创建时间</dt>
                        <dd>{formatVideoDate(detail.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>更新时间</dt>
                        <dd>{formatVideoDate(detail.updatedAt)}</dd>
                      </div>
                      <div>
                        <dt>视频时长</dt>
                        <dd>{formatVideoDuration(detail.durationSeconds)}</dd>
                      </div>
                      <div>
                        <dt>视频状态</dt>
                        <dd>{getVideoStatusText(detail.status)}</dd>
                      </div>
                      <div>
                        <dt>创作类型</dt>
                        <dd>{detail.sourceType === 'creative' ? '分步创作' : '智能成片'}</dd>
                      </div>
                    </dl>
                  </div>
                </aside>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
