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
import './App.css'

function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const matches = useMatches()
  const { isAuthenticated, isCheckingSession, authCheckError, loadAuthSession } = useAuth()

  // 当前路由是否需要鉴权（默认 true，仅 login 标记 requiresAuth:false）。
  const requiresAuth = !matches.some((m) => (m.handle as any)?.requiresAuth === false)

  // 中央跳转守卫（对应原 App.vue 的 watch）。
  useEffect(() => {
    if (isCheckingSession) return
    if (authCheckError) return

    if (requiresAuth && !isAuthenticated) {
      navigate('/login', { replace: true })
      return
    }
    if (!requiresAuth && isAuthenticated && location.pathname === '/login') {
      navigate('/creative/blank', { replace: true })
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
              <button type="button" className="ghost" onClick={() => navigate('/login', { replace: true })}>
                前往登录
              </button>
            </div>
          </div>
        </div>
      ) : (
        <Outlet />
      )}

      {/* 全局单例 */}
      <AppToast />
      <AppConfirmDialog />
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
