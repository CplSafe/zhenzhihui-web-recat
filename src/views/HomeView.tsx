/**
 * 2.1 首页（自包含静态实现，纯前端占位数据，不接后端）。
 * 组合 <AppSidebar/> + 内容区：简洁顶栏 / 轮播 Banner / 快捷入口 / 标签切换 + 搜索 / 模板网格。
 * 导航跳转用 react-router useNavigate；已存在路由直接跳转，未实现的项 console 占位。
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import { useCurrentUser } from '@/stores/workspaceSession'
import './HomeView.css'

/* 侧栏 / 快捷入口 key → 路由映射（已存在的路由）*/
const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/creative',
  projects: '/projects',
  resources: '/resources',
}

/* 轮播 Banner 占位（3 张渐变色块）*/
const BANNERS = [
  { id: 0, grad: 'linear-gradient(120deg, #d7f5ec 0%, #eafff9 55%, #f5fffd 100%)' },
  { id: 1, grad: 'linear-gradient(120deg, #dde3ff 0%, #eef1ff 55%, #f7f9ff 100%)' },
  { id: 2, grad: 'linear-gradient(120deg, #ffe9d7 0%, #fff4ea 55%, #fffaf5 100%)' },
]

/* 快捷入口 4 卡 */
const QUICK_ENTRIES = [
  { key: 'creative', title: '智能成片', desc: '输入灵感，秒出大片', grad: 'linear-gradient(135deg, #e6fbf4, #f4fffc)' },
  { key: 'hot-copy', title: '爆款复制', desc: '海量爆款，生成同款', grad: 'linear-gradient(135deg, #e3f9f1, #f2fffb)' },
  { key: 'hot-split', title: '爆款裂变', desc: '一个爆款，裂变出N个', grad: 'linear-gradient(135deg, #e6fbf4, #f4fffc)' },
  { key: 'ip-video', title: 'IP视频', desc: '打造出属于你的个人IP', grad: 'linear-gradient(135deg, #e3f9f1, #f2fffb)' },
]

const QuickIcon = (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#1fcfa9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="m6.5 6.5 2.5 2.5M15 15l2.5 2.5M17.5 6.5 15 9M9 15l-2.5 2.5" />
  </svg>
)

/* 模板网格占位（标题 + 渐变底）*/
const TEMPLATES = [
  { id: 1, title: '健康饮食 均衡生活', grad: 'linear-gradient(160deg, #c9efc2, #eafbe4)' },
  { id: 2, title: '春日限定 焕新出发', grad: 'linear-gradient(160deg, #f8d6e3, #fdeef3)' },
  { id: 3, title: '活力运动 开启新旅程', grad: 'linear-gradient(160deg, #7fd6b0, #c4f0df)' },
  { id: 4, title: '自然之露 润养身心', grad: 'linear-gradient(160deg, #bfe4d8, #e7f6f0)' },
  { id: 5, title: '都市夜色 灵感闪现', grad: 'linear-gradient(160deg, #b6c4f0, #e2e9fb)' },
  { id: 6, title: '简约家居 美学生活', grad: 'linear-gradient(160deg, #f0e2c4, #fbf3e2)' },
  { id: 7, title: '潮流穿搭 个性表达', grad: 'linear-gradient(160deg, #e2c4f0, #f4e7fb)' },
  { id: 8, title: '清新茶饮 慢享时光', grad: 'linear-gradient(160deg, #c4f0e8, #e2fbf6)' },
  { id: 9, title: '旅行日记 远方在召唤', grad: 'linear-gradient(160deg, #c4dff0, #e2f1fb)' },
  { id: 10, title: '美妆教程 妆点自信', grad: 'linear-gradient(160deg, #f0c4d2, #fbe2eb)' },
  { id: 11, title: '科技数码 智享未来', grad: 'linear-gradient(160deg, #c4ccf0, #e2e6fb)' },
  { id: 12, title: '宠物日常 萌动每一刻', grad: 'linear-gradient(160deg, #f0dcc4, #fbf0e2)' },
]

const TABS = [
  { key: 'template', label: '模板库' },
  { key: 'history', label: '历史项目' },
  { key: 'ip', label: 'IP' },
] as const

export default function HomeView() {
  const navigate = useNavigate()
  const currentUser = useCurrentUser() as any
  const [bannerIndex, setBannerIndex] = useState(0)
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['key']>('template')
  const [keyword, setKeyword] = useState('')

  const userName = useMemo(
    () => currentUser?.nickname || currentUser?.name || currentUser?.username || '用户',
    [currentUser],
  )

  const handleNavigate = (key: string) => {
    const path = ROUTE_MAP[key]
    if (path) {
      navigate(path)
    } else {
      // 暂无对应路由的项：占位，不报错、不乱建路由
      console.info('[home] 导航项暂未实现：', key)
    }
  }

  const prevBanner = () => setBannerIndex((i) => (i - 1 + BANNERS.length) % BANNERS.length)
  const nextBanner = () => setBannerIndex((i) => (i + 1) % BANNERS.length)

  return (
    <div className="home">
      <AppSidebar activeKey="home" onNavigate={handleNavigate} />

      <div className="home__main">
        {/* 简洁顶栏 */}
        <header className="home__topbar">
          <div className="home__topbar-right">
            <button type="button" className="home__member" onClick={() => handleNavigate('member')}>
              <span className="home__member-icon">★</span>会员中心
            </button>
            <div className="home__user">
              <span className="home__avatar">{userName.slice(0, 1)}</span>
              <span className="home__user-name">{userName}</span>
            </div>
          </div>
        </header>

        <div className="home__content">
          {/* 轮播 Banner */}
          <section className="home__banner" style={{ background: BANNERS[bannerIndex].grad }}>
            <button type="button" className="home__banner-arrow home__banner-arrow--left" onClick={prevBanner} aria-label="上一张">
              ‹
            </button>
            <div className="home__banner-inner">
              <div className="home__banner-card">
                <h2 className="home__banner-title">
                  新手<span className="home__banner-em">快速入门</span>指南
                </h2>
                <p className="home__banner-sub">三步上手帧智汇，快速生成你的第一条作品</p>
                <button type="button" className="home__banner-btn" onClick={() => handleNavigate('tutorial')}>
                  立即查看教程
                </button>
              </div>
            </div>
            <button type="button" className="home__banner-arrow home__banner-arrow--right" onClick={nextBanner} aria-label="下一张">
              ›
            </button>
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
          </section>

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
                  <div className="home__quick-icon">{QuickIcon}</div>
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

            {/* 模板网格 */}
            <div className="home__template-grid">
              {TEMPLATES.map((tpl) => (
                <div key={tpl.id} className="home__template-card">
                  <div className="home__template-thumb" style={{ background: tpl.grad }}>
                    <span className="home__template-caption">{tpl.title}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
