/**
 * 2.1 左侧导航栏（自包含静态实现）。
 * 浅色窄侧栏：品牌 + 首页 + 分组（创作/管理/发布/团队/其他）+ 底部设置。
 * props: activeKey 当前选中项；onNavigate(key) 点击回调（跳转由父级接线）。
 * 图标统一用简单 inline SVG（24x24, stroke=currentColor），避免引入新依赖。
 */
import brandLogo from '@/img/image copy 7.png'
import { APP_VERSION } from '@/version'
import { useUiStore } from '@/stores/ui'
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
      { key: 'resources', label: '我的素材', icon: IconShop },
    ],
  },
  {
    title: '发布',
    items: [
      { key: 'pre-review', label: '投前预审', icon: IconShield },
      { key: 'dashboard', label: '数据看板', icon: IconDashboard },
    ],
  },
]

export default function AppSidebar({ activeKey = 'home', onNavigate, open = false, onClose }: AppSidebarProps) {
  // 桌面端收起态:跨页面保持,放全局 ui store。
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleCollapsed = useUiStore((s) => s.toggleSidebarCollapsed)

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
      <div className={`app-sidebar__backdrop${open ? ' is-open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`app-sidebar${open ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`}>
        {/* 品牌区:展开态为纯展示(LOGO + 帧智汇 + 版本);收起态下整块可点,
            hover LOGO 浮出侧栏开关图标并提示「展开边栏」。 */}
        <div
          className="app-sidebar__brand"
          role={collapsed ? 'button' : undefined}
          tabIndex={collapsed ? 0 : undefined}
          aria-label={collapsed ? '展开边栏' : undefined}
          onClick={collapsed ? toggleCollapsed : undefined}
          onKeyDown={
            collapsed
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleCollapsed()
                  }
                }
              : undefined
          }
        >
          <span className="app-sidebar__logo-wrap">
            <img src={brandLogo} alt="帧智汇" className="app-sidebar__logo" />
            {/* 收起态:hover LOGO 浮出展开图标(sprite #836f7a 内联版本) */}
            <span className="app-sidebar__toggle-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.835 4c-.451.004-.82.012-1.137.038-.386.032-.659.085-.876.162l-.2.086c-.44.224-.807.564-1.063.982l-.103.184c-.126.247-.206.562-.248 1.076-.043.523-.043 1.19-.043 2.135v2.664c0 .944 0 1.612.043 2.135.042.515.122.829.248 1.076l.103.184c.256.418.624.758 1.063.982l.2.086c.217.077.49.13.876.162.316.026.685.034 1.136.038zm11.33 7.327c0 .922 0 1.654-.048 2.243-.043.522-.125.977-.305 1.395l-.082.177a4 4 0 0 1-1.473 1.593l-.276.155c-.465.237-.974.338-1.57.387-.59.048-1.322.048-2.244.048H7.833c-.922 0-1.654 0-2.243-.048-.522-.042-.977-.126-1.395-.305l-.176-.082a4 4 0 0 1-1.594-1.473l-.154-.275c-.238-.466-.34-.975-.388-1.572-.048-.589-.048-1.32-.048-2.243V8.663c0-.922 0-1.654.048-2.243.049-.597.15-1.106.388-1.571l.154-.276a4 4 0 0 1 1.594-1.472l.176-.083c.418-.18.873-.263 1.395-.305.589-.048 1.32-.048 2.243-.048h4.334c.922 0 1.654 0 2.243.048.597.049 1.106.15 1.571.388l.276.154a4 4 0 0 1 1.473 1.594l.082.176c.18.418.262.873.305 1.395.048.589.048 1.32.048 2.243zm-10 4.668h4.002c.944 0 1.612 0 2.135-.043.514-.042.829-.122 1.076-.248l.184-.103c.418-.256.758-.624.982-1.063l.086-.2c.077-.217.13-.49.162-.876.043-.523.043-1.19.043-2.135V8.663c0-.944 0-1.612-.043-2.135-.032-.386-.085-.659-.162-.876l-.086-.2a2.67 2.67 0 0 0-.982-1.063l-.184-.103c-.247-.126-.562-.206-1.076-.248-.523-.043-1.19-.043-2.135-.043H8.164L8.165 4z" />
              </svg>
            </span>
          </span>
          {/* 收起态:hover 整块时浮出展开提示(与「收起边栏」同款深色气泡) */}
          <span className="app-sidebar__expand-tip" aria-hidden="true">
            展开边栏
          </span>
          <span className="app-sidebar__brand-text">
            <span className="app-sidebar__brand-name">帧智汇</span>
            <span className="app-sidebar__version">v{APP_VERSION}</span>
          </span>

          {/* 展开态:顶部右上角独立「收起边栏」按钮(hover 显示 tooltip) */}
          <button
            type="button"
            className="app-sidebar__collapse-btn"
            aria-label="收起边栏"
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapsed()
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M6.835 4c-.451.004-.82.012-1.137.038-.386.032-.659.085-.876.162l-.2.086c-.44.224-.807.564-1.063.982l-.103.184c-.126.247-.206.562-.248 1.076-.043.523-.043 1.19-.043 2.135v2.664c0 .944 0 1.612.043 2.135.042.515.122.829.248 1.076l.103.184c.256.418.624.758 1.063.982l.2.086c.217.077.49.13.876.162.316.026.685.034 1.136.038zm11.33 7.327c0 .922 0 1.654-.048 2.243-.043.522-.125.977-.305 1.395l-.082.177a4 4 0 0 1-1.473 1.593l-.276.155c-.465.237-.974.338-1.57.387-.59.048-1.322.048-2.244.048H7.833c-.922 0-1.654 0-2.243-.048-.522-.042-.977-.126-1.395-.305l-.176-.082a4 4 0 0 1-1.594-1.473l-.154-.275c-.238-.466-.34-.975-.388-1.572-.048-.589-.048-1.32-.048-2.243V8.663c0-.922 0-1.654.048-2.243.049-.597.15-1.106.388-1.571l.154-.276a4 4 0 0 1 1.594-1.472l.176-.083c.418-.18.873-.263 1.395-.305.589-.048 1.32-.048 2.243-.048h4.334c.922 0 1.654 0 2.243.048.597.049 1.106.15 1.571.388l.276.154a4 4 0 0 1 1.473 1.594l.082.176c.18.418.262.873.305 1.395.048.589.048 1.32.048 2.243zm-10 4.668h4.002c.944 0 1.612 0 2.135-.043.514-.042.829-.122 1.076-.248l.184-.103c.418-.256.758-.624.982-1.063l.086-.2c.077-.217.13-.49.162-.876.043-.523.043-1.19.043-2.135V8.663c0-.944 0-1.612-.043-2.135-.032-.386-.085-.659-.162-.876l-.086-.2a2.67 2.67 0 0 0-.982-1.063l-.184-.103c-.247-.126-.562-.206-1.076-.248-.523-.043-1.19-.043-2.135-.043H8.164L8.165 4z" />
            </svg>
            <span className="app-sidebar__collapse-tip">收起边栏</span>
          </button>
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
        <div className="app-sidebar__footer">{renderItem({ key: 'settings', label: '设置', icon: IconSettings })}</div>
      </aside>
    </>
  )
}
