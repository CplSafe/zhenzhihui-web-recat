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

  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [ratioFilter, setRatioFilter] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const wsId = Number(workspaceId || 0)
    const fetcher = wsId ? listTemplates({ workspaceId: wsId, limit: 200 }) : Promise.reject(new Error('无工作空间'))
    fetcher
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
  }, [workspaceId, retry])

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
              <div className="home__proj-grid">
                {filtered.map((tpl, i) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className="home__proj"
                    onClick={() => resolveProjectPath(tpl.id, Number(workspaceId || 0)).then((path) => navigate(path))}
                  >
                    <div className="home__proj-thumb" style={{ aspectRatio: tpl.ratio || '9 / 16' }}>
                      <video
                        className="home__proj-video"
                        src={tpl.videoUrl}
                        poster={tpl.thumbnailUrl && isSafeMediaUrl(tpl.thumbnailUrl) ? tpl.thumbnailUrl : undefined}
                        preload="metadata"
                        muted
                        playsInline
                        controls
                        crossOrigin="anonymous"
                        onClick={(e) => e.stopPropagation()}
                        onError={(e) => {
                          const el = e.currentTarget
                          el.style.display = 'none'
                          const poster = el.getAttribute('poster')
                          if (poster) {
                            const img = document.createElement('img')
                            img.src = poster
                            img.className = 'home__proj-img'
                            el.parentElement?.appendChild(img)
                          }
                        }}
                      />
                    </div>
                    <div className="home__proj-title">
                      <span className="home__proj-title-text" title={tpl.title}>
                        {tpl.title}
                      </span>
                      {tpl.ratio && <span className="home__proj-ratio">{tpl.ratio.replace(/\s*\/\s*/g, ':')}</span>}
                    </div>
                    <div className="home__proj-category">{tpl.style || '通用'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
