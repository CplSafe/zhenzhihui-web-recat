/**
 * 模板库页面（/templates）
 *
 * 页面职责：集中展示可预览、可复用的视频模板，并提供比例与关键词筛选。
 * 用户可见效果：模板按真实视频比例组成卡片网格，支持播放、下载、收藏、进入详情和“做同款”；
 * 页面会明确标记当前使用在线模板还是内置模板，并为加载中、空数据、失败重试提供对应状态。
 * 数据与隔离：收藏按工作空间保存；异步详情跳转会校验发起请求时的工作空间，避免切换空间后误入旧项目。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import { type TemplateItem } from '@/api/templates'
import { DEMO_TEMPLATES } from '@/data/demoTemplates'
import { loadTemplateCatalog, type TemplateCatalogSource } from '@/utils/templateCatalog'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { resolveProjectPath } from '@/utils/projectRoute'
import { favoriteKeyOf, loadFavoriteKeys, toggleFavorite } from '@/utils/favoriteVideos'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import VideoPreviewModal from '@/components/common/VideoPreviewModal'
import { downloadToDisk, buildDownloadName } from '@/utils/downloadToDisk'
import './HomeView.css'
import './TemplatesView.css'

// 仅展示目录中实际存在的比例；空字符串代表“全部”。
const RATIO_KEYS = ['', '9 / 16', '16 / 9', '4 / 5', '1 / 1', '3 / 4']
/** 比例筛选值对应的中文展示名称。 */
const RATIO_LABELS: Record<string, string> = {
  '': '全部',
  '9 / 16': '9:16',
  '16 / 9': '16:9',
  '4 / 5': '4:5',
  '1 / 1': '1:1',
  '3 / 4': '3:4',
}

