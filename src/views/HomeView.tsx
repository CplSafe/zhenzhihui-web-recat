/**
 * 2.1 首页（自包含静态实现，纯前端占位数据，不接后端）。
 * 组合 <AppSidebar/> + 内容区：简洁顶栏 / 轮播 Banner / 快捷入口 / 标签切换 + 搜索 / 模板网格。
 * 导航跳转用 react-router useNavigate；已存在路由直接跳转，未实现的项 console 占位。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { resolveProjectPath } from '@/utils/projectRoute'
import { listCreativeProjects } from '@/api/business'
import { isSafeMediaUrl } from '@/utils/urlSafety'
import bannerLeft from '@/assets/home/banner-left.png'
import bannerRight from '@/assets/home/banner-right.png'
import quick1 from '@/assets/home/quick-1.png'
import quick2 from '@/assets/home/quick-2.png'
import quick3 from '@/assets/home/quick-3.png'
import quick4 from '@/assets/home/quick-4.png'
import './HomeView.css'

/* 从项目记录里取标题 / 封面 / id（字段名后端不统一，做兜底） */
function projectTitle(p: any): string {
  return String(p?.title || p?.name || p?.project_name || '').trim() || '未命名项目'
}
function projectId(p: any): number {
  return Number(p?.id || p?.project_id || p?.projectId || 0)
}

/* 工具：JSON 解析 / 数组标准化 / 图片 URL 提取 */
function toPlainObject(value: any): any {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return null
}
function normalizeArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}
function imgOf(value: any): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  return String(
    value.src ||
      value.url ||
      value.image ||
      value.imageUrl ||
      value.image_url ||
      value.thumbnailUrl ||
      value.thumbnail_url ||
      '',
  ).trim()
}

/* 从项目草稿（draft_json）中提取第一张生成图片作为封面 */
function extractDraftPreview(p: any): string {
  const draft = toPlainObject(p?.draft_json) || toPlainObject(p?.draftJson) || toPlainObject(p?.draft)
  if (!draft) return ''
  const smart = draft?.smart && typeof draft.smart === 'object' ? draft.smart : draft

  // ① 用户上传入口素材
  const em = smart?.entryMeta || {}
  const imgs = normalizeArray(em.images)
  for (const u of imgs) {
    const url = String(u || '').trim()
    if (url) return url
  }

  // ② 分镜图 / 元素图
  for (const s of normalizeArray(smart?.shots)) {
    // 分镜图
    const shotUrl = imgOf(s.image ? { url: s.image } : s)
    if (shotUrl) return shotUrl
    // 元素（素材主体）
    for (const su of normalizeArray(s.subjects)) {
      const suUrl = imgOf(su.image ? { url: su.image } : su)
      if (suUrl) return suUrl
    }
  }

  // 旧版 2.0 分步创作: storyboardItems
  for (const si of normalizeArray(draft?.storyboardItems)) {
    const url = imgOf(si.currentImage ? { url: si.currentImage } : si)
    if (url) return url
  }

  return ''
}

function projectCover(p: any): string {
  // 优先使用列表返回的封面/缩略图字段
  const direct = p?.thumbnailUrl || p?.thumbnail_url || p?.coverUrl || p?.cover_url || p?.cover || ''
  if (direct && isSafeMediaUrl(direct)) return direct
  // 兜底：从草稿中提取生成图
  const draftUrl = extractDraftPreview(p)
  return isSafeMediaUrl(draftUrl) ? draftUrl : ''
}

/* 从草稿里提取视频 URL（videoVersions / generatedVideo / fullVideoUrl） */
function extractVideoUrl(p: any): string {
  const draft = toPlainObject(p?.draft_json) || toPlainObject(p?.draftJson) || toPlainObject(p?.draft)
  if (!draft) return ''
  const smart = draft?.smart && typeof draft.smart === 'object' ? draft.smart : draft
  // videoVersions
  const vv = normalizeArray(smart?.videoVersions || draft?.videoVersions)
  for (const v of vv) {
    const url = imgOf(v)
    if (url && isSafeMediaUrl(url)) return url
  }
  // generatedVideo / fullVideoUrl
  const gv =
    draft?.generatedVideoUrl ||
    draft?.generated_video_url ||
    smart?.fullVideoUrl ||
    smart?.full_video_url ||
    smart?.generatedVideoUrl ||
    smart?.generated_video_url ||
    ''
  if (gv && isSafeMediaUrl(gv)) return gv
  // videoHistoryList
  const vh = normalizeArray(draft?.videoHistoryList || draft?.video_history_list)
  for (const v of vh) {
    const url = imgOf(v)
    if (url && isSafeMediaUrl(url)) return url
  }
  return ''
}

