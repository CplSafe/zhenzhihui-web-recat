import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import AppToast from '@/components/AppToast'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import {
  createProjectVideo,
  deleteProjectVideo,
  formatVideoDate,
  formatVideoDuration,
  getVideoStatusText,
  listProjectVideos,
  publishProjectVideo,
  type ProjectVideo,
} from '@/api/projectVideos'
import './ProjectVideoListView.css'

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

type SortKey = 'updatedAt' | 'createdAt'
type StatusFilter = 'all' | 'draft' | 'processing' | 'published'
type DurationFilter = 'all' | 'short' | 'mid' | 'long'

function matchesDuration(item: ProjectVideo, duration: DurationFilter): boolean {
  if (duration === 'all') return true
  const seconds = Number(item.durationSeconds || 0)
  if (duration === 'short') return seconds > 0 && seconds <= 15
  if (duration === 'mid') return seconds > 15 && seconds <= 60
  return seconds > 60
}

function sortVideos(list: ProjectVideo[], sortBy: SortKey): ProjectVideo[] {
  return [...list].sort((a, b) => {
    const av = Date.parse(sortBy === 'createdAt' ? a.createdAt : a.updatedAt || a.createdAt || '')
    const bv = Date.parse(sortBy === 'createdAt' ? b.createdAt : b.updatedAt || b.createdAt || '')
    return (Number.isFinite(bv) ? bv : 0) - (Number.isFinite(av) ? av : 0)
  })
}

function isVideoCover(url: string): boolean {
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(String(url || ''))
}