/** 渲染模板筛选、卡片列表及预览/复用交互。 */
export default function TemplatesView() {
  const navigate = useNavigate()
  const workspaceId = useWorkspaceId()
  const currentUserId = resolveUserId(useCurrentUser())
  const requireAuth = useRequireAuth()

  // 模板目录状态：先用内置数据保证首屏有内容，再由共享目录加载器决定在线/内置来源。
  const [templates, setTemplates] = useState<TemplateItem[]>(DEMO_TEMPLATES)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [ratioFilter, setRatioFilter] = useState('')
  const [templateSource, setTemplateSource] = useState<TemplateCatalogSource>('builtin')
  const [templateNotice, setTemplateNotice] = useState('')
  const [retry, setRetry] = useState(0)
  // 移动端侧栏抽屉开关(<=900px)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [watching, setWatching] = useState<{ url: string; poster: string } | null>(null)
  // 两组引用分别防止异步详情解析跨工作空间生效，以及同一视频被连续点击重复下载。
  const workspaceIdRef = useRef(Number(workspaceId || 0))
  const openRequestRef = useRef<object | null>(null)
  const downloadingRef = useRef(new Set<string>())
  workspaceIdRef.current = Number(workspaceId || 0)

  // 用户或工作空间改变时，使上一个尚未完成的详情跳转失效。
  useEffect(() => {
    openRequestRef.current = null
  }, [currentUserId, workspaceId])

  // 收藏结果按工作空间保存在 localStorage，并同步显示到素材市场“我收藏的”。
  const [favKeys, setFavKeys] = useState<Set<string>>(new Set())
  useEffect(() => {
    setFavKeys(loadFavoriteKeys(Number(workspaceId || 0)))
  }, [currentUserId, workspaceId])
  const toggleFav = (tpl: TemplateItem) => {
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
    setFavKeys((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  // 先根据项目类型解析正确的详情路由；解析期间锁住重复点击，并拒绝旧工作空间的迟到结果。
  const openTemplate = (tpl: TemplateItem) => {
    if (openRequestRef.current) return
    const sourceWorkspaceId = Number(workspaceId || 0)
    const request = {}
    openRequestRef.current = request
    void resolveProjectPath(tpl.id, sourceWorkspaceId)
      .then((path) => {
        if (openRequestRef.current === request && workspaceIdRef.current === sourceWorkspaceId) navigate(path)
      })
      .catch(() => undefined)
      .finally(() => {
        if (openRequestRef.current === request) openRequestRef.current = null
      })
  }

  // 用模板与媒体标识组成下载锁，防止用户快速连点触发多个相同下载任务。
  const downloadTemplate = (tpl: TemplateItem) => {
    const key = `${tpl.id}:${tpl.videoAssetId || tpl.videoUrl}`
    if (downloadingRef.current.has(key)) return
    downloadingRef.current.add(key)
    void downloadToDisk({
      fileName: buildDownloadName(tpl.title || '视频', new Date()),
      resolveUrl: () => tpl.videoUrl,
    })
      .catch(() => undefined)
      .finally(() => downloadingRef.current.delete(key))
  }

  // 全应用共享一次远程探测；端点未开放时显式标注内置模板，不重复请求 404。
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    loadTemplateCatalog()
      .then((catalog) => {
        if (cancelled) return
        setTemplates(catalog.items)
        setTemplateSource(catalog.source)
        setTemplateNotice(catalog.notice)
        setError(catalog.items.length ? '' : 'empty')
      })
      .catch(() => {
        if (cancelled) return
        setTemplates([])
        setError('api')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [retry])

  const keywordTrim = keyword.trim()

  // 筛选顺序：先排除没有成片的记录，再叠加比例与标题关键词条件。
  const filtered = useMemo(() => {
    // 有视频(url 或 assetId)即展示;签名 URL 没换到的也显示(缩略图),与历史项目一致
    let list = templates.filter((t) => Boolean(t.videoUrl) || Boolean(t.videoAssetId))
    if (ratioFilter) list = list.filter((t) => t.ratio === ratioFilter)
    if (keywordTrim) list = list.filter((t) => t.title.includes(keywordTrim))
    return list
  }, [templates, ratioFilter, keywordTrim])

  // 根据当前目录动态生成比例按钮，避免出现点击后必为空的无效筛选项。
  const availableRatios = useMemo(() => {
    const seen = new Set<string>()
    templates.forEach((t) => seen.add(t.ratio))
    return RATIO_KEYS.filter((k) => k === '' || seen.has(k))
  }, [templates])

  const onNavigate = useSidebarNavigate()

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
          {/* 窄屏汉堡:唤出侧栏抽屉(桌面端 CSS 隐藏) */}
          <button type="button" className="templates-menu" onClick={() => setSidebarOpen(true)} aria-label="打开菜单">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="m11.666 12.669.135.013a.665.665 0 0 1 0 1.303l-.135.014H3.333a.665.665 0 0 1 0-1.33zm5-6.667.135.013a.665.665 0 0 1 0 1.303l-.135.014H3.333a.665.665 0 0 1 0-1.33z" />
            </svg>
          </button>
          <button type="button" className="templates-back" onClick={() => navigate('/home')} aria-label="返回首页">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h2 className="templates-page-title">模板库</h2>
          <span className="templates-count">共 {templates.length} 个模板</span>
          <span className={`templates-source is-${templateSource}`} title={templateNotice || '来自模板服务'}>
            {templateSource === 'builtin' ? '内置模板' : '在线模板'}
          </span>
        </header>
        <div className="home__content templates-content">
          {/* 比例筛选 + 搜索 */}
          <div className="home__tabs-bar">
            {availableRatios.length > 1 && (
              <div className="home__ratio-bar">
                {availableRatios.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`home__ratio-chip${ratioFilter === r ? ' is-active' : ''}`}
                    onClick={() => setRatioFilter(r)}
                  >
                    {RATIO_LABELS[r] || r}
                  </button>
                ))}
              </div>
            )}
            <div className="home__search" style={{ marginLeft: 'auto', maxWidth: 280 }}>
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="#909090"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索案例..."
              />
            </div>
          </div>

          {/* 卡片网格 — 历史项目样式 */}
          <div className="templates-grid-body">
            {loading ? (
              <div className="home__placeholder">加载中…</div>
            ) : error === 'unauth' ? (
              <div className="home__placeholder">
                请先登录后查看模板库
                <button type="button" className="home__retry-btn" onClick={() => navigate('/login')}>
                  去登录
                </button>
              </div>
            ) : error === 'api' ? (
              <div className="home__placeholder">
                案例加载失败
                <button type="button" className="home__retry-btn" onClick={() => setRetry((value) => value + 1)}>
                  重试
                </button>
              </div>
            ) : error === 'empty' || !filtered.length ? (
              <div className="home__placeholder">暂无案例数据</div>
            ) : (
              <div className="templates-grid">
                {filtered.map((tpl, i) => {
                  return (
                    <div
                      key={`${tpl.id}-${i}`}
                      className="home__proj templates-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => openTemplate(tpl)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') openTemplate(tpl)
                      }}
                    >
                      {/* 瀑布流缩略图:按视频真实比例(无真实比例时回退 16:10) */}
                      <div className="home__proj-thumb" style={{ aspectRatio: tpl.ratio || '16 / 10' }}>
                        <span className="home__proj-thumb-ph">🎬</span>
                        {tpl.duration ? <span className="tpl-dur">{Math.round(tpl.duration)}S</span> : null}
                        {tpl.videoUrl && (
                          <video
                            className="home__proj-video"
                            src={tpl.videoUrl}
                            autoPlay
                            muted
                            loop
                            playsInline
                            preload="metadata"
                            style={{ position: 'absolute', inset: 0, zIndex: 0 }}
                            onLoadedMetadata={(e) => {
                              // 卡片比例跟随视频真实宽高
                              const v = e.currentTarget
                              if (v.videoWidth && v.videoHeight) {
                                const thumb = v.closest('.home__proj-thumb') as HTMLElement | null
                                if (thumb) thumb.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`
                              }
                            }}
                            onError={(e) => {
                              ;(e.currentTarget as HTMLVideoElement).style.display = 'none'
                            }}
                          />
                        )}
                        {tpl.videoUrl && (
                          <button
                            type="button"
                            className={`home__tpl-fav${favKeys.has(favoriteKeyOf(tpl.videoAssetId || 0, tpl.videoUrl)) ? ' is-on' : ''}`}
                            aria-label="收藏"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleFav(tpl)
                            }}
                          >
                            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                              <path d="M12 20.3l-1.45-1.32C5.4 14.36 2 11.28 2 7.5 2 4.42 4.42 2 7.5 2c1.74 0 3.41.81 4.5 2.09C13.09 2.81 14.76 2 16.5 2 19.58 2 22 4.42 22 7.5c0 3.78-3.4 6.86-8.55 11.54L12 20.3z" />
                            </svg>
                          </button>
                        )}
                        <div className="home__proj-overlay">
                          <span className="home__proj-overlay-text">{tpl.title}</span>
                          {/* 卡片操作互相独立，均阻止冒泡，避免同时触发卡片的详情跳转。 */}
                          <div className="home__proj-actions">
                            <button
                              type="button"
                              className="home__proj-action-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                setWatching({ url: tpl.videoUrl, poster: tpl.thumbnailUrl || '' })
                              }}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                              播放
                            </button>
                            <button
                              type="button"
                              className="home__proj-action-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                downloadTemplate(tpl)
                              }}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                              </svg>
                              下载
                            </button>
                            <button
                              type="button"
                              className="home__proj-action-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                requireAuth(() =>
                                  navigate('/hot-copy', {
                                    state: { carryVideo: { url: tpl.videoUrl || '', assetId: tpl.videoAssetId || 0 } },
                                  }),
                                )
                              }}
                            >
                              做同款
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="home__proj-title">
                        <span className="home__proj-title-text" title={tpl.title}>
                          {tpl.title}
                        </span>
                        {tpl.ratio && <span className="home__proj-ratio">{tpl.ratio.replace(/\s*\/\s*/g, ':')}</span>}
                      </div>
                      <div className="home__proj-category">{tpl.style || '通用'}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 全屏视频播放弹窗(外链 OSS、无 CORS 头 → 不带 crossOrigin,否则卡 0:00) */}
      <VideoPreviewModal src={watching?.url || ''} poster={watching?.poster} onClose={() => setWatching(null)} />
    </div>
  )
}
