/**
 * 共享顶栏(2.1)。Home / 智能成片 等页面统一使用,避免各页写死用户名。
 * 右侧:会员中心 + 用户头像下拉(个人面板:会员卡 / 切换空间)。可选左侧汉堡(移动端开侧栏)。
 * 用户信息来自 workspaceSession。个人中心/修改密码/退出登录已移至侧栏「设置」菜单(SettingsMenu)。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useCurrentUser, useCurrentPlanName, useWorkspaceId, useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { getReferralMyCode } from '@/api/business'
import { useAuth } from '@/auth/AuthContext'
import { useToast } from '@/composables/useToast'
import { useUiStore } from '@/stores/ui'
import UserAvatar from '@/components/common/UserAvatar'
import memberIcon from '@/assets/image.png'
import shareIcon from '@/assets/image copy 2.png'
import PersonalPanel from './PersonalPanel'
import brandLogo from '@/img/image copy 7.png'
import { APP_VERSION } from '@/version'
import './AppTopbar.css'

// 推广码缓存:按用户维度缓存,真正点「分享链接」时才拉一次。
const cachedReferralCodeByUser = new Map<string, string>()

interface AppTopbarProps {
  /** 提供则在左侧显示汉堡(移动端),点击触发(通常打开侧栏抽屉) */
  onMenu?: () => void
  /**
   * 点击「会员中心」回调。默认打开全局会员中心弹窗(取代原 /membership 路由页);
   * 传入则覆盖默认行为(兼容旧调用方)。
   */
  onMember?: () => void
}

export default function AppTopbar({ onMenu, onMember }: AppTopbarProps) {
  const navigate = useNavigate()
  const currentUser = useCurrentUser() as any
  const planName = useCurrentPlanName() as any
  const { isAuthenticated } = useAuth()
  const { showToast } = useToast()
  const openMemberCenter = useUiStore((s) => s.openMemberCenter)
  const workspaceId = useWorkspaceId()
  const loadSubscriptionLabel = useWorkspaceSessionStore((s) => s.loadSubscriptionLabel)
  const [shareLoading, setShareLoading] = useState(false)

  // 2.1 页面各自挂 AppTopbar、不走旧壳 AppLayout → 平时没人加载订阅/钱包,个人面板会显示 0/0。
  // 按当前工作空间加载一次订阅(含套餐/到期/base_credits)+ 钱包(积分),切空间也刷新。
  // (loadSubscriptionLabel 内部已会确保 billingPlans 载入,供 base_credits 从套餐兜底取值。)
  useEffect(() => {
    if (!workspaceId || !isAuthenticated) return
    void loadSubscriptionLabel?.()
  }, [workspaceId, isAuthenticated, loadSubscriptionLabel])

  // 匿名访问(未登录且无用户信息)右上角显示「登录」按钮,而非「用户」头像下拉。
  const isAnonymous = !isAuthenticated && !currentUser

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const userName = useMemo(
    () => currentUser?.nickname || currentUser?.name || currentUser?.username || '用户',
    [currentUser],
  )
  const avatarUrl = useMemo(
    () => currentUser?.avatar || currentUser?.avatar_url || currentUser?.avatarUrl || '',
    [currentUser],
  )

  // 下拉用 portal 渲染到 body,避免被任何祖先的层叠/overflow 截断;打开时按按钮位置定位。
  const toggleMenu = () => {
    setMenuOpen((v) => {
      const next = !v
      if (next && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect()
        setMenuPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
      }
      return next
    })
  }

  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: PointerEvent) {
      const t = e.target as Node
      if (boxRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [menuOpen])

  const handleMember = () => {
    setMenuOpen(false)
    // 优先用调用方覆盖;默认唤出全局会员中心弹窗。
    if (onMember) {
      onMember()
      return
    }
    openMemberCenter()
  }

  // 分享链接:点击时再拉推广码。新用户点开 → /login?invite_code=… → 注册时带上推广码。
  const handleShare = async () => {
    if (shareLoading) return
    const cacheKey = String(currentUser?.id || currentUser?.user_id || currentUser?.mobile || 'anon')
    setShareLoading(true)
    try {
      let referralCode = cachedReferralCodeByUser.get(cacheKey) || ''
      if (!referralCode && isAuthenticated) {
        referralCode = await getReferralMyCode()
        if (referralCode) cachedReferralCodeByUser.set(cacheKey, referralCode)
      }
      const link = referralCode
        ? `${window.location.origin}/login?invite_code=${encodeURIComponent(referralCode)}`
        : window.location.origin
      await navigator.clipboard.writeText(link)
      showToast(referralCode ? '推广链接已复制' : '分享链接已复制', 'success')
    } catch {
      showToast('复制失败,请手动复制链接', 'error')
    } finally {
      setShareLoading(false)
    }
  }

  return (
    <header className="apptop">
      {/* 窄屏(≤900px)左上角:汉堡 + LOGO。点击汉堡滑出 AppSidebar 抽屉。桌面端隐藏。 */}
      {onMenu && (
        <div className="apptop__mobile-lead">
          <button type="button" className="apptop__hamburger" aria-label="打开菜单" onClick={onMenu}>
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
          <img className="apptop__logo" src={brandLogo} alt="帧智汇" width={32} height={32} />
          <span className="apptop__brand-text">
            <strong className="apptop__brand-name">帧智汇</strong>
            <em className="apptop__brand-version">v{APP_VERSION}</em>
          </span>
        </div>
      )}
      <div className="apptop__right">
        {/* 分享链接:仅登录后展示(未登录不可分享)。珊瑚圆角方块 + 链条图标 */}
        {!isAnonymous && (
          <button type="button" className="apptop__share" onClick={handleShare} disabled={shareLoading}>
            <img className="apptop__share-icon" src={shareIcon} alt="" width={24} height={24} />
            {shareLoading ? '生成中...' : '分享链接'}
          </button>
        )}
        <button type="button" className="apptop__member" data-guide="topbar-member" onClick={handleMember}>
          <img className="apptop__member-icon" src={memberIcon} alt="" />
          {planName ? String(planName) : '会员中心'}
        </button>
        {isAnonymous ? (
          <button
            type="button"
            className="apptop__signin"
            onClick={() => navigate('/login', { state: { from: '/home' } })}
          >
            登录
          </button>
        ) : (
          <div className="apptop__user" ref={boxRef}>
            <button
              ref={btnRef}
              type="button"
              className="apptop__user-btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={toggleMenu}
            >
              <UserAvatar
                src={avatarUrl}
                name={userName}
                className="apptop__avatar apptop__avatar--img"
                fallbackClassName="apptop__avatar"
              />
              <span className="apptop__user-name">{userName}</span>
              <span className={`apptop__caret${menuOpen ? ' is-open' : ''}`}>⌄</span>
            </button>
          </div>
        )}
      </div>

      {menuOpen &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="apptop__menu apptop__menu--panel"
            role="menu"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <PersonalPanel onMember={handleMember} onClose={() => setMenuOpen(false)} />
          </div>,
          document.body,
        )}
    </header>
  )
}