/* 从草稿里提取视频比例 */
function projectRatio(p: any): string {
  const draft = toPlainObject(p?.draft_json) || toPlainObject(p?.draftJson) || toPlainObject(p?.draft)
  if (!draft) return ''
  const smart = draft?.smart && typeof draft.smart === 'object' ? draft.smart : draft
  return String(smart?.entryMeta?.ratio || smart?.entry_meta?.ratio || draft?.selectedRatio || '').trim()
}

/* 侧栏 / 快捷入口 key → 路由映射（已存在的路由）*/
const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

/* 轮播 Banner（占位多条;后端接入后替换 left/right 为视频/图、并补真实文案与跳转） */
const BANNERS = [
  {
    id: 0,
    left: bannerLeft,
    right: bannerRight,
    pre: '新手',
    em: '快速入门',
    post: '指南',
    sub: '从零开始，在 3 分钟内生成您的第一条 AI 大片',
    btn: '立即开启体验',
    action: 'tutorial',
  },
  {
    id: 1,
    left: bannerRight,
    right: bannerLeft,
    pre: '海量',
    em: '爆款模板',
    post: '随心选',
    sub: '一键复制热门同款，创作效率翻倍',
    btn: '去逛模板库',
    action: 'templates',
  },
  {
    id: 2,
    left: bannerLeft,
    right: bannerRight,
    pre: 'AI',
    em: '智能成片',
    post: '秒出大片',
    sub: '输入灵感或上传素材，自动生成高质量广告视频',
    btn: '立即体验',
    action: 'creative',
  },
]

/* 快捷入口 4 卡（图标为 Figma 导出）*/
const QUICK_ENTRIES = [
  {
    key: 'creative',
    title: '智能成片',
    desc: '输入灵感，秒出大片',
    icon: quick1,
    grad: 'linear-gradient(135deg, #e6fbf4, #f4fffc)',
  },
  {
    key: 'hot-copy',
    title: '爆款复制',
    desc: '海量爆款，生成同款',
    icon: quick2,
    grad: 'linear-gradient(135deg, #e3f9f1, #f2fffb)',
  },
  {
    key: 'hot-split',
    title: '爆款裂变',
    desc: '一个爆款，裂变出N个',
    icon: quick3,
    grad: 'linear-gradient(135deg, #e6fbf4, #f4fffc)',
  },
  {
    key: 'ip-video',
    title: 'IP视频',
    desc: '打造出属于你的个人IP',
    icon: quick4,
    grad: 'linear-gradient(135deg, #e3f9f1, #f2fffb)',
  },
]

import { listTemplates, type TemplateItem } from '@/api/templates'

const RATIO_LABELS: Record<string, string> = {
  '': '全部',
  '9 / 16': '9:16',
  '16 / 9': '16:9',
  '4 / 5': '4:5',
  '1 / 1': '1:1',
  '3 / 4': '3:4',
}
const RATIO_KEYS = Object.keys(RATIO_LABELS)

const TABS = [
  { key: 'template', label: '模板库' },
  { key: 'history', label: '历史项目' },
  { key: 'ip', label: 'IP' },
] as const

