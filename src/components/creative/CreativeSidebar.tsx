/**
 * CreativeSidebar — 创意工作流左侧步骤导航
 * 显示 Prompt → 脚本 → 分镜 → 时间线 → 视频 五个步骤，高亮当前步骤，支持点击跳转。
 */
import logoUrl from '@/img/image copy 6.png'
import navDashboard from '@/assets/icons/nav-dashboard.svg'
import navSteps from '@/assets/icons/nav-steps.svg'
import navSpark from '@/assets/icons/nav-spark.svg'
import navFolder from '@/assets/icons/nav-folder.svg'
import navShop from '@/assets/icons/nav-shop.svg'
import navDashboardActive from '@/assets/icons/nav-dashboard-active.svg'
import navStepsActive from '@/assets/icons/nav-steps-active.svg'
import navSparkActive from '@/assets/icons/nav-spark-active.svg'
import navFolderActive from '@/assets/icons/nav-folder-active.svg'
import navShopActive from '@/assets/icons/nav-shop-active.svg'
import SpaceSelectPanel from '@/components/space/SpaceSelectPanel'
import { APP_VERSION } from '@/version'

// 左侧导航栏（Figma「导航栏」176px，浅色 #f5f5f5）：logo + 创作/管理/团队 三组。
// 能用的导航跳转，其余 coming-soon。团队是一个下拉选择框（Figma 设计稿）：框内
// 显示当前空间名（无则「创建团队」），点击在下方弹出浮层切换空间 / 创建团队。
// 图标用 Figma 导出的真实 SVG，通过 CSS mask 渲染以便选中态变色。
// 每个导航图标两态：默认灰 #666，选中蓝 #5b6be8（设计稿）。
// 这个组件负责整个创意工作台左侧导航的组织与空间切换入口展示。
const NAV_ICONS: Record<string, { base: string; active: string }> = {
  dashboard: { base: navDashboard, active: navDashboardActive },
  steps: { base: navSteps, active: navStepsActive },
  spark: { base: navSpark, active: navSparkActive },
  folder: { base: navFolder, active: navFolderActive },
  shop: { base: navShop, active: navShopActive },
}

// 根据当前导航项是否激活，切换对应图标资源。
function navIcon(item: any) {
  const set = NAV_ICONS[item.icon] || NAV_ICONS.folder
  return item.active ? set.active : set.base
}

interface CreativeSidebarProps {
  collapsed?: boolean
  sections: any[]
  workspaces?: any[]
  activeWorkspaceId?: number
  onToggleSidebar?: () => void
  onNavClick?: (label: string) => void
  onSwitchWorkspace?: (id: number) => void
  onCreateTeam?: () => void
  onJoinTeam?: () => void
  onDeleteWorkspace?: (workspace: any) => void
}

export default function CreativeSidebar({
  collapsed = false,
  sections,
  workspaces = [],
  activeWorkspaceId = 0,
  onToggleSidebar,
  onNavClick,
  onSwitchWorkspace,
  onCreateTeam,
  onJoinTeam,
  onDeleteWorkspace,
}: CreativeSidebarProps) {
  // 选择空间时，只有与当前空间不一致才通知父级切换。
  function pickWorkspace(id: number) {
    if (Number(id) !== Number(activeWorkspaceId)) onSwitchWorkspace?.(id)
  }

  function createTeam() {
    onCreateTeam?.()
  }

  function joinTeam() {
    onJoinTeam?.()
  }

  function handleDeleteWorkspace(workspace: any) {
    onDeleteWorkspace?.(workspace)
  }

  return (
    <aside className="sidebar" aria-label="侧边导航">
      {/* 品牌区：Logo、版本号以及折叠态下的展开入口。 */}
      <button
        type="button"
        className="product-mark"
        aria-label={collapsed ? '展开导航栏' : '帧智汇'}
        onClick={collapsed ? () => onToggleSidebar?.() : undefined}
      >
        <img className="brand-logo" src={logoUrl} alt="帧智汇" width={42} height={42} />
        <span className="brand-copy">
          <strong>帧智汇</strong>
          <em>v{APP_VERSION}</em>
        </span>
      </button>

      {!collapsed && (
        <button
          type="button"
          className="sidebar-toggle"
          aria-label="收起导航栏"
          onClick={() => onToggleSidebar?.()}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="2"></rect>
            <line x1="9" y1="4" x2="9" y2="20"></line>
            <circle cx="6" cy="8" r="0.6" fill="currentColor" stroke="none"></circle>
            <circle cx="6" cy="11" r="0.6" fill="currentColor" stroke="none"></circle>
            <circle cx="6" cy="14" r="0.6" fill="currentColor" stroke="none"></circle>
          </svg>
        </button>
      )}

      {/* 主导航区：按"创作 / 管理 / 空间"分组展示。 */}
      <nav className="navigation">
        {sections.map((section) => (
          <div key={section.title} className={['nav-section', section.className].filter(Boolean).join(' ')}>
            <p>{section.title}</p>
            {section.items.map((item: any) => (
              <button
                key={item.label}
                type="button"
                className={['nav-button', item.active ? 'active' : ''].filter(Boolean).join(' ')}
                aria-current={item.active ? 'page' : undefined}
                onClick={item.active ? undefined : () => onNavClick?.(item.label)}
              >
                <img className="nav-icon" src={navIcon(item)} alt="" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ))}

        {/* 团队组：下拉选择框（当前空间名 / 创建团队），点击在上方弹浮层 */}
        <div className="nav-section team-section">
          {!collapsed && <p>空间</p>}
          {!collapsed && (
            <SpaceSelectPanel
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSelect={pickWorkspace}
              onJoinTeam={joinTeam}
              onCreateTeam={createTeam}
              onDeleteWorkspace={handleDeleteWorkspace}
            />
          )}
        </div>
      </nav>
    </aside>
  )
}
