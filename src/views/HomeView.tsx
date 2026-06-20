/**
 * 2.1 首页（自包含静态实现，纯前端占位数据，不接后端）。
 * 组合 <AppSidebar/> + 内容区：简洁顶栏 / 轮播 Banner / 快捷入口 / 标签切换 + 搜索 / 模板网格。
 * 导航跳转用 react-router useNavigate；已存在路由直接跳转，未实现的项 console 占位。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import { useCurrentUser, useWorkspaceId, useCurrentPlanName } from '@/stores/workspaceSession'
import { listCreativeProjects } from '@/api/business'
import { logoutSession, getAuthErrorMessage } from '@/api/auth'
import { useAuth } from '@/auth/AuthContext'
import { useToast } from '@/composables/useToast'
import { shouldClearSessionAfterLogoutFailure } from '@/utils/workflowGuards'
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
function projectCover(p: any): string {
  const url = p?.thumbnailUrl || p?.thumbnail_url || p?.coverUrl || p?.cover_url || p?.cover || ''
  return isSafeMediaUrl(url) ? url : ''
}
function projectId(p: any): number {
  return Number(p?.id || p?.project_id || p?.projectId || 0)
}

/* 侧栏 / 快捷入口 key → 路由映射（已存在的路由）*/
const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
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
  { key: 'creative', title: '智能成片', desc: '输入灵感，秒出大片', icon: quick1, grad: 'linear-gradient(135deg, #e6fbf4, #f4fffc)' },
  { key: 'hot-copy', title: '爆款复制', desc: '海量爆款，生成同款', icon: quick2, grad: 'linear-gradient(135deg, #e3f9f1, #f2fffb)' },
  { key: 'hot-split', title: '爆款裂变', desc: '一个爆款，裂变出N个', icon: quick3, grad: 'linear-gradient(135deg, #e6fbf4, #f4fffc)' },
  { key: 'ip-video', title: 'IP视频', desc: '打造出属于你的个人IP', icon: quick4, grad: 'linear-gradient(135deg, #e3f9f1, #f2fffb)' },
]

/* 模板占位卡(不同比例 → 瀑布流自动排布;真实模板待接后端,按 热度>时间倒序) */
const TEMPLATES = [
  { id: 1, title: '健康饮食 均衡生活', grad: 'linear-gradient(160deg, #c9efc2, #eafbe4)', ratio: '9 / 16' },
  { id: 2, title: '未来科技 智能生活', grad: 'linear-gradient(160deg, #b6c4f0, #e2e9fb)', ratio: '3 / 4' },
  { id: 3, title: '美味直击 舌尖诱惑', grad: 'linear-gradient(160deg, #f0d6b8, #fbeede)', ratio: '1 / 1' },
  { id: 4, title: '温暖相伴 情感故事', grad: 'linear-gradient(160deg, #f8d6e3, #fdeef3)', ratio: '4 / 5' },
  { id: 5, title: '活力无限 运动人生', grad: 'linear-gradient(160deg, #ffd2b0, #ffeede)', ratio: '9 / 16' },
  { id: 6, title: '春日限定 焕新出发', grad: 'linear-gradient(160deg, #d7f0c4, #eefbe2)', ratio: '16 / 9' },
  { id: 7, title: '潮流穿搭 个性表达', grad: 'linear-gradient(160deg, #e2c4f0, #f4e7fb)', ratio: '3 / 4' },
  { id: 8, title: '清新茶饮 慢享时光', grad: 'linear-gradient(160deg, #c4f0e8, #e2fbf6)', ratio: '1 / 1' },
  { id: 9, title: '旅行日记 远方在召唤', grad: 'linear-gradient(160deg, #c4dff0, #e2f1fb)', ratio: '9 / 16' },
  { id: 10, title: '美妆教程 妆点自信', grad: 'linear-gradient(160deg, #f0c4d2, #fbe2eb)', ratio: '4 / 5' },
  { id: 11, title: '科技数码 智享未来', grad: 'linear-gradient(160deg, #c4ccf0, #e2e6fb)', ratio: '3 / 4' },
  { id: 12, title: '宠物日常 萌动每一刻', grad: 'linear-gradient(160deg, #f0dcc4, #fbf0e2)', ratio: '1 / 1' },
  { id: 13, title: '都市夜色 灵感闪现', grad: 'linear-gradient(160deg, #b9c0e8, #e3e7fb)', ratio: '9 / 16' },
  { id: 14, title: '简约家居 美学生活', grad: 'linear-gradient(160deg, #f0e2c4, #fbf3e2)', ratio: '16 / 9' },
  { id: 15, title: '萌宠时刻 治愈日常', grad: 'linear-gradient(160deg, #cdeccb, #ecf8ea)', ratio: '3 / 4' },
  { id: 16, title: '国风新潮 东方美学', grad: 'linear-gradient(160deg, #eccfcf, #f8eaea)', ratio: '4 / 5' },
]

