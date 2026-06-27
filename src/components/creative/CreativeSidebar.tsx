/**
 * CreativeSidebar — 创意工作流左侧步骤导航
 * 显示 Prompt → 脚本 → 分镜 → 时间线 → 视频 五个步骤，高亮当前步骤，支持点击跳转。
 */
import logoUrl from '@/img/image copy 7.png'
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
  // 窄屏（≤900px）抽屉是否展开。展开时侧栏从左侧滑入并显示完整导航。
  mobileOpen?: boolean
  sections: any[]
  workspaces?: any[]
  activeWorkspaceId?: number
  onToggleSidebar?: () => void
  // 窄屏汉堡按钮：唤出/收起抽屉。
  onToggleMobileDrawer?: () => void
  onNavClick?: (label: string) => void
  onSwitchWorkspace?: (id: number) => void
  onCreateTeam?: () => void
  onJoinTeam?: () => void
  onDeleteWorkspace?: (workspace: any) => void
}

export default function CreativeSidebar({
  collapsed = false,
  mobileOpen = false,
  sections,
  workspaces = [],
  activeWorkspaceId = 0,
  onToggleSidebar,
  onToggleMobileDrawer,
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

  // 抽屉展开时强制展示完整导航（文字 + 空间选择），不受桌面折叠态影响。
  const showFullNav = mobileOpen || !collapsed

  return (
    <>
      {/* 窄屏（≤900px）常驻左上角：LOGO + 汉堡按钮，点击唤出/收起抽屉。 */}
      <div className="mobile-topbar">
        <img className="mobile-topbar-logo" src={logoUrl} alt="帧智汇" width={32} height={32} />
        <button
          type="button"
          className="mobile-menu-btn"
          aria-label={mobileOpen ? '收起导航' : '展开导航'}
          aria-expanded={mobileOpen}
          onClick={() => onToggleMobileDrawer?.()}
        >
          {/* 汉堡图标（sprite #38e54b 的内联版本）。 */}
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
      </div>

      {/* 抽屉遮罩：仅窄屏抽屉展开时出现，点击关闭。 */}
      <button
        type="button"
        className={['sidebar-drawer-backdrop', mobileOpen ? 'visible' : ''].filter(Boolean).join(' ')}
        aria-label="关闭导航"
        tabIndex={mobileOpen ? 0 : -1}
        onClick={() => onToggleMobileDrawer?.()}
      ></button>

      <aside className={['sidebar', mobileOpen ? 'mobile-open' : ''].filter(Boolean).join(' ')} aria-label="侧边导航">
        {/* 品牌区（>900px）：点击 LOGO 区域展开/收起边栏；hover 时浮出侧栏图标并提示。 */}
        <button
          type="button"
          className="product-mark"
          aria-label={collapsed ? '展开导航栏' : '收起导航栏'}
          aria-expanded={!collapsed}
          title={collapsed ? '展开边栏' : '收起边栏'}
          onClick={() => onToggleSidebar?.()}
        >
          <img className="brand-logo" src={logoUrl} alt="帧智汇" width={42} height={42} />
          <span className="brand-copy">
            <strong>帧智汇</strong>
            <em>v{APP_VERSION}</em>
          </span>
          {/* hover 时覆盖在 LOGO 上的侧栏开关图标（sprite #836f7a 的内联版本）。 */}
          <span className="product-mark-toggle" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.835 4c-.451.004-.82.012-1.137.038-.386.032-.659.085-.876.162l-.2.086c-.44.224-.807.564-1.063.982l-.103.184c-.126.247-.206.562-.248 1.076-.043.523-.043 1.19-.043 2.135v2.664c0 .944 0 1.612.043 2.135.042.515.122.829.248 1.076l.103.184c.256.418.624.758 1.063.982l.2.086c.217.077.49.13.876.162.316.026.685.034 1.136.038zm11.33 7.327c0 .922 0 1.654-.048 2.243-.043.522-.125.977-.305 1.395l-.082.177a4 4 0 0 1-1.473 1.593l-.276.155c-.465.237-.974.338-1.57.387-.59.048-1.322.048-2.244.048H7.833c-.922 0-1.654 0-2.243-.048-.522-.042-.977-.126-1.395-.305l-.176-.082a4 4 0 0 1-1.594-1.473l-.154-.275c-.238-.466-.34-.975-.388-1.572-.048-.589-.048-1.32-.048-2.243V8.663c0-.922 0-1.654.048-2.243.049-.597.15-1.106.388-1.571l.154-.276a4 4 0 0 1 1.594-1.472l.176-.083c.418-.18.873-.263 1.395-.305.589-.048 1.32-.048 2.243-.048h4.334c.922 0 1.654 0 2.243.048.597.049 1.106.15 1.571.388l.276.154a4 4 0 0 1 1.473 1.594l.082.176c.18.418.262.873.305 1.395.048.589.048 1.32.048 2.243zm-10 4.668h4.002c.944 0 1.612 0 2.135-.043.514-.042.829-.122 1.076-.248l.184-.103c.418-.256.758-.624.982-1.063l.086-.2c.077-.217.13-.49.162-.876.043-.523.043-1.19.043-2.135V8.663c0-.944 0-1.612-.043-2.135-.032-.386-.085-.659-.162-.876l-.086-.2a2.67 2.67 0 0 0-.982-1.063l-.184-.103c-.247-.126-.562-.206-1.076-.248-.523-.043-1.19-.043-2.135-.043H8.164L8.165 4z" />
            </svg>
          </span>
        </button>

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
            {showFullNav && <p>空间</p>}
            {showFullNav && (
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
    </>
  )
}
