/**
 * 共享顶栏(2.1)。Home / 智能成片 等页面统一使用,避免各页写死用户名。
 * 右侧:会员中心 + 用户头像下拉(会员中心 / 退出登录)。可选左侧汉堡(移动端开侧栏)。
 * 用户信息来自 workspaceSession;退出走 logoutSession + AuthContext。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCurrentUser, useCurrentPlanName } from '@/stores/workspaceSession'
import { logoutSession, getAuthErrorMessage } from '@/api/auth'
import { useAuth } from '@/auth/AuthContext'
import { useToast } from '@/composables/useToast'
import { shouldClearSessionAfterLogoutFailure } from '@/utils/workflowGuards'
import './AppTopbar.css'

interface AppTopbarProps {
  /** 提供则在左侧显示汉堡(移动端),点击触发(通常打开侧栏抽屉) */
  onMenu?: () => void
  /** 点击「会员中心」回调(默认提示待开放) */
  onMember?: () => void
}

export default function AppTopbar({ onMenu, onMember }: AppTopbarProps) {
  const currentUser = useCurrentUser() as any
  const planName = useCurrentPlanName() as any
  const { handleLogoutSuccess } = useAuth()
  const { showToast } = useToast()

  const [menuOpen, setMenuOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const userName = useMemo(
    () => currentUser?.nickname || currentUser?.name || currentUser?.username || '用户',
    [currentUser],
  )

  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [menuOpen])

  const handleMember = () => {
    setMenuOpen(false)
    if (onMember) onMember()
    else showToast('会员中心待开放', 'info')
  }

  async function handleLogout() {
    if (isLoggingOut) return
    setMenuOpen(false)
    setIsLoggingOut(true)
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
      {onMenu && (
        <button type="button" className="apptop__menu" aria-label="打开菜单" onClick={onMenu}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      )}
      <div className="apptop__right">
        <button type="button" className="apptop__member" onClick={handleMember}>
          <span className="apptop__member-icon">★</span>
          {planName ? String(planName) : '会员中心'}
        </button>
        <div className="apptop__user" ref={boxRef}>
          <button
            type="button"
            className="apptop__user-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="apptop__avatar">{userName.slice(0, 1)}</span>
            <span className="apptop__user-name">{userName}</span>
            <span className={`apptop__caret${menuOpen ? ' is-open' : ''}`}>⌄</span>
          </button>
          {menuOpen && (
            <div className="apptop__menu" role="menu">
              <button type="button" className="apptop__menu-item" role="menuitem" onClick={handleMember}>
                会员中心
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
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
