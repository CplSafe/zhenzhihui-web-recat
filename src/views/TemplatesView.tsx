/**
 * 模板库页面 — 仅展示有生成视频的项目（listTemplates），
 * 卡片样式与首页历史项目统一（封面图 + 标题 + 比例 + 风格）。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import { listTemplates, type TemplateItem } from '@/api/templates'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { resolveProjectPath } from '@/utils/projectRoute'
import { isSafeMediaUrl } from '@/utils/urlSafety'
import { favoriteKeyOf, loadFavoriteKeys, toggleFavorite } from '@/utils/favoriteVideos'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { openComingSoon } from '@/stores/ui'
import { useAuth } from '@/auth/AuthContext'
// 列表走 SWR 缓存(按 workspace,先返缓存秒出、后台刷新);加载后预热首屏视频首帧,见下方接入处。
import { swrFetch, peekCache } from '@/utils/swrCache'
import { preloadMedia, type MediaItem } from '@/utils/mediaPreload'
import './HomeView.css'
import './TemplatesView.css'

/** 模板库列表的 SWR 缓存键(按 workspace 区分) */
const templatesCacheKey = (workspaceId: number) => `templates:${workspaceId}`
/** 加载后预热首屏的卡片视频首帧数量(只热前几个,避免一次拉太多) */
const PRELOAD_FIRSTSCREEN_COUNT = 8

const RATIO_KEYS = ['', '9 / 16', '16 / 9', '4 / 5', '1 / 1', '3 / 4']
const RATIO_LABELS: Record<string, string> = {
  '': '全部',
  '9 / 16': '9:16',
  '16 / 9': '16:9',
  '4 / 5': '4:5',
  '1 / 1': '1:1',
  '3 / 4': '3:4',
}

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

export default function TemplatesView() {
  const navigate = useNavigate()
  const workspaceId = useWorkspaceId()
  const requireAuth = useRequireAuth()
  const { isAuthenticated } = useAuth()

  // 初始值从缓存秒出(再进模板库不闪空、不重拉);无缓存为空数组。
  const [templates, setTemplates] = useState<TemplateItem[]>(
    () => peekCache<TemplateItem[]>(templatesCacheKey(Number(workspaceId || 0))) ?? [],
  )
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

  useEffect(() => {
    const wsId = Number(workspaceId || 0)
    if (!wsId) return
    if (!isAuthenticated) {
      setTemplates([])
      setLoading(false)
      setError('unauth')
      return
    }
    let cancelled = false
    const cacheKey = templatesCacheKey(wsId)
    // 有缓存就先用缓存(initial state 已秒出),不显示「加载中」;无缓存才转圈。
    const hasCache = peekCache<TemplateItem[]>(cacheKey) !== undefined
    setLoading(!hasCache)
    setError('')

    // 列表走 SWR:有缓存立即用缓存,后台静默刷新;新数据回来再更新。
    // 「重试」按钮通过 retry 变化触发本 effect;若需强制绕过缓存可在此 invalidate(当前后台刷新已足够)。
    const applyItems = (items: TemplateItem[]) => {
      if (cancelled) return
      setTemplates(items)
      setError(items.length ? '' : 'empty')
      // 加载完成后预热首屏前几张卡片的视频首帧,滚动/播放更顺(幂等、并发限流)。
      const targets: MediaItem[] = items
        .filter((t) => Boolean(t.videoUrl))
        .slice(0, PRELOAD_FIRSTSCREEN_COUNT)
        .map((t) => ({ url: t.videoUrl, type: 'video' as const }))
      if (targets.length) preloadMedia(targets)
    }

    swrFetch(cacheKey, () => listTemplates({ workspaceId: wsId, limit: 200 }).then((r) => r.items), {
      ttl: 5 * 60_000,
      onRevalidate: applyItems, // 后台刷新到的最新列表
    })
      .then(({ data }) => applyItems(data))
      .catch(() => {
        if (!cancelled) setError('api')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, isAuthenticated, retry])

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

  const onNavigate = (key: string) => {
    const path = ROUTE_MAP[key]
    if (path) navigate(path)
    else openComingSoon() // 设置等未上线项:弹全局「功能待开放」弹窗
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
                placeholder="搜索模板..."
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
                模板加载失败
                <button type="button" className="home__retry-btn" onClick={() => setRetry((n) => n + 1)}>
                  重试
                </button>
              </div>
            ) : error === 'empty' || !filtered.length ? (
              <div className="home__placeholder">暂无模板数据</div>
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
                      {/* 统一横向缩略图(对标 Figma 网格) */}
                      <div className="home__proj-thumb" style={{ aspectRatio: '16 / 10' }}>
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
                                try {
                                  const res = await fetch(tpl.videoUrl)
                                  const blob = await res.blob()
                                  const url = URL.createObjectURL(blob)
                                  const a = document.createElement('a')
                                  a.href = url
                                  a.download = `${tpl.title || '视频'}.mp4`
                                  document.body.appendChild(a)
                                  a.click()
                                  document.body.removeChild(a)
                                  URL.revokeObjectURL(url)
                                } catch {
                                  window.open(tpl.videoUrl, '_blank')
                                }
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
                                requireAuth(() => navigate('/hot-copy'))
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

      {/* 全屏视频播放弹窗 */}
      {watching && (
        <div className="home__video-modal-mask" onClick={() => setWatching(null)}>
          <div className="home__video-modal" onClick={(e) => e.stopPropagation()}>
            <button className="home__video-modal-close" onClick={() => setWatching(null)}>
              ✕
            </button>
            <video
              className="home__video-modal-player"
              src={watching.url}
              poster={watching.poster || undefined}
              controls
              autoPlay
              playsInline
              crossOrigin="anonymous"
            />
          </div>
        </div>
      )}
    </div>
  )
}
