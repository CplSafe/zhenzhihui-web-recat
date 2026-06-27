/**
 * 共享顶栏(2.1)。Home / 智能成片 等页面统一使用,避免各页写死用户名。
 * 右侧:会员中心 + 用户头像下拉(会员中心 / 退出登录)。可选左侧汉堡(移动端开侧栏)。
 * 用户信息来自 workspaceSession;退出走 logoutSession + AuthContext。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCurrentUser, useCurrentPlanName } from '@/stores/workspaceSession'
import { logoutSession, getAuthErrorMessage } from '@/api/auth'
import { useAuth } from '@/auth/AuthContext'
import { useToast } from '@/composables/useToast'
import { useUiStore } from '@/stores/ui'
import { shouldClearSessionAfterLogoutFailure } from '@/utils/workflowGuards'
import { markDevLogout } from '@/App'
import brandLogo from '@/img/image copy 7.png'
import { APP_VERSION } from '@/version'
import AuthActionModal from '@/components/auth/AuthActionModal'
import './AppTopbar.css'

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
  const currentUser = useCurrentUser() as any
  const planName = useCurrentPlanName() as any
  const { handleLogoutSuccess } = useAuth()
  const { showToast } = useToast()
  const openMemberCenter = useUiStore((s) => s.openMemberCenter)

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [pwdModalOpen, setPwdModalOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const userName = useMemo(
    () => currentUser?.nickname || currentUser?.name || currentUser?.username || '用户',
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

  // 登录态下「修改密码」复用注册页的重置密码流程(手机号 + 新密码 + 验证码)。
  // 仅当账号字段确为手机号时才预填,避免把用户名(如 u_xxx)填进手机号框。
  const rawMobile = String(
    currentUser?.mobile || currentUser?.phone || currentUser?.phone_number || currentUser?.username || '',
  )
  const userMobile = /^1\d{10}$/.test(rawMobile) ? rawMobile : ''
  const handleChangePwd = () => {
    setMenuOpen(false)
    setPwdModalOpen(true)
  }

  async function handleLogout() {
    if (isLoggingOut) return
    setMenuOpen(false)
    setIsLoggingOut(true)

    if (import.meta.env.DEV) {
      setIsLoggingOut(false)
      markDevLogout()
      handleLogoutSuccess()
      return
    }

    try {
      await logoutSession()
      showToast('已退出登录', 'success')
      setIsLoggingOut(false)
      handleLogoutSuccess()
    } catch (error) {
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
        <button type="button" className="apptop__member" onClick={handleMember}>
          <span className="apptop__member-icon">★</span>
          {planName ? String(planName) : '会员中心'}
        </button>
        <div className="apptop__user" ref={boxRef}>
          <button
            ref={btnRef}
            type="button"
            className="apptop__user-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={toggleMenu}
          >
            <span className="apptop__avatar">{userName.slice(0, 1)}</span>
            <span className="apptop__user-name">{userName}</span>
            <span className={`apptop__caret${menuOpen ? ' is-open' : ''}`}>⌄</span>
          </button>
        </div>
      </div>

      {menuOpen &&
        menuPos &&
        createPortal(
          <div ref={menuRef} className="apptop__menu" role="menu" style={{ top: menuPos.top, right: menuPos.right }}>
            <button type="button" className="apptop__menu-item" role="menuitem" onClick={handleMember}>
              会员中心
            </button>
            <button type="button" className="apptop__menu-item" role="menuitem" onClick={handleChangePwd}>
              修改密码
            </button>
            <button
              type="button"
              className="apptop__menu-item apptop__menu-item--danger"
              role="menuitem"
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? '退出中…' : '退出登录'}
            </button>
          </div>,
          document.body,
        )}

      {pwdModalOpen && (
        <AuthActionModal
          mode="forgot"
          title="修改密码"
          ensureAuthStart={async () => null}
          prefill={{ mobile: userMobile }}
          lockMobile={!!userMobile}
          onClose={() => setPwdModalOpen(false)}
          onResetDone={() => setPwdModalOpen(false)}
        />
      )}
    </header>
  )
}
