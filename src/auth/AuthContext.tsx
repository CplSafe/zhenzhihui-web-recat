/**
 * 鉴权会话上下文
 * 由原 App.vue 的会话初始化/刷新/登录登出逻辑移植而来。
 * 在路由根（App）下提供，路由视图经 useAuth() 读取 authSession 及 login/logout 处理器。
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  clearAuthSessionMarker,
  getAuthErrorMessage,
  getAuthenticatedSession,
  isUnauthorizedAuthError,
  markAuthSessionExpected,
  refreshSession,
} from '../api/auth'
import { useWorkspaceSessionStore } from '../stores/workspaceSession'

const REFRESH_INTERVAL_MS = 20 * 60 * 1000 // 20 minutes

export interface AuthContextValue {
  authSession: any
  isAuthenticated: boolean
  isCheckingSession: boolean
  authCheckError: string
  loadAuthSession: () => Promise<void>
  handleLoginSuccess: (session?: any) => void
  handleLogoutSuccess: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const setAuthSession = useWorkspaceSessionStore((s) => s.setAuthSession)

  const [authSession, setSession] = useState<any>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [authCheckError, setAuthCheckError] = useState('')

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopSessionRefresh = useCallback(() => {
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current)
      refreshTimer.current = null
    }
  }, [])

  const startSessionRefresh = useCallback(() => {
    stopSessionRefresh()
    refreshTimer.current = setInterval(async () => {
      try {
        await refreshSession()
      } catch {
        // 刷新失败 → 会话可能已过期，交由后续 API 调用或下次 loadAuthSession 处理跳转。
        stopSessionRefresh()
      }
    }, REFRESH_INTERVAL_MS)
  }, [stopSessionRefresh])

  const loadAuthSession = useCallback(async () => {
    setIsCheckingSession(true)
    setAuthCheckError('')
    try {
      const session = await getAuthenticatedSession()
      setSession(session)
      setIsAuthenticated(true)
      setAuthSession(session)
      markAuthSessionExpected()
      sessionStorage.removeItem('zzh_sso_pending')
      startSessionRefresh()
    } catch (error: any) {
      stopSessionRefresh()
      setSession(null)
      setIsAuthenticated(false)
      setAuthSession(null)

      const ssoPending = sessionStorage.getItem('zzh_sso_pending')
      if (ssoPending) {
        sessionStorage.removeItem('zzh_sso_pending')
        setAuthCheckError('统一认证登录失败，请使用手机号登录或重试')
      } else if (isUnauthorizedAuthError(error)) {
        clearAuthSessionMarker()
      } else {
        setAuthCheckError(getAuthErrorMessage(error, '登录状态检查失败，请检查代理或接口服务'))
      }
    } finally {
      setIsCheckingSession(false)
    }
  }, [setAuthSession, startSessionRefresh, stopSessionRefresh])

  const handleLoginSuccess = useCallback(
    (session?: any) => {
      sessionStorage.removeItem('zzh_sso_pending')
      if (session) {
        setSession(session)
        setIsAuthenticated(true)
        setAuthCheckError('')
        setAuthSession(session)
        markAuthSessionExpected()
        navigate('/creative/blank', { replace: true })
        return
      }
      loadAuthSession().then(() => {
        // isAuthenticated 更新是异步的；用 store/重新取值判断后再导航。
        if (useWorkspaceSessionStore.getState().authSession) {
          navigate('/creative/blank', { replace: true })
        }
      })
    },
    [loadAuthSession, navigate, setAuthSession],
  )

  const handleLogoutSuccess = useCallback(() => {
    stopSessionRefresh()
    setSession(null)
    setIsAuthenticated(false)
    setIsCheckingSession(false)
    setAuthCheckError('')
    setAuthSession(null)
    clearAuthSessionMarker()
    navigate('/login', { replace: true })
  }, [navigate, setAuthSession, stopSessionRefresh])

  // 首次挂载执行会话检查；卸载时停止刷新计时器。
  useEffect(() => {
    loadAuthSession()
    return () => stopSessionRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value: AuthContextValue = {
    authSession,
    isAuthenticated,
    isCheckingSession,
    authCheckError,
    loadAuthSession,
    handleLoginSuccess,
    handleLogoutSuccess,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
