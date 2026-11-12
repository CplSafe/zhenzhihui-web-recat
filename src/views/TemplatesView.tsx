import { useEffect, useRef, useState } from 'react'
import { Modal } from 'antd'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { useAuth } from '@/auth/useAuth'
import {
  getLibraryTemplate,
  listLibraryCategories,
  listLibraryTemplates,
  type LibraryCategory,
  type LibraryTemplate,
} from '@/api/templateLibrary'
import './HomeView.css'
import './TemplatesView.css'

export default function TemplatesView() {
  const navigate = useNavigate()
  const onNavigate = useSidebarNavigate()
  const { isAuthenticated, isCheckingSession, authSession } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [categories, setCategories] = useState<LibraryCategory[]>([])
  const [categoryId, setCategoryId] = useState(0)
  const [items, setItems] = useState<LibraryTemplate[]>([])
  const [cursor, setCursor] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [moreError, setMoreError] = useState('')
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState<LibraryTemplate | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const listGeneration = useRef(0)
  const detailGeneration = useRef(0)
  const loadingMoreRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || isCheckingSession) return
    const controller = new AbortController()
    listLibraryCategories(controller.signal)
      .then(setCategories)
      .catch(() => {
        if (!controller.signal.aborted) setError('分类加载失败，请重试')
      })
    return () => controller.abort()
  }, [isAuthenticated, isCheckingSession, authSession, retry])

  useEffect(() => {
    const generation = ++listGeneration.current
    loadingMoreRef.current = false
    setLoadingMore(false)
    setItems([])
    setCursor('')
    setHasMore(false)
    setMoreError('')
    if (!isAuthenticated || isCheckingSession) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    listLibraryTemplates(categoryId, '', controller.signal)
      .then((page) => {
        if (generation !== listGeneration.current) return
        setItems(page.items)
        setCursor(page.nextCursor)
        setHasMore(page.hasMore)
      })
      .catch((err) => {
        if (controller.signal.aborted || generation !== listGeneration.current) return
        setError(err?.status === 401 ? '登录状态已失效，请重新登录' : '模板加载失败，请重试')
      })
      .finally(() => {
        if (generation === listGeneration.current) setLoading(false)
      })
    return () => controller.abort()
  }, [isAuthenticated, isCheckingSession, authSession, categoryId, retry])

  useEffect(() => {
    detailGeneration.current++
    setSelected(null)
    setDetailLoading(false)
    setDetailError('')
  }, [authSession])

  async function loadMore() {
    if (loadingMoreRef.current || !hasMore || !cursor) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setMoreError('')
    const generation = listGeneration.current
    try {
      const page = await listLibraryTemplates(categoryId, cursor)
      if (generation !== listGeneration.current) return
      setItems((previous) => [...previous, ...page.items.filter((item) => !previous.some((old) => old.id === item.id))])
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch {
      if (generation === listGeneration.current) setMoreError('加载更多失败，请重试')
    } finally {
      if (generation === listGeneration.current) {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }
  }

  async function openDetail(item: LibraryTemplate) {
    const generation = ++detailGeneration.current
    setSelected(item)
    setDetailLoading(true)
    setDetailError('')
    try {
      const detail = await getLibraryTemplate(item.id)
      if (generation === detailGeneration.current) setSelected(detail)
    } catch (err: any) {
      if (generation === detailGeneration.current)
        setDetailError(err?.status === 404 ? '模板已下架或不存在' : '详情加载失败，请重试')
    } finally {
      if (generation === detailGeneration.current) setDetailLoading(false)
    }
  }
  function closeDetail() {
    detailGeneration.current++
    setSelected(null)
    setDetailError('')
    setDetailLoading(false)
  }

  return (
    <div className="home">
      <AppSidebar
        activeKey="templates"
        onNavigate={onNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="home__main">
        <header className="home__topbar templates-topbar">
          <button type="button" className="templates-menu" onClick={() => setSidebarOpen(true)} aria-label="打开菜单">
            ☰
          </button>
          <button type="button" className="templates-back" onClick={() => navigate('/home')} aria-label="返回首页">
            ‹
          </button>
          <h1 className="templates-page-title">模板库</h1>
        </header>
        <main className="home__content templates-content">
          <p className="templates-intro">浏览精选模板，寻找创作灵感</p>
          {isAuthenticated && (
            <nav className="templates-categories" aria-label="模板分类">
              <button
                type="button"
                className={categoryId === 0 ? 'is-active' : ''}
                aria-pressed={categoryId === 0}
                onClick={() => setCategoryId(0)}
              >
                全部
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={categoryId === category.id ? 'is-active' : ''}
                  aria-pressed={categoryId === category.id}
                  onClick={() => setCategoryId(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </nav>
          )}
          <div className="templates-grid-body">
            {isCheckingSession || loading ? (
              <div className="home__placeholder" role="status">
                正在加载模板…
              </div>
            ) : !isAuthenticated ? (
              <div className="home__placeholder">
                登录后查看模板库
                <button
                  type="button"
                  className="home__retry-btn"
                  onClick={() => navigate('/login', { state: { returnTo: '/templates' } })}
                >
                  去登录
                </button>
              </div>
            ) : error ? (
              <div className="home__placeholder" role="alert">
                {error}
                {error === '登录状态已失效，请重新登录' ? (
                  <button
                    type="button"
                    className="home__retry-btn"
                    onClick={() => navigate('/login', { state: { returnTo: '/templates' } })}
                  >
                    去登录
                  </button>
                ) : (
                  <button type="button" className="home__retry-btn" onClick={() => setRetry((v) => v + 1)}>
                    重试
                  </button>
                )}
              </div>
            ) : !items.length ? (
              <div className="home__placeholder">暂无模板</div>
            ) : (
              <>
                <div className="library-grid">
                  {items.map((item) => (
                    <button type="button" className="library-card" key={item.id} onClick={() => void openDetail(item)}>
                      <span className="library-cover">
                        {item.coverUrl ? (
                          <img src={item.coverUrl} alt="" loading="lazy" />
                        ) : item.mediaType === 'image' && item.mediaUrl ? (
                          <img src={item.mediaUrl} alt="" loading="lazy" />
                        ) : (
                          <span>暂无预览</span>
                        )}
                        <span className="library-type">
                          {item.mediaType === 'video' ? '视频' : item.mediaType === 'image' ? '图片' : '素材'}
                        </span>
                      </span>
                      <span className="library-card-title">{item.title}</span>
                      <span className="library-card-description">{item.description || '查看模板详情'}</span>
                    </button>
                  ))}
                </div>
                {moreError && (
                  <p className="library-more-error" role="alert">
                    {moreError}
                  </p>
                )}
                {hasMore && (
                  <div className="library-more">
                    <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
                      {loadingMore ? '加载中…' : moreError ? '重试加载' : '加载更多'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
      <Modal
        open={Boolean(selected)}
        title={selected?.title || '模板详情'}
        footer={null}
        onCancel={closeDetail}
        destroyOnHidden
        width={760}
      >
        {detailLoading ? (
          <p role="status">正在加载详情…</p>
        ) : detailError ? (
          <div role="alert">
            {detailError}
            {selected && (
              <button type="button" className="home__retry-btn" onClick={() => void openDetail(selected)}>
                重试
              </button>
            )}
          </div>
        ) : (
          selected && (
            <div className="library-detail">
              {selected.mediaUrl && selected.mediaType === 'video' ? (
                <video
                  controls
                  playsInline
                  preload="metadata"
                  poster={selected.coverUrl || undefined}
                  src={selected.mediaUrl}
                />
              ) : selected.mediaUrl && selected.mediaType === 'image' ? (
                <img src={selected.mediaUrl} alt={selected.title} />
              ) : (
                <p>暂无可预览的素材</p>
              )}
              {selected.description && <p>{selected.description}</p>}
            </div>
          )
        )}
      </Modal>
    </div>
  )
}
