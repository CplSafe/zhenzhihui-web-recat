/**
 * WorkspaceTopbar — 工作空间顶部导航栏
 * 展示用户信息、积分余额、工作空间名称，集成用户菜单（个人中心/退出）、计费入口、
 * 成员管理、通知中心。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import iconMember from '@/assets/icons/top-member.svg'
import iconGift from '@/assets/icons/top-gift.svg'
import iconBell from '@/assets/icons/top-bell.svg'
import iconHelp from '@/assets/icons/top-help.svg'
import iconVip from '@/assets/icons/vip-badge.svg'
import iconCredit from '@/assets/icons/pop-credit.svg'
import iconStorage from '@/assets/icons/pop-storage.svg'
import iconSettings from '@/assets/icons/pop-settings.svg'
import iconHelpRow from '@/assets/icons/pop-help.svg'
import iconLogoutGlyph from '@/assets/icons/pop-logout-glyph.svg'
import imgMaterial from '@/assets/icons/pop-material.png'
import imgData from '@/assets/icons/pop-data.png'
import imgTeam from '@/assets/icons/pop-team.png'
import './WorkspaceTopbar.css'

// 全局工作台顶栏（Figma「工作台-顶部栏」70px）+ 个人中心 popover（Figma 22:1601）。
// 顶栏：搜索 / 会员中心 / 邀请返利 / 通知 / 帮助 / 用户区。
// 搜索、返利、通知、帮助、数据面板、加入新团队、账户设置、帮助中心暂无后端 → coming-soon。
// 这个组件主要负责全局导航展示，不承担核心业务逻辑，点击行为多数通过 emit 交给父级处理。
interface WorkspaceTopbarProps {
  user?: any
  workspace?: any
  member?: any
  planName?: string
  planExpiresAt?: string
  credits?: number
  creditsTotal?: number
  notifications?: number
  isLoggingOut?: boolean
  onOpenBilling?: (tab?: string) => void
  onJoinTeam?: () => void
  onOpenTeamManagement?: () => void
  onLogout?: () => void
  onComingSoon?: (label: string) => void
}

export default function WorkspaceTopbar({
  user = null,
  workspace = null,
  member = null,
  planName = '',
  planExpiresAt = '',
  credits = 0,
  creditsTotal = 0,
  notifications = 0,
  isLoggingOut = false,
  onOpenBilling,
  onJoinTeam,
  onOpenTeamManagement,
  onLogout,
  onComingSoon,
}: WorkspaceTopbarProps) {
  // 本地只维护少量 UI 状态，例如用户菜单是否展开。
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  // 顶栏展示文案的派生状态。
  // 这里统一把用户昵称、头像首字、套餐名、工作空间名、角色和积分信息整理成模板可直接使用的值。
  const displayName = useMemo(
    () => user?.nickname || user?.mobile || user?.email || '未登录用户',
    [user],
  )
  const avatarText = useMemo(() => {
    const first = displayName.trim().charAt(0)
    return first ? first.toUpperCase() : '帧'
  }, [displayName])
  const planLabel = useMemo(() => planName || '未开通套餐', [planName])
  const workspaceName = useMemo(() => {
    const workspaceType = String(workspace?.type || '').toLowerCase()
    const role = String(member?.workspace_role || member?.workspaceRole || member?.member_role || member?.memberRole || member?.role || '').toLowerCase()
    const isOwner = Boolean(user?.id && workspace?.owner_user_id && Number(user.id) === Number(workspace.owner_user_id))
    if (workspaceType && workspaceType !== 'personal' && !role && !isOwner) return '团队空间'
    return workspace?.name || '个人空间'
  }, [member, user, workspace])
  const roleLabel = useMemo(() => {
    const role = member?.role
    if (role === 'owner' || role === 'admin') return '管理员'
    if (role === 'member') return '成员'
    if (role === 'viewer') return '访客'
    if (user?.id && workspace?.owner_user_id && Number(user.id) === Number(workspace.owner_user_id))
      return '管理员'
    return ''
  }, [member, user, workspace])
  const expiryText = useMemo(() => {
    const raw = planExpiresAt
    if (!raw) return ''
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return ''
    // current_period_end 是 UTC（带 Z），用 UTC 取值，避免东八区用户在边界日少一天。
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
  }, [planExpiresAt])
  const notificationLabel = useMemo(
    () => (notifications > 99 ? '99+' : String(notifications)),
    [notifications],
  )

  const creditsLabel = useMemo(() => Number(credits || 0).toLocaleString('zh-CN'), [credits])
  const creditsTotalLabel = useMemo(
    () => (creditsTotal ? Number(creditsTotal).toLocaleString('zh-CN') : ''),
    [creditsTotal],
  )
  const creditsPercent = useMemo(() => {
    if (!creditsTotal) return 0
    return Math.min(100, Math.round((credits / creditsTotal) * 100))
  }, [credits, creditsTotal])

  // 顶栏高度同步逻辑。
  // 页面主体依赖 --top-shift 给内容区留出顶部空白，因此顶栏高度变化后要立刻同步到全局 CSS 变量。
  const topbarRef = useRef<HTMLElement>(null)

  // 将顶栏真实高度写入 CSS 变量，避免内容区被顶部导航遮挡。
  function syncTopShift() {
    const el = topbarRef.current
    if (!el) return
    const height = Math.max(70, Math.ceil(el.getBoundingClientRect().height || 0))
    const frame = document.querySelector<HTMLElement>('.creative-frame')
    const target = frame || document.documentElement
    target.style.setProperty('--top-shift', `${height}px`)
  }

  // 组件挂载后监听尺寸变化与窗口缩放，保证顶栏高度始终同步。
  // 卸载时清理监听与 ResizeObserver，避免页面切换后残留副作用。
  useEffect(() => {
    let topbarResizeObserver: ResizeObserver | null = null
    syncTopShift()
    if (typeof ResizeObserver !== 'undefined' && topbarRef.current) {
      topbarResizeObserver = new ResizeObserver(() => syncTopShift())
      topbarResizeObserver.observe(topbarRef.current)
    }
    window.addEventListener('resize', syncTopShift)
    return () => {
      window.removeEventListener('resize', syncTopShift)
      if (topbarResizeObserver) {
        topbarResizeObserver.disconnect()
        topbarResizeObserver = null
      }
    }
     
  }, [])

  // 以下几个方法统一负责关闭菜单并把操作交还给父级。
  function openBilling(tab: string) {
    setUserMenuOpen(false)
    onOpenBilling?.(tab)
  }

  function handleLogout() {
    setUserMenuOpen(false)
    onLogout?.()
  }

  function comingSoon(label: string) {
    setUserMenuOpen(false)
    onComingSoon?.(label)
  }

  function openJoinTeam() {
    setUserMenuOpen(false)
    onJoinTeam?.()
  }

  function openTeamManagement() {
    setUserMenuOpen(false)
    onOpenTeamManagement?.()
  }

  return (
    <header ref={topbarRef} className="ws-topbar" aria-label="工作台顶部栏">
      {/* 搜索框（占位） */}
      <button type="button" className="ws-search" onClick={() => onComingSoon?.('搜索')}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="5" />
          <path d="m11 11 3 3" />
        </svg>
        <span>搜索项目、素材、视频...</span>
      </button>

      <div className="ws-actions">
        {/* 会员中心 */}
        <button type="button" className="ws-link" onClick={() => openBilling('plans')}>
          <img className="ws-link-icon" src={iconMember} alt="" aria-hidden="true" />
          <span>会员中心</span>
        </button>

        {/* 邀请返利 */}
        <button type="button" className="ws-link" onClick={() => onComingSoon?.('邀请返利')}>
          <img className="ws-link-icon" src={iconGift} alt="" aria-hidden="true" />
          <span>邀请返利</span>
        </button>

        {/* 通知 */}
        <button type="button" className="ws-icon-btn" aria-label="通知" onClick={() => onComingSoon?.('通知')}>
          <img className="ws-btn-icon" src={iconBell} alt="" aria-hidden="true" />
          {notifications > 0 && <span className="ws-badge">{notificationLabel}</span>}
        </button>

        {/* 帮助 */}
        <button type="button" className="ws-icon-btn" aria-label="帮助" onClick={() => onComingSoon?.('帮助')}>
          <img className="ws-btn-icon" src={iconHelp} alt="" aria-hidden="true" />
        </button>

        {/* 用户区 */}
        {user && (
          <div className="ws-user">
            <button
              type="button"
              className={['ws-user-chip', userMenuOpen ? 'open' : ''].filter(Boolean).join(' ')}
              aria-expanded={userMenuOpen}
              aria-haspopup="dialog"
              onClick={() => setUserMenuOpen((v) => !v)}
            >
              <span className="ws-avatar" aria-hidden="true">
                {avatarText}
              </span>
              <span className="ws-user-meta">
                <span className="ws-user-name-row">
                  <strong title={displayName}>{displayName}</strong>
                  <svg
                    className={['ws-caret', userMenuOpen ? 'up' : ''].filter(Boolean).join(' ')}
                    viewBox="0 0 14 14"
                    aria-hidden="true"
                  >
                    <path d="m4.5 5.3 2.5 2.5 2.5-2.5" />
                  </svg>
                </span>
                <span className="ws-user-plan">
                  {planLabel}
                  <img className="ws-vip-badge" src={iconVip} alt="" aria-hidden="true" />
                </span>
              </span>
            </button>

            {/*
              个人中心 popover：承载用户身份、套餐、积分、储存空间以及常用快捷入口。
              这里属于全局账户操作区，也是团队和计费入口的主要挂载位置。
            */}
            {userMenuOpen && (
              <div className="ws-pop" role="dialog" aria-label="个人中心">
                <header className="ws-pop-head">
                  <span className="ws-pop-avatar" aria-hidden="true">
                    {avatarText}
                  </span>
                  <div className="ws-pop-id">
                    <div className="ws-pop-name-row">
                      <strong>{displayName}</strong>
                      {roleLabel && <span className="ws-pop-role">{roleLabel}</span>}
                    </div>
                    <div className="ws-pop-team">
                      <svg viewBox="0 0 14 14" aria-hidden="true">
                        <circle cx="5" cy="4.2" r="2.2" />
                        <path d="M1.6 11.5c.4-2 1.8-3 3.4-3s3 1 3.4 3" />
                        <circle cx="10.5" cy="5" r="1.6" />
                      </svg>
                      <span>{workspaceName}</span>
                      <svg className="ws-pop-team-caret" viewBox="0 0 12 12" aria-hidden="true">
                        <path d="m3.5 4.5 2.5 2.5 2.5-2.5" />
                      </svg>
                    </div>
                  </div>
                  <div className="ws-pop-plan">
                    <span className="ws-pop-plan-badge">
                      <img className="ws-vip-badge" src={iconVip} alt="" aria-hidden="true" />
                      {planLabel}
                    </span>
                    {expiryText && <span className="ws-pop-expiry">{expiryText} 到期</span>}
                  </div>
                </header>

                <hr className="ws-pop-divider" />

                {/* 积分 / 储存：展示当前套餐资源使用情况。 */}
                <div className="ws-pop-stats">
                  <div className="ws-pop-stat">
                    <img className="ws-pop-stat-icon" src={iconCredit} alt="" aria-hidden="true" />
                    <span className="ws-pop-stat-label">积分剩余</span>
                    <span className="ws-pop-stat-value">
                      {creditsLabel}
                      {creditsTotalLabel && <i>/{creditsTotalLabel}</i>}
                    </span>
                    <div className="ws-pop-bar">
                      <span style={{ width: creditsPercent + '%' }}></span>
                    </div>
                    {creditsTotalLabel && <span className="ws-pop-stat-foot">剩余{creditsPercent}%</span>}
                  </div>

                  <div className="ws-pop-stat">
                    <img className="ws-pop-stat-icon" src={iconStorage} alt="" aria-hidden="true" />
                    <span className="ws-pop-stat-label">储存空间</span>
                    {/* 占位：后端暂无储存空间接口，待接入后替换为真实数据 */}
                    <span className="ws-pop-stat-value">
                      3.98GB<i>/5GB</i>
                    </span>
                    <div className="ws-pop-bar">
                      <span style={{ width: '80%' }}></span>
                    </div>
                    <span className="ws-pop-stat-foot">剩余20%</span>
                  </div>
                </div>

                {/* 入口卡：我的素材 / 数据面板 / 加入新团队。 */}
                <div className="ws-pop-cards">
                  <button type="button" className="ws-pop-card" onClick={() => comingSoon('我的素材')}>
                    <img
                      className="ws-pop-card-icon"
                      src={imgMaterial}
                      alt=""
                      aria-hidden="true"
                      width={46}
                      height={40}
                    />
                    <strong>我的素材</strong>
                    <small>管理您的素材资源</small>
                    <svg className="ws-pop-card-arrow" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                  </button>

                  <button type="button" className="ws-pop-card" onClick={() => comingSoon('数据面板')}>
                    <img
                      className="ws-pop-card-icon"
                      src={imgData}
                      alt=""
                      aria-hidden="true"
                      width={46}
                      height={40}
                    />
                    <strong>数据面板</strong>
                    <small>查看广告投放数据</small>
                    <svg className="ws-pop-card-arrow" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                  </button>

                  <button type="button" className="ws-pop-card" onClick={openJoinTeam}>
                    <img
                      className="ws-pop-card-icon"
                      src={imgTeam}
                      alt=""
                      aria-hidden="true"
                      width={46}
                      height={40}
                    />
                    <strong>加入新团队</strong>
                    <small>输入邀请码加入团队空间</small>
                    <svg className="ws-pop-card-arrow" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                  </button>
                </div>

                {/* 菜单行 */}
                <nav className="ws-pop-menu">
                  <button type="button" className="ws-pop-item" onClick={openTeamManagement}>
                    <img className="ws-pop-item-icon" src={imgTeam} alt="" aria-hidden="true" />
                    <span className="ws-pop-item-label">团队管理</span>
                    <svg className="ws-pop-item-arrow" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                  </button>
                  <button type="button" className="ws-pop-item" onClick={() => comingSoon('账户设置')}>
                    <img className="ws-pop-item-icon" src={iconSettings} alt="" aria-hidden="true" />
                    <span className="ws-pop-item-label">账户设置</span>
                    <svg className="ws-pop-item-arrow" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                  </button>
                  <button type="button" className="ws-pop-item" onClick={() => openBilling('admin')}>
                    <img className="ws-pop-item-icon" src={iconSettings} alt="" aria-hidden="true" />
                    <span className="ws-pop-item-label">Provider 配置</span>
                    <svg className="ws-pop-item-arrow" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                  </button>
                  <button type="button" className="ws-pop-item" onClick={() => comingSoon('帮助中心')}>
                    <img className="ws-pop-item-icon" src={iconHelpRow} alt="" aria-hidden="true" />
                    <span className="ws-pop-item-label">帮助中心</span>
                    <svg className="ws-pop-item-arrow" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                  </button>
                  <button type="button" className="ws-pop-item" disabled={isLoggingOut} onClick={handleLogout}>
                    <span className="ws-pop-item-icon ws-pop-item-icon--logout" aria-hidden="true">
                      <img className="ws-logout-glyph" src={iconLogoutGlyph} alt="" />
                    </span>
                    <span className="ws-pop-item-label">{isLoggingOut ? '退出中' : '退出登录'}</span>
                    <svg className="ws-pop-item-arrow" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                  </button>
                </nav>
              </div>
            )}

            {userMenuOpen &&
              createPortal(
                <button
                  type="button"
                  className="ws-pop-backdrop"
                  aria-label="关闭菜单"
                  onClick={() => setUserMenuOpen(false)}
                ></button>,
                document.body,
              )}
          </div>
        )}
      </div>
    </header>
  )
}
