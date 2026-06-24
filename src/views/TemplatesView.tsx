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
import { useRequireAuth } from '@/composables/useRequireAuth'
import { useAuth } from '@/auth/AuthContext'
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

  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [ratioFilter, setRatioFilter] = useState('')
  const [retry, setRetry] = useState(0)
  const [watching, setWatching] = useState<{ url: string; poster: string } | null>(null)

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
    setLoading(true)
    setError('')
    listTemplates({ workspaceId: wsId, limit: 200 })
      .then(({ items }) => {
        if (!cancelled) {
          setTemplates(items)
          if (!items.length) setError('empty')
        }
      })
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
    let list = templates.filter((t) => Boolean(t.videoUrl))
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
  }

  return (
    <div className="home">
      <AppSidebar activeKey="templates" onNavigate={onNavigate} />
      <div className="home__main">
        <header className="home__topbar templates-topbar">
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
              <div className="home__proj-waterfall">
                {filtered.map((tpl, i) => {
                  const span = (() => {
                    const r = (tpl.ratio || '').replace(/\s+/g, '')
                    if (r === '9/16' || r === '3/4' || r === '4/5') return 3
                    if (r === '1/1') return 4
                    if (r === '16/9') return 6
                    return 4
                  })()
                  return (
                    <div
                      key={tpl.id}
                      className="home__proj"
                      style={{ gridColumn: `span ${span}` }}
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
                      <div className="home__proj-thumb" style={{ aspectRatio: tpl.ratio || '9 / 16' }}>
                        <span className="home__proj-thumb-ph">🎬</span>
                        {tpl.videoUrl && (
                          <video
                            className="home__proj-video"
                            src={tpl.videoUrl}
                            muted
                            loop
                            playsInline
                            preload="none"
                            style={{ position: 'absolute', inset: 0, zIndex: 0 }}
                            onLoadedData={(e) => {
                              ;(e.currentTarget as HTMLVideoElement).play().catch(() => {})
                            }}
                            onError={(e) => {
                              ;(e.currentTarget as HTMLVideoElement).style.display = 'none'
                            }}
                          />
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
