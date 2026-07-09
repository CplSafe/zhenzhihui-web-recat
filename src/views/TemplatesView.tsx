/**
 * 案例库页面 — 仅展示有生成视频的项目（listTemplates），
 * 卡片样式与首页历史项目统一（封面图 + 标题 + 比例 + 风格）。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import { type TemplateItem, listBackendTemplates } from '@/api/templates'
import { DEMO_TEMPLATES } from '@/data/demoTemplates'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { resolveProjectPath } from '@/utils/projectRoute'
import { favoriteKeyOf, loadFavoriteKeys, toggleFavorite } from '@/utils/favoriteVideos'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import VideoPreviewModal from '@/components/common/VideoPreviewModal'
import { downloadToDisk, buildDownloadName } from '@/utils/downloadToDisk'
import './HomeView.css'
import './TemplatesView.css'

const RATIO_KEYS = ['', '9 / 16', '16 / 9', '4 / 5', '1 / 1', '3 / 4']
const RATIO_LABELS: Record<string, string> = {
  '': '全部',
  '9 / 16': '9:16',
  '16 / 9': '16:9',
  '4 / 5': '4:5',
  '1 / 1': '1:1',
  '3 / 4': '3:4',
}

export default function TemplatesView() {
  const navigate = useNavigate()
  const workspaceId = useWorkspaceId()
  const requireAuth = useRequireAuth()

  const [templates, setTemplates] = useState<TemplateItem[]>(DEMO_TEMPLATES)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [ratioFilter, setRatioFilter] = useState('')
  const [retry, setRetry] = useState(0)
  // 移动端侧栏抽屉开关(<=900px)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [watching, setWatching] = useState<{ url: string; poster: string } | null>(null)

  // 模板收藏(localStorage 占位):收藏的视频进素材市场「我收藏的」
  const [favKeys, setFavKeys] = useState<Set<string>>(new Set())
  useEffect(() => {
    setFavKeys(loadFavoriteKeys(Number(workspaceId || 0)))
  }, [workspaceId])
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

  // 案例库拉后台配置的模板库(GET /api/v1/templates);为空/失败时用 demo 兜底。
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listBackendTemplates()
      .then((items) => {
        if (cancelled) return
        const list = items.length ? items : DEMO_TEMPLATES
        setTemplates(list)
        setError(list.length ? '' : 'empty')
      })
      .catch(() => {
        if (cancelled) return
        setTemplates(DEMO_TEMPLATES)
        setError(DEMO_TEMPLATES.length ? '' : 'empty')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [retry])

  const keywordTrim = keyword.trim()

  const filtered = useMemo(() => {
    // 有视频(url 或 assetId)即展示;签名 URL 没换到的也显示(缩略图),与历史项目一致
    let list = templates.filter((t) => Boolean(t.videoUrl) || Boolean(t.videoAssetId))
    if (ratioFilter) list = list.filter((t) => t.ratio === ratioFilter)
    if (keywordTrim) list = list.filter((t) => t.title.includes(keywordTrim))
    return list
  }, [templates, ratioFilter, keywordTrim])

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
                <button type="button" className="home__retry-btn" onClick={() => setRetry((n) => n + 1)}>
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
                      onClick={() =>
                        resolveProjectPath(tpl.id, Number(workspaceId || 0)).then((path) => navigate(path))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')
                          resolveProjectPath(tpl.id, Number(workspaceId || 0)).then((path) => navigate(path))
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
                              onClick={async (e) => {
                                e.stopPropagation()
                                await downloadToDisk({
                                  fileName: buildDownloadName(tpl.title || '视频', new Date()),
                                  resolveUrl: () => tpl.videoUrl,
                                }).catch(() => {})
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