const TABS = [
  { key: 'template', label: '模板库' },
  { key: 'history', label: '历史项目' },
  { key: 'ip', label: 'IP' },
] as const

export default function HomeView() {
  const navigate = useNavigate()
  const currentUser = useCurrentUser() as any
  const workspaceId = useWorkspaceId()
  const planName = useCurrentPlanName() as any
  const [bannerIndex, setBannerIndex] = useState(0)
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['key']>('template')
  const [keyword, setKeyword] = useState('')
  const [comingSoonOpen, setComingSoonOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const userBoxRef = useRef<HTMLDivElement>(null)
  const { handleLogoutSuccess } = useAuth()
  const { showToast } = useToast()

  // 历史项目（接后端 listCreativeProjects）
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')

  const userName = useMemo(
    () => currentUser?.nickname || currentUser?.name || currentUser?.username || '用户',
    [currentUser],
  )

  // 切到「历史项目」标签且有工作空间时拉取真实项目（首次/切空间时）。
  useEffect(() => {
    if (activeTab !== 'history') return
    const wsId = Number(workspaceId || 0)
    if (!wsId) return
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError('')
    listCreativeProjects({ workspaceId: wsId, limit: 24 })
      .then((items: any) => {
        if (!cancelled) setHistoryItems(Array.isArray(items) ? items : [])
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

  const keywordTrim = keyword.trim()
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

  const prevBanner = () => setBannerIndex((i) => (i - 1 + BANNERS.length) % BANNERS.length)
  const nextBanner = () => setBannerIndex((i) => (i + 1) % BANNERS.length)

  // Banner 自动轮播
  useEffect(() => {
    const t = window.setInterval(() => setBannerIndex((i) => (i + 1) % BANNERS.length), 6000)
    return () => window.clearInterval(t)
  }, [])

  // 用户菜单:点击外部关闭
  useEffect(() => {
    if (!userMenuOpen) return
    function onDown(e: PointerEvent) {
      if (userBoxRef.current && !userBoxRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [userMenuOpen])

  async function handleLogout() {
    if (isLoggingOut) return
    setUserMenuOpen(false)
    setIsLoggingOut(true)
    try {
      await logoutSession()
      showToast('已退出登录', 'success')
      setIsLoggingOut(false)
      handleLogoutSuccess()
    } catch (error) {
      // 部分后端登出失败但会话实际已失效:按既有策略仍清理本地并跳登录
      if (shouldClearSessionAfterLogoutFailure(error)) {
        setIsLoggingOut(false)
        handleLogoutSuccess()
        return
      }
      showToast(getAuthErrorMessage(error, '退出登录失败，请稍后重试'), 'error')
      setIsLoggingOut(false)
    }
  }

  return (
    <div className="home">
      <AppSidebar
        activeKey="home"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="home__main">
        {/* 简洁顶栏 */}
        <header className="home__topbar">
          {/* 汉堡按钮:仅移动端显示,打开侧栏抽屉 */}
          <button
            type="button"
            className="home__hamburger"
            aria-label="打开菜单"
            onClick={() => setSidebarOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <div className="home__topbar-right">
            <button type="button" className="home__member" onClick={() => handleNavigate('member')}>
              <span className="home__member-icon">★</span>
              {planName ? String(planName) : '会员中心'}
            </button>
            <div className="home__user" ref={userBoxRef}>
              <button
                type="button"
                className="home__user-btn"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((v) => !v)}
              >
                <span className="home__avatar">{userName.slice(0, 1)}</span>
                <span className="home__user-name">{userName}</span>
                <span className={`home__user-caret${userMenuOpen ? ' is-open' : ''}`}>⌄</span>
              </button>
              {userMenuOpen && (
                <div className="home__user-menu" role="menu">
                  <button
                    type="button"
                    className="home__user-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false)
                      handleNavigate('member')
                    }}
                  >
                    会员中心
                  </button>
                  <button
                    type="button"
                    className="home__user-menu-item home__user-menu-item--danger"
                    role="menuitem"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                  >
                    {isLoggingOut ? '退出中…' : '退出登录'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="home__content">
          {/* 轮播 Banner:track + 多 slide,点击圆点/箭头切换,自动播放;后端接入后传多条 */}
          <section className="home__banner">
            <div
              className="home__banner-track"
              style={{ transform: `translateX(-${bannerIndex * 100}%)` }}
            >
              {BANNERS.map((b) => (
                <div className="home__banner-slide" key={b.id}>
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
              ))}
            </div>
            <button type="button" className="home__banner-arrow home__banner-arrow--left" onClick={prevBanner} aria-label="上一张">
              ‹
            </button>
            <button type="button" className="home__banner-arrow home__banner-arrow--right" onClick={nextBanner} aria-label="下一张">
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

          {/* 标签 + 搜索 */}
          <section className="home__section">
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
              <div className="home__search">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#909090" strokeWidth="1.8" strokeLinecap="round">
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
            </div>

            {/* 内容框:模板库/历史项目/IP —— 限高约 40vh 可滚动,底部渐隐提示可下滑 */}
            <div className="home__tab-box">
            {activeTab === 'history' ? (
              historyLoading ? (
                <div className="home__placeholder">加载中…</div>
              ) : historyError ? (
                <div className="home__placeholder">{historyError}</div>
              ) : filteredHistory.length ? (
                <div className="home__proj-grid">
                  {filteredHistory.map((p) => {
                    const id = projectId(p)
                    const cover = projectCover(p)
                    return (
                      <button
                        key={id || projectTitle(p)}
                        type="button"
                        className="home__proj"
                        onClick={() => id && navigate(`/creative/${id}`)}
                      >
                        <div
                          className="home__proj-thumb"
                          style={
                            cover
                              ? { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                              : undefined
                          }
                        >
                          {!cover && <span className="home__proj-thumb-ph">🎬</span>}
                        </div>
                        <div className="home__proj-title" title={projectTitle(p)}>
                          {projectTitle(p)}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="home__placeholder">暂无历史项目</div>
              )
            ) : activeTab === 'ip' ? (
              <div className="home__placeholder">IP 功能敬请期待</div>
            ) : (
              /* 模板库:瀑布流(不同比例自动排布),最多 20 个;图片占位(后端拉取视频/图后替换);
                 hover 出「做同款」→ 爆款复制 */
              <div className="home__masonry">
                {TEMPLATES.slice(0, 20).map((tpl) => (
                  <div key={tpl.id} className="home__tpl">
                    <div
                      className="home__tpl-thumb"
                      style={{ aspectRatio: tpl.ratio, background: tpl.grad }}
                    >
                      <span className="home__tpl-media" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="34" height="34" fill="none">
                          <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.55)" />
                          <path d="M10 8.5l6 3.5-6 3.5z" fill="#fff" />
                        </svg>
                      </span>
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
                  </div>
                ))}
              </div>
            )}
            </div>
            {activeTab === 'template' && (
              <div className="home__more">
                <button type="button" className="home__more-btn" onClick={() => navigate('/templates')}>
                  查看更多
                </button>
              </div>
            )}
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
