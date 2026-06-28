import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import AppToast from '@/components/AppToast'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import {
  deleteProjectVideo,
  formatVideoDate,
  formatVideoDuration,
  getProjectVideo,
  getVideoStatusText,
  type ProjectVideo,
} from '@/api/projectVideos'
import './ProjectVideoDetailView.css'

export default function ProjectVideoDetailView() {
  const navigate = useNavigate()
  const params = useParams()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const currentUser = useCurrentUser() as any
  const workspaceId = useWorkspaceId()
  const [searchParams] = useSearchParams()
  const fromUnclassified = searchParams.get('from') === 'unclassified' // 来自「待归类」:换面包屑、隐藏发布
  const projectId = Number(params.projectId || 0)
  const videoId = String(params.videoId || '')
  const userName =
    currentUser?.nickname || currentUser?.name || currentUser?.username || currentUser?.email || '当前用户'

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [projectTitle, setProjectTitle] = useState('')
  const [detail, setDetail] = useState<ProjectVideo | null>(null)
  const [deleting, setDeleting] = useState(false)
  // 竖屏视频:按屏幕高展示(横屏保持按宽,不变)。加载元数据后据真实宽高判断。
  const [isPortrait, setIsPortrait] = useState(false)

  const handleNavigate = useSidebarNavigate()

  const loadDetail = useCallback(async () => {
    const wsId = Number(workspaceId || 0)
    if (!projectId || !videoId || !wsId) {
      setProjectTitle('')
      setDetail(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const payload = await getProjectVideo({ projectId, workspaceId: wsId, videoId, currentUserName: userName })
      setProjectTitle(String(payload.project?.title || payload.project?.name || '未命名项目'))
      setDetail(payload.video)
      if (!payload.video) {
        showToast('未找到该视频记录', 'error')
      }
    } catch (error: any) {
      setDetail(null)
      showToast(error?.message || '视频详情加载失败，请稍后重试', 'error')
    } finally {
      setLoading(false)
    }
  }, [projectId, videoId, workspaceId, userName, showToast])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const backToList = useCallback(() => {
    // 待归类来源没有「项目视频列表」上下文,返回项目管理页
    navigate(fromUnclassified ? '/projects' : `/projects/${projectId}/videos`)
  }, [navigate, projectId, fromUnclassified])

  const openEditor = useCallback(() => {
    if (!detail) return
    const qs = workspaceId ? `?workspace_id=${workspaceId}` : ''
    // 按视频所属流程进对应编辑器:爆款复制 → /hot-copy,其余(智能成片/旧版)→ /smart(与列表页 openEditor 一致)
    const base = (detail as any).flow === 'hot-copy' ? '/hot-copy' : '/smart'
    navigate(`${base}/${projectId}${qs}`)
  }, [detail, navigate, projectId, workspaceId])

  const downloadVideo = useCallback(() => {
    if (!detail?.videoUrl) {
      showToast('当前视频暂无可下载地址', 'info')
      return
    }
    window.open(detail.videoUrl, '_blank', 'noopener')
    showToast('已在新标签打开视频，可直接下载', 'success')
  }, [detail, showToast])

  const handleDelete = useCallback(async () => {
    const wsId = Number(workspaceId || 0)
    if (!detail || !projectId || !wsId || deleting) return
    const confirmed = await requestConfirm(`确定删除视频「${detail.title}」吗？该操作不可恢复。`)
    if (!confirmed) return
    setDeleting(true)
    try {
      await deleteProjectVideo({ projectId, workspaceId: wsId, videoId: detail.id })
      showToast('视频已删除', 'success')
      navigate(`/projects/${projectId}/videos`)
    } catch (error: any) {
      showToast(error?.message || '删除失败，请稍后重试', 'error')
    } finally {
      setDeleting(false)
    }
  }, [detail, projectId, workspaceId, deleting, requestConfirm, showToast, navigate])

  return (
    <div className="pvdetail-page">
      <AppToast />
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
                </div>
                <div className="pvdetail-header__actions">
                  <button type="button" className="pvdetail-action" onClick={openEditor}>
                    进入编辑
                  </button>
                  <button type="button" className="pvdetail-action" onClick={downloadVideo}>
                    下载视频
                  </button>
                  <button
                    type="button"
                    className="pvdetail-action pvdetail-action--danger"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? '删除中...' : '删除视频'}
                  </button>
                </div>
              </section>

              <section className="pvdetail-content">
                <div className={`pvdetail-player${isPortrait ? ' is-portrait' : ''}`}>
                  {detail.videoUrl ? (
                    <video
                      src={detail.videoUrl}
                      controls
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget
                        setIsPortrait(v.videoHeight > v.videoWidth)
                      }}
                    />
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
                  <div className="pvdetail-meta__block">
                    <h2>说明</h2>
                    <p>
                      当前详情页已经具备项目视频模块的业务承载能力，后续可继续补充发布链接、操作日志、审核状态等信息。
                    </p>
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
