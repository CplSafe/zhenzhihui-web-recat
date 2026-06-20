/**
 * 2.1 左侧导航栏（自包含静态实现）。
 * 浅色窄侧栏：品牌 + 首页 + 分组（创作/管理/发布/团队/其他）+ 底部设置。
 * props: activeKey 当前选中项；onNavigate(key) 点击回调（跳转由父级接线）。
 * 图标统一用简单 inline SVG（24x24, stroke=currentColor），避免引入新依赖。
 */
import brandLogo from '@/img/image copy 6.png'
import './AppSidebar.css'

export interface SidebarItem {
  key: string
  label: string
  icon: React.ReactNode
}

export interface SidebarGroup {
  title: string
  items: SidebarItem[]
}

interface AppSidebarProps {
  activeKey?: string
  onNavigate?: (key: string) => void
  /** 移动端抽屉是否展开（桌面端忽略，始终常驻） */
  open?: boolean
  /** 移动端抽屉请求关闭（点遮罩 / 点导航项后） */
  onClose?: () => void
}

/* ---- inline SVG 图标（统一 currentColor，随选中态变色）------------------ */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const IconHome = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h14V9.5" />
    <path d="M9.5 20v-6h5v6" />
  </svg>
)
const IconSpark = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="m6.5 6.5 2.5 2.5M15 15l2.5 2.5M17.5 6.5 15 9M9 15l-2.5 2.5" />
  </svg>
)
const IconCopy = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M4 16V5a1 1 0 0 1 1-1h11" />
  </svg>
)
const IconEdit = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m10 9 5 3-5 3z" />
  </svg>
)
const IconFolder = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)
const IconShop = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <path d="M4 9h16l-1 11H5z" />
    <path d="M4 9 6 4h12l2 5" />
    <path d="M9 13a3 3 0 0 0 6 0" />
  </svg>
)
const IconShield = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)
const IconSend = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <path d="M21 4 3 11l7 3 3 7z" />
    <path d="m10 14 11-10" />
  </svg>
)
const IconDashboard = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
)
const IconUser = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
)
const IconAgent = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <rect x="4" y="8" width="16" height="11" rx="2" />
    <path d="M12 4v4M8 13h.01M16 13h.01" />
    <path d="M9 16h6" />
  </svg>
)
const IconGift = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <rect x="4" y="9" width="16" height="11" rx="1.5" />
    <path d="M3 9h18M12 9v11" />
    <path d="M12 9C9 9 7.5 4 12 4s3 5 0 5" />
  </svg>
)
const IconSettings = (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </svg>
)
const IconChevron = (
  <svg viewBox="0 0 24 24" width="14" height="14" {...stroke}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

const GROUPS: SidebarGroup[] = [
  {
    title: '创作',
    items: [
      { key: 'creative', label: '智能成片', icon: IconSpark },
      { key: 'hot-copy', label: '爆款复制', icon: IconCopy },
      { key: 'video-edit', label: '视频编辑', icon: IconEdit },
    ],
  },
  {
    title: '管理',
    items: [
      { key: 'projects', label: '项目管理', icon: IconFolder },
      { key: 'resources', label: '素材市场', icon: IconShop },
    ],
  },
  {
    title: '发布',
    items: [
      { key: 'pre-review', label: '投前预审', icon: IconShield },
      { key: 'publish', label: '一键发布', icon: IconSend },
      { key: 'dashboard', label: '数据看板', icon: IconDashboard },
    ],
  },
  {
    title: '其他',
    items: [
      { key: 'agent-join', label: '代理商入驻', icon: IconAgent },
      { key: 'invite', label: '邀请返利', icon: IconGift },
    ],
  },
]

export default function AppSidebar({ activeKey = 'home', onNavigate, open = false, onClose }: AppSidebarProps) {
  const go = (key: string) => {
    onNavigate?.(key)
    onClose?.() // 移动端抽屉：点导航后收起（桌面端 onClose 通常不传，无副作用）
  }

  const renderItem = (item: SidebarItem) => {
    const active = activeKey === item.key
    return (
      <button
        key={item.key}
        type="button"
        className={`app-sidebar__item${active ? ' is-active' : ''}`}
        onClick={() => go(item.key)}
      >
        <span className="app-sidebar__icon">{item.icon}</span>
        <span className="app-sidebar__label">{item.label}</span>
      </button>
    )
  }

  return (
    <>
      {/* 移动端抽屉遮罩（桌面端 CSS 隐藏）*/}
      <div
        className={`app-sidebar__backdrop${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`app-sidebar${open ? ' is-open' : ''}`}>
      {/* 品牌 */}
      <div className="app-sidebar__brand">
        <img src={brandLogo} alt="帧智汇" className="app-sidebar__logo" />
        <span className="app-sidebar__brand-name">帧智汇</span>
      </div>

      <nav className="app-sidebar__nav">
        {/* 首页 单独一项 */}
        <div className="app-sidebar__group">{renderItem({ key: 'home', label: '首页', icon: IconHome })}</div>

        {/* 创作 / 管理 / 发布 / 其他 */}
        {GROUPS.slice(0, 3).map((group) => (
          <div className="app-sidebar__group" key={group.title}>
            <div className="app-sidebar__group-title">{group.title}</div>
            {group.items.map(renderItem)}
          </div>
        ))}

        {/* 团队：个人空间（静态下拉样式）*/}
        <div className="app-sidebar__group">
          <div className="app-sidebar__group-title">团队</div>
          <button type="button" className="app-sidebar__item app-sidebar__item--dropdown" onClick={() => go('team')}>
            <span className="app-sidebar__icon">{IconUser}</span>
            <span className="app-sidebar__label">个人空间</span>
            <span className="app-sidebar__chevron">{IconChevron}</span>
          </button>
        </div>

        {GROUPS.slice(3).map((group) => (
          <div className="app-sidebar__group" key={group.title}>
            <div className="app-sidebar__group-title">{group.title}</div>
            {group.items.map(renderItem)}
          </div>
        ))}
      </nav>

      {/* 底部：设置 */}
      <div className="app-sidebar__footer">
        {renderItem({ key: 'settings', label: '设置', icon: IconSettings })}
      </div>
      </aside>
    </>
  )
}
