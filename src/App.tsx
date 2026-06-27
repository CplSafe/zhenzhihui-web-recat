/**
 * App — 应用根布局
 * 管理鉴权会话初始化、页面级跳转守卫（登录页 vs 受保护页）、全局 Toast/Confirm 挂载。
 * 由原 App.vue 移植。RouterView → <Outlet/>。
 */
import { useEffect } from 'react'
import { Outlet, useLocation, useMatches, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import AppToast from './components/AppToast'
import AppConfirmDialog from './components/AppConfirmDialog'
import HelpCenter from './components/common/HelpCenter'
import MemberCenterModal from './components/MemberCenterModal'
import ComingSoonDialog from './components/ComingSoonDialog'
import { useUiStore } from './stores/ui'
import './App.css'

// 退出登录标记：dev 模式下 AuthContext 用 mock session 绕过 API 检查，
// 此时主动退出需清除 mock 标记，让守卫正常跳转到 /login。
export const DEV_LOGOUT_FLAG = '__zzh_dev_logout__'
export function markDevLogout() {
  ;(window as any)[DEV_LOGOUT_FLAG] = true
}

function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const matches = useMatches()
  const { isAuthenticated, isCheckingSession, authCheckError, loadAuthSession } = useAuth()

  // 会员中心:全局单例弹窗,任意页面顶栏点「会员中心」均可唤出(取代原 /membership 路由页)。
  const memberCenterOpen = useUiStore((s) => s.memberCenterOpen)
  const closeMemberCenter = useUiStore((s) => s.closeMemberCenter)

  const requiresAuth = !matches.some((m) => (m.handle as any)?.requiresAuth === false)

  useEffect(() => {
    if (isCheckingSession) return
    if (authCheckError) return

    // 受保护页(项目管理 / 素材市场等)未登录 → 直接去登录页(「需登录」)。
    // 不再用全屏游客遮罩(它会盖住侧边栏导致无法切换其它菜单)。
    if (requiresAuth && !isAuthenticated) {
      navigate('/login', { replace: true })
      return
    }
    if (!requiresAuth && isAuthenticated && (location.pathname === '/login' || location.pathname === '/welcome')) {
      navigate('/home', { replace: true })
    }
  }, [isAuthenticated, isCheckingSession, authCheckError, requiresAuth, location.pathname, navigate])

  return (
    <>
      {isCheckingSession ? (
        <div className="auth-session-loading" aria-label="登录状态检查中" />
      ) : authCheckError && requiresAuth ? (
        <div className="auth-session-error">
          <div className="auth-session-error__card">
            <strong>登录状态检查失败</strong>
            <p>{authCheckError}</p>
            <div className="auth-session-error__actions">
              <button type="button" onClick={() => loadAuthSession()}>
                重新检查
              </button>
              <button type="button" className="ghost" onClick={() => navigate('/welcome', { replace: true })}>
                前往开屏页
              </button>
            </div>
          </div>
        </div>
      ) : (
        <Outlet />
      )}

      {/* 会员中心全局弹窗:最高优先级全屏遮罩 + 右上角 X 关闭,任意页面可唤出 */}
      <MemberCenterModal open={memberCenterOpen} onClose={closeMemberCenter} />

      {/* 「功能待开放」全局弹窗:任意页面点未上线项时统一弹出 */}
      <ComingSoonDialog />

      <AppToast />
      <AppConfirmDialog />
      {/* 帮助中心悬浮球:仅在已登录的业务页显示,登录/开屏页不显示 */}
      {requiresAuth && isAuthenticated && !isCheckingSession && <HelpCenter />}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