export default function HomeView() {
  const navigate = useNavigate()
  const workspaceId = useWorkspaceId()
  const [bannerIndex, setBannerIndex] = useState(0)
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['key']>('template')
  const [keyword, setKeyword] = useState('')
  const [comingSoonOpen, setComingSoonOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // 历史项目（接后端 listCreativeProjects）
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')

  // 模板库（接后端 listTemplates，失败回退 mock）
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([])
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateError, setTemplateError] = useState('')
  const [ratioFilter, setRatioFilter] = useState('')
  const [templateRetry, setTemplateRetry] = useState(0)

  useEffect(() => {
    if (activeTab !== 'template') return
    let cancelled = false
    setTemplateLoading(true)
    setTemplateError('')
    const wsId = Number(workspaceId || 0)
    const fetcher = wsId ? listTemplates({ workspaceId: wsId, limit: 24 }) : Promise.reject(new Error('无工作空间'))
    fetcher
      .then(({ items }) => {
        if (!cancelled) {
          setTemplateItems(items.length ? items : [])
          setTemplateError(items.length ? '' : 'empty')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTemplateError('api')
        }
      })
      .finally(() => {
        if (!cancelled) setTemplateLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, workspaceId, templateRetry])

  const keywordTrim = keyword.trim()

  // 按比例和关键词过滤模板
  const filteredTemplates = useMemo(() => {
    let list = templateItems
    if (ratioFilter) list = list.filter((t) => t.ratio === ratioFilter)
    if (keywordTrim) list = list.filter((t) => t.title.includes(keywordTrim))
    return list
  }, [templateItems, ratioFilter, keywordTrim])

  // 模板中出现的比例选项（动态生成筛选栏）
  const availableRatios = useMemo(() => {
    const seen = new Set<string>()
    templateItems.forEach((t) => seen.add(t.ratio))
    return RATIO_KEYS.filter((k) => k === '' || seen.has(k))
  }, [templateItems])

  // 切到「历史项目」标签且有工作空间时拉取真实项目（首次/切空间时）。
  useEffect(() => {
    if (activeTab !== 'history') return
    const wsId = Number(workspaceId || 0)
    if (!wsId) return
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError('')
    listCreativeProjects({ workspaceId: wsId, limit: 50 })
      .then((items: any) => {
        if (!cancelled) {
          const list = Array.isArray(items) ? items : []
          // 仅保留有生成视频的项目
          setHistoryItems(list.filter((p: any) => Boolean(extractVideoUrl(p))))
        }
      })
      .catch(() => {
        if (!cancelled) setHistoryError('历史项目加载失败')
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, workspaceId])

  const filteredHistory = useMemo(() => {
    if (!keywordTrim) return historyItems
    return historyItems.filter((p) => projectTitle(p).includes(keywordTrim))
  }, [historyItems, keywordTrim])

  const handleNavigate = (key: string) => {
    const path = ROUTE_MAP[key]
    if (path) {
      navigate(path)
    } else {
      // 未实现的功能（爆款裂变 / IP视频 / 爆款复制 等）：弹「功能待开放」
      setComingSoonOpen(true)
    }
  }

  // coverflow 旋转:按右箭头 → 整体右移(左→中、中→右、新卡从左进) ⇒ 中心索引 -1;左箭头相反
  const rotateRight = () => setBannerIndex((i) => (i - 1 + BANNERS.length) % BANNERS.length)
  const rotateLeft = () => setBannerIndex((i) => (i + 1) % BANNERS.length)

  // Banner 自动轮播(与右箭头同向)
  useEffect(() => {
    const t = window.setInterval(() => setBannerIndex((i) => (i - 1 + BANNERS.length) % BANNERS.length), 6000)
    return () => window.clearInterval(t)
  }, [])

  return (
    <div className="home">
      <AppSidebar
        activeKey="home"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="home__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} onMember={() => setComingSoonOpen(true)} />

        <div className="home__content">
          {/* 轮播 Banner:coverflow(中/左/右三屏),箭头/圆点旋转,自动播放;后端接入后传多条 */}
          <section className="home__banner">
            <div className="home__banner-stage">
              {BANNERS.map((b, i) => {
                let rel = i - bannerIndex
                if (rel > BANNERS.length / 2) rel -= BANNERS.length
                if (rel < -BANNERS.length / 2) rel += BANNERS.length
                const pos = rel === 0 ? 'center' : rel === -1 ? 'left' : rel === 1 ? 'right' : 'hidden'
                return (
                  <div className={`home__banner-slide is-${pos}`} key={b.id} aria-hidden={pos !== 'center'}>
                    <img className="home__banner-photo home__banner-photo--left" src={b.left} alt="" />
                    <img className="home__banner-photo home__banner-photo--right" src={b.right} alt="" />
                    <div className="home__banner-card">
                      <h2 className="home__banner-title">
                        {b.pre}
                        <span className="home__banner-em">{b.em}</span>
                        {b.post}
                      </h2>
                      <p className="home__banner-sub">{b.sub}</p>
                      <button type="button" className="home__banner-btn" onClick={() => handleNavigate(b.action)}>
                        {b.btn}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              className="home__banner-arrow home__banner-arrow--left"
              onClick={rotateLeft}
              aria-label="上一张"
            >
              ‹
            </button>
            <button
              type="button"
              className="home__banner-arrow home__banner-arrow--right"
              onClick={rotateRight}
              aria-label="下一张"
            >
              ›
            </button>
          </section>
          <div className="home__banner-dots">
            {BANNERS.map((b, i) => (
              <button
                key={b.id}
                type="button"
                className={`home__dot${i === bannerIndex ? ' is-active' : ''}`}
                onClick={() => setBannerIndex(i)}
                aria-label={`第 ${i + 1} 张`}
              />
            ))}
          </div>

          {/* 快捷入口 */}
          <section className="home__section">
            <div className="home__section-head">
              <h3 className="home__section-title">快捷入口</h3>
            </div>
            <div className="home__quick-grid">
              {QUICK_ENTRIES.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  className="home__quick-card"
                  style={{ background: q.grad }}
                  onClick={() => handleNavigate(q.key)}
                >
                  <div className="home__quick-text">
                    <div className="home__quick-title">{q.title}</div>
                    <div className="home__quick-desc">{q.desc}</div>
                  </div>
                  <div className="home__quick-icon">
                    <img src={q.icon} alt="" />
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* 标签 + 比例筛选 + 搜索 */}
          <section className="home__section home__section--grow">
            <div className="home__tabs-bar">
              <div className="home__tabs">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`home__tab${activeTab === t.key ? ' is-active' : ''}`}
                    onClick={() => setActiveTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {/* 比例筛选 — 仅模板 tab 显示，与 tabs 同行 */}
              {activeTab === 'template' && availableRatios.length > 1 && (
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
              <div className="home__search">
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
                  placeholder="搜索模板、项目、IP..."
                />
              </div>
              {/* 模板/历史 tab 均可查看更多 → 模板库 */}
              {(activeTab === 'template' || activeTab === 'history') && (
                <div className="home__more">
                  <button type="button" className="home__more-btn" onClick={() => navigate('/templates')}>
                    查看更多 →
                  </button>
                </div>
              )}
            </div>

            {/* 内容框:模板库/历史项目/IP */}
            <div className="home__tab-box">
              {activeTab === 'history' ? (
                historyLoading ? (
                  <div className="home__placeholder">加载中…</div>
                ) : historyError ? (
                  <div className="home__placeholder">{historyError}</div>
                ) : filteredHistory.length ? (
                  <div className="home__proj-waterfall">
                    {filteredHistory.map((p) => {
                      const id = projectId(p)
                      const cover = projectCover(p)
                      const videoUrl = extractVideoUrl(p)
                      const ratio = projectRatio(p)
                      return (
                        <button
                          key={id || projectTitle(p)}
                          type="button"
                          className="home__proj"
                          onClick={() =>
                            id && resolveProjectPath(id, Number(workspaceId || 0)).then((path) => navigate(path))
                          }
                        >
                          <div className="home__proj-thumb" style={{ aspectRatio: ratio || '9 / 16' }}>
                            <video
                              className="home__proj-video"
                              src={videoUrl}
                              poster={cover || undefined}
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
                            <span className="home__proj-title-text" title={projectTitle(p)}>
                              {projectTitle(p)}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="home__placeholder">暂无生成视频</div>
                )
              ) : activeTab === 'ip' ? (
                <div className="home__placeholder">IP 功能敬请期待</div>
              ) : templateLoading ? (
                <div className="home__tpl-skeleton">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="home__tpl-skel"
                      style={{ aspectRatio: i % 3 === 0 ? '9 / 16' : i % 3 === 1 ? '16 / 9' : '4 / 5' }}
                    />
                  ))}
                </div>
              ) : templateError === 'api' ? (
                <div className="home__placeholder">
                  模板加载失败
                  <button type="button" className="home__retry-btn" onClick={() => setTemplateRetry((n) => n + 1)}>
                    重试
                  </button>
                </div>
              ) : templateError === 'empty' || !filteredTemplates.length ? (
                <div className="home__placeholder">暂无模板数据</div>
              ) : (
                <>
                  <div className="home__masonry">
                    {filteredTemplates.map((tpl) => (
                      <div key={tpl.id} className="home__tpl">
                        <div
                          className={`home__tpl-thumb${tpl.thumbnailUrl ? ' has-image' : ''}`}
                          style={{ aspectRatio: tpl.ratio, background: tpl.grad }}
                        >
                          {tpl.thumbnailUrl ? (
                            <img src={tpl.thumbnailUrl} alt={tpl.title} loading="lazy" className="home__tpl-img" />
                          ) : (
                            <span className="home__tpl-media" aria-hidden="true">
                              <svg viewBox="0 0 24 24" width="34" height="34" fill="none">
                                <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.55)" />
                                <path d="M10 8.5l6 3.5-6 3.5z" fill="#fff" />
                              </svg>
                            </span>
                          )}
                          <span className="home__template-caption">{tpl.title}</span>
                          <div className="home__tpl-mask">
                            <button
                              type="button"
                              className="home__tpl-action"
                              onClick={() => handleNavigate('hot-copy')}
                            >
                              做同款
                            </button>
                          </div>
                        </div>
                        <div className="home__tpl-meta">
                          <span className="home__tpl-ratio">{RATIO_LABELS[tpl.ratio] || tpl.ratio}</span>
                          {tpl.duration ? <span className="home__tpl-dur">{tpl.duration}s</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* 功能待开放弹窗 */}
      {comingSoonOpen && (
        <div className="home__modal-mask" onClick={() => setComingSoonOpen(false)}>
          <div className="home__modal" onClick={(e) => e.stopPropagation()}>
            <div className="home__modal-icon">🚧</div>
            <div className="home__modal-title">功能待开放</div>
            <div className="home__modal-desc">该功能正在打磨中，敬请期待</div>
            <button type="button" className="home__modal-btn" onClick={() => setComingSoonOpen(false)}>
              我知道了
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