export default function ProjectVideoListView() {
  const navigate = useNavigate()
  const params = useParams()
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const currentUser = useCurrentUser() as any
  const workspaceId = useWorkspaceId()
  const projectId = Number(params.projectId || 0)
  const userName =
    currentUser?.nickname || currentUser?.name || currentUser?.username || currentUser?.email || '当前用户'

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [projectTitle, setProjectTitle] = useState('')
  const [videos, setVideos] = useState<ProjectVideo[]>([])

  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('updatedAt')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [duration, setDuration] = useState<DurationFilter>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [openMenuId, setOpenMenuId] = useState('')

  const handleNavigate = useCallback(
    (key: string) => {
      const path = ROUTE_MAP[key]
      if (path) navigate(path)
      else showToast('功能待开放', 'info')
    },
    [navigate, showToast],
  )

  const loadData = useCallback(async () => {
    const wsId = Number(workspaceId || 0)
    if (!projectId || !wsId) {
      setProjectTitle('')
      setVideos([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const payload = await listProjectVideos({ projectId, workspaceId: wsId, currentUserName: userName })
      setProjectTitle(String(payload.project?.title || payload.project?.name || '未命名项目'))
      setVideos(payload.videos)
    } catch (error: any) {
      setVideos([])
      setProjectTitle('')
      showToast(error?.message || '项目视频加载失败，请稍后重试', 'error')
    } finally {
      setLoading(false)
    }
  }, [projectId, workspaceId, showToast, userName])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    setPage(1)
  }, [query, sortBy, status, duration, pageSize])

  useEffect(() => {
    if (!openMenuId) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement
      if (target?.closest?.('.pvlist-card__menu-wrap')) return
      setOpenMenuId('')
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [openMenuId])

  const filteredVideos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = videos.filter((item) => {
      if (
        normalizedQuery &&
        !String(item.title || '')
          .toLowerCase()
          .includes(normalizedQuery)
      )
        return false
      if (status !== 'all' && item.status !== status) return false
      if (!matchesDuration(item, duration)) return false
      return true
    })
    return sortVideos(filtered, sortBy)
  }, [videos, query, status, duration, sortBy])

  const videoCount = videos.length
  const total = filteredVideos.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedVideos = filteredVideos.slice((safePage - 1) * pageSize, safePage * pageSize)

  const openDetail = useCallback(
    (video: ProjectVideo) => {
      navigate(`/projects/${projectId}/videos/${video.id}`)
    },
    [navigate, projectId],
  )

  const openEditor = useCallback(
    (video: ProjectVideo) => {
      const qs = workspaceId ? `?workspace_id=${workspaceId}` : ''
      if (video.sourceType === 'creative') {
        navigate(`/smart/${projectId}${qs}`)
        return
      }
      navigate(`/smart/${projectId}${qs}`)
    },
    [navigate, projectId, workspaceId],
  )

  const downloadVideo = useCallback(
    async (video: ProjectVideo) => {
      if (!video.videoUrl) {
        showToast('当前视频暂无可下载地址', 'info')
        return
      }
      window.open(video.videoUrl, '_blank', 'noopener')
      showToast('已在新标签打开视频，可直接下载', 'success')
    },
    [showToast],
  )

  const handleCreateVideo = useCallback(async () => {
    const wsId = Number(workspaceId || 0)
    if (!projectId || !wsId) {
      showToast('当前项目不可用，无法新建视频', 'error')
      return
    }
    try {
      const created = await createProjectVideo({
        projectId,
        workspaceId: wsId,
        title: `${projectTitle || '当前项目'} · 新视频`,
        currentUserName: userName,
      })
      showToast('已在当前项目下创建新视频', 'success')
      await loadData()
      navigate(`/projects/${projectId}/videos/${created.id}`)
    } catch (error: any) {
      showToast(error?.message || '新建视频失败，请稍后重试', 'error')
    }
  }, [workspaceId, projectId, showToast, projectTitle, userName, loadData, navigate])

  const handlePublish = useCallback(
    async (video: ProjectVideo) => {
      const wsId = Number(workspaceId || 0)
      if (!projectId || !wsId) return
      await publishProjectVideo({ projectId, workspaceId: wsId, videoId: video.id })
      showToast('视频已标记为已发布', 'success')
      setOpenMenuId('')
      await loadData()
    },
    [workspaceId, projectId, loadData, showToast],
  )

  const handleDelete = useCallback(
    async (video: ProjectVideo) => {
      const confirmed = await requestConfirm(`确定删除视频「${video.title}」吗？该操作不可恢复。`)
      if (!confirmed) return
      const wsId = Number(workspaceId || 0)
      if (!projectId || !wsId) return
      await deleteProjectVideo({ projectId, workspaceId: wsId, videoId: video.id })
      showToast('视频已删除', 'success')
      setOpenMenuId('')
      await loadData()
    },
    [requestConfirm, workspaceId, projectId, loadData, showToast],
  )

  const pageNumbers = useMemo(() => {
    const start = Math.max(1, safePage - 2)
    const end = Math.min(totalPages, start + 4)
    const pages: number[] = []
    for (let current = start; current <= end; current += 1) pages.push(current)
    return pages
  }, [safePage, totalPages])

  return (
    <div className="pvlist-page">
      <AppToast />
      <AppSidebar
        activeKey="projects"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="pvlist-shell">
        <AppTopbar onMenu={() => setSidebarOpen(true)} onMember={() => showToast('会员中心待开放', 'info')} />
        <main className="pvlist-main">
          <div className="pvlist-container">
            <div className="pvlist-breadcrumb">
              <button type="button" className="pvlist-breadcrumb__link" onClick={() => navigate('/home')}>
                首页
              </button>
              <span className="pvlist-breadcrumb__sep">›</span>
              <button type="button" className="pvlist-breadcrumb__link" onClick={() => navigate('/projects')}>
                项目管理
              </button>
              <span className="pvlist-breadcrumb__sep">›</span>
              <span className="pvlist-breadcrumb__current">
                {projectTitle || '项目视频'}
                {videoCount ? `（${videoCount}个视频）` : ''}
              </span>
            </div>

            <section className="pvlist-toolbar" aria-label="项目视频工具栏">
              <div className="pvlist-toolbar__left">
                <label className="pvlist-search">
                  <span className="pvlist-search__icon" aria-hidden="true">
                    ⌕
                  </span>
                  <input
                    type="search"
                    value={query}
                    placeholder="搜索视频..."
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
              <div className="pvlist-toolbar__right">
                <div className="pvlist-filters">
                  <label className="pvlist-select">
                    <span>排序:</span>
                    <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}>
                      <option value="updatedAt">修改时间</option>
                      <option value="createdAt">创建时间</option>
                    </select>
                  </label>
                  <label className="pvlist-select">
                    <span>状态:</span>
                    <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
                      <option value="all">全部</option>
                      <option value="draft">草稿</option>
                      <option value="processing">制作中</option>
                      <option value="published">已发布</option>
                    </select>
                  </label>
                  <label className="pvlist-select">
                    <span>时长:</span>
                    <select value={duration} onChange={(event) => setDuration(event.target.value as DurationFilter)}>
                      <option value="all">全部</option>
                      <option value="short">短视频</option>
                      <option value="mid">中视频</option>
                      <option value="long">长视频</option>
                    </select>
                  </label>
                </div>
                <button type="button" className="pvlist-create-btn" onClick={handleCreateVideo}>
                  + 新建视频
                </button>
              </div>
            </section>

            {loading ? (
              <div className="pvlist-empty">视频加载中...</div>
            ) : !pagedVideos.length ? (
              <div className="pvlist-empty">当前项目下还没有符合条件的视频</div>
            ) : (
              <section className="pvlist-grid" aria-label="项目视频列表">
                {pagedVideos.map((item) => (
                  <article className="pvlist-card" key={item.id}>
                    <div className="pvlist-card__media">
                      <button type="button" className="pvlist-card__cover" onClick={() => openDetail(item)}>
                        {item.coverUrl && !isVideoCover(item.coverUrl) ? (
                          <img src={item.coverUrl} alt={item.title} />
                        ) : item.videoUrl ? (
                          <video src={item.videoUrl} muted playsInline preload="metadata" />
                        ) : (
                          <span className="pvlist-card__placeholder">视频</span>
                        )}
                        <span className="pvlist-card__play">▶</span>
                        <span className="pvlist-card__duration">{formatVideoDuration(item.durationSeconds)}</span>
                      </button>
                      <div className="pvlist-card__menu-wrap">
                        <button
                          type="button"
                          className="pvlist-card__more"
                          aria-label="更多操作"
                          onClick={() => setOpenMenuId((prev) => (prev === item.id ? '' : item.id))}
                        >
                          ...
                        </button>
                        {openMenuId === item.id ? (
                          <div className="pvlist-card__menu">
                            <button type="button" onClick={() => openDetail(item)}>
                              查看详情
                            </button>
                            <button type="button" onClick={() => openEditor(item)}>
                              进入编辑
                            </button>
                            <button type="button" onClick={() => handlePublish(item)}>
                              标记发布
                            </button>
                            <button type="button" onClick={() => downloadVideo(item)}>
                              下载视频
                            </button>
                            <button type="button" className="is-danger" onClick={() => handleDelete(item)}>
                              删除视频
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="pvlist-card__body">
                      <button type="button" className="pvlist-card__title" onClick={() => openDetail(item)}>
                        {item.title}
                      </button>
                      <div className="pvlist-card__meta">
                        <span>{formatVideoDate(item.createdAt)}</span>
                        <span className="pvlist-card__meta-dot">·</span>
                        <span>{item.createdByName}</span>
                      </div>
                      <div className="pvlist-card__footer">
                        <span className="pvlist-card__updated">更新于 {formatVideoDate(item.updatedAt)}</span>
                        <span className={`pvlist-card__status is-${item.status}`}>
                          {getVideoStatusText(item.status)}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            )}

            <footer className="pvlist-pagination">
              <div className="pvlist-pagination__pages">
                <button type="button" disabled={safePage <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
                  ‹
                </button>
                {pageNumbers.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={item === safePage ? 'is-active' : ''}
                    onClick={() => setPage(item)}
                  >
                    {item}
                  </button>
                ))}
                {totalPages > pageNumbers[pageNumbers.length - 1] ? (
                  <span className="pvlist-pagination__ellipsis">...</span>
                ) : null}
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  ›
                </button>
              </div>
              <div className="pvlist-pagination__size">
                <span>{total} 条</span>
                <button type="button" className={pageSize === 20 ? 'is-active' : ''} onClick={() => setPageSize(20)}>
                  20
                </button>
                <span>/</span>
                <button type="button" className={pageSize === 50 ? 'is-active' : ''} onClick={() => setPageSize(50)}>
                  50
                </button>
                <span>/</span>
                <button type="button" className={pageSize === 100 ? 'is-active' : ''} onClick={() => setPageSize(100)}>
                  100
                </button>
                <span>条/页</span>
              </div>
            </footer>
          </div>
        </main>
      </div>
    </div>
  )
}
