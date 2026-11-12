import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from 'antd'
import { ArrowLeft, ArrowUpRight, Image as ImageIcon, Menu, Play } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import { TemplateCard } from '@/components/hotcopy/HotCopyShowcase/HotCopyTemplateGallery'
import VideoPreviewModal from '@/components/common/VideoPreviewModal'
import { type TemplateItem } from '@/api/templates'
import { loadTemplateCatalog, type TemplateCatalog } from '@/utils/templateCatalog'
import { builtinIndustryCode, FALLBACK_INDUSTRIES } from '@/utils/templateIndustries'
import { favoriteKeyOf, loadFavoriteKeys, toggleFavorite } from '@/utils/favoriteVideos'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
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
  const workspaceId = useWorkspaceId()
  const currentUserId = resolveUserId(useCurrentUser())
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null)
  const [favKeys, setFavKeys] = useState<Set<string>>(new Set())
  const [watching, setWatching] = useState<{ url: string; poster: string } | null>(null)
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
  const [categoryError, setCategoryError] = useState('')
  const [moreError, setMoreError] = useState('')
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState<LibraryTemplate | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const listGeneration = useRef(0)
  const detailGeneration = useRef(0)
  const loadingMoreRef = useRef(false)

  useEffect(() => {
    setFavKeys(loadFavoriteKeys(Number(workspaceId || 0)))
  }, [currentUserId, workspaceId])

  useEffect(() => {
    let cancelled = false
    setCatalog(null)
    if (isAuthenticated && !isCheckingSession) {
      void loadTemplateCatalog().then((result) => {
        if (!cancelled) setCatalog(result)
      })
    }
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isCheckingSession, authSession])

  const toggleFav = useCallback(
    (tpl: TemplateItem) => {
      const wsId = Number(workspaceId || 0)
      if (!wsId) return
      const key = favoriteKeyOf(tpl.videoAssetId || 0, tpl.videoUrl)
      const on = toggleFavorite(wsId, {
        key,
        title: tpl.title || '未命名视频',
        videoUrl: tpl.videoUrl || '',
        thumbnailUrl: tpl.thumbnailUrl || '',
        ratio: tpl.ratio || '',
        ts: Date.now(),
      })
      setFavKeys((previous) => {
        const next = new Set(previous)
        if (on) next.add(key)
        else next.delete(key)
        return next
      })
    },
    [workspaceId],
  )
  const preview = useCallback((url: string, poster: string) => setWatching({ url, poster }), [])
  const useTemplate = useCallback(
    (template: TemplateItem) =>
      navigate('/hot-copy', {
        state: {
          carryVideo: { url: template.videoUrl, assetId: template.videoAssetId },
          carryPrompt: template.prompt || '',
        },
      }),
    [navigate],
  )

  useEffect(() => {
    if (!isAuthenticated || isCheckingSession) return
    const controller = new AbortController()
    setCategoryError('')
    listLibraryCategories(controller.signal)
      .then(setCategories)
      .catch(() => {
        if (!controller.signal.aborted) setCategoryError('分类加载失败，请重试')
      })
    return () => controller.abort()
  }, [isAuthenticated, isCheckingSession, authSession, retry])

  useEffect(() => {
    if (categoryId >= 0) return
    const fallback = FALLBACK_INDUSTRIES.find((industry) => industry.id === categoryId)
    const actual = categories.find((category) => category.code === fallback?.code || category.name === fallback?.name)
    if (actual) setCategoryId(actual.id)
    else if (categories.length) setCategoryId(0)
  }, [categories, categoryId])

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
    setError('')
    if (categoryId < 0) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
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

  const displayCategories = categories.length ? categories : FALLBACK_INDUSTRIES
  const activeCategory = displayCategories.find((category) => category.id === categoryId)
  const existingIds = new Set(items.map((item) => item.id))
  const catalogItems = (catalog?.items || []).filter((item) => {
    if (catalog?.source === 'backend' && existingIds.has(item.id)) return false
    if (categoryId === 0) return true
    const code =
      activeCategory?.code || FALLBACK_INDUSTRIES.find((industry) => industry.name === activeCategory?.name)?.code
    if (catalog?.source === 'builtin') return builtinIndustryCode(item.id) === code
    return item.categoryId === categoryId || Boolean(item.industryCode && code === item.industryCode)
  })

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
            <Menu size={20} aria-hidden="true" />
          </button>
          <button type="button" className="templates-back" onClick={() => navigate('/home')} aria-label="返回首页">
            <ArrowLeft size={19} aria-hidden="true" />
          </button>
          <h1 className="templates-page-title">模板库</h1>
        </header>
        <main className="home__content templates-content">
          <div className="templates-heading">
            <div>
              <h2>发现创作灵感</h2>
              <p className="templates-intro">浏览图片与视频模板，找到下一次创作的灵感。</p>
            </div>
          </div>
          {categoryError && isAuthenticated && (
            <div className="library-category-error" role="alert">
              {categoryError}
              <button type="button" onClick={() => setRetry((v) => v + 1)}>
                重试
              </button>
            </div>
          )}
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
              {displayCategories.map((category) => (
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
            ) : !items.length && !catalogItems.length ? (
              <div className={`home__placeholder${categoryId === 0 ? ' templates-library-empty' : ''}`}>暂无模板</div>
            ) : (
              <>
                <div className="library-section-heading">
                  <h3>{categoryId === 0 ? '全部模板' : activeCategory?.name || '模板'}</h3>
                  <span>点击卡片查看详情</span>
                </div>
                <div className="library-grid">
                  {items.map((item) => (
                    <button type="button" className="library-card" key={item.id} onClick={() => void openDetail(item)}>
                      <span className="library-cover">
                        <span className="library-media">
                          {item.coverUrl ? (
                            <img src={item.coverUrl} alt="" loading="lazy" />
                          ) : item.mediaType === 'image' && item.mediaUrl ? (
                            <img src={item.mediaUrl} alt="" loading="lazy" />
                          ) : (
                            <span>暂无预览</span>
                          )}
                          <span className="library-type">
                            {item.mediaType === 'video' ? (
                              <Play size={12} fill="currentColor" />
                            ) : (
                              <ImageIcon size={13} />
                            )}
                            {item.mediaType === 'video' ? '视频' : item.mediaType === 'image' ? '图片' : '素材'}
                          </span>
                        </span>
                        <span className="library-card-copy">
                          <span className="library-card-title">{item.title}</span>
                          <span className="library-card-description">{item.description || '查看模板详情'}</span>
                          <span className="library-card-action">
                            查看详情 <ArrowUpRight size={15} aria-hidden="true" />
                          </span>
                        </span>
                      </span>
                    </button>
                  ))}
                  {catalogItems.map((tpl, index) => (
                    <div className="library-hotcopy-card" key={`hotcopy-${tpl.id}-${index}`}>
                      <TemplateCard
                        tpl={tpl}
                        favorite={favKeys.has(favoriteKeyOf(tpl.videoAssetId || 0, tpl.videoUrl))}
                        onPreview={preview}
                        onToggleFavorite={toggleFav}
                        onUseTemplate={useTemplate}
                      />
                      {catalog?.source !== 'builtin' && tpl.title && (
                        <span className="library-hotcopy-title">{tpl.title}</span>
                      )}
                    </div>
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
      <VideoPreviewModal src={watching?.url || ''} poster={watching?.poster} onClose={() => setWatching(null)} />
      <Modal
        open={Boolean(selected)}
        title={selected?.title || '模板详情'}
        footer={null}
        onCancel={closeDetail}
        destroyOnHidden
        width={760}
        className="library-modal"
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
              {selected.mediaType === 'video' && selected.mediaUrl && (
                <button
                  type="button"
                  className="library-use-template"
                  onClick={() => navigate('/hot-copy', { state: { carryVideo: { url: selected.mediaUrl } } })}
                >
                  做同款
                </button>
              )}
            </div>
          )
        )}
      </Modal>
    </div>
  )
}
