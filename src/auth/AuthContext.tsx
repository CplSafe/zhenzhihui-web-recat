/**
 * 鉴权会话上下文
 * 由原 App.vue 的会话初始化/刷新/登录登出逻辑移植而来。
 * 在路由根（App）下提供，路由视图经 useAuth() 读取 authSession 及 login/logout 处理器。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
  // loadAuthSession 的最新引用（供刷新失败回调调用，规避与 startSessionRefresh 的循环依赖）。
  const loadAuthSessionRef = useRef<() => Promise<void>>(async () => {})
  // 并发序号：仅最新一次会话检查的结果可写回 state，避免慢请求覆盖快请求。
  const loadSeqRef = useRef(0)

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
        // 刷新失败 → 会话可能已过期：立即重新校验会话；若确已失效会清掉登录态，
        // 由 App 的中央守卫跳转登录，而不是停留在"已登录"的死会话上。
        stopSessionRefresh()
        loadAuthSessionRef.current()
      }
    }, REFRESH_INTERVAL_MS)
  }, [stopSessionRefresh])

  const loadAuthSession = useCallback(async () => {
    const seq = ++loadSeqRef.current
    const isStale = () => seq !== loadSeqRef.current
    setIsCheckingSession(true)
    setAuthCheckError('')

    // 开发模式：仅在未配置远程后端时用 mock session 跳过鉴权。
    // 配置了 VITE_ZZH_REMOTE_ORIGIN 时走真实认证流程。
    const hasRemoteBackend = Boolean(import.meta.env.VITE_ZZH_REMOTE_ORIGIN)
    if (import.meta.env.DEV && !hasRemoteBackend) {
      const justLoggedOut = (window as any).__zzh_dev_logout__
      delete (window as any).__zzh_dev_logout__
      if (justLoggedOut) {
        // 主动退出：不 mock，走正常未登录流程 → 跳 /welcome（开屏页）
        if (!isStale()) {
          setSession(null)
          setIsAuthenticated(false)
          setAuthSession(null)
          setIsCheckingSession(false)
          clearAuthSessionMarker()
        }
        return
      }
      const mock = { user: { id: 1, nickname: 'dev' }, workspaces: [{ id: 1, name: 'dev' }] }
      setSession(mock)
      setIsAuthenticated(true)
      setAuthSession(mock)
      if (!isStale()) setIsCheckingSession(false)
      return
    }

    try {
      const session = await getAuthenticatedSession()
      if (isStale()) return
      setSession(session)
      setIsAuthenticated(true)
      setAuthSession(session)
      markAuthSessionExpected()
      sessionStorage.removeItem('zzh_sso_pending')
      startSessionRefresh()
    } catch (error: any) {
      if (isStale()) return
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
      if (!isStale()) setIsCheckingSession(false)
    }
  }, [setAuthSession, startSessionRefresh, stopSessionRefresh])

  loadAuthSessionRef.current = loadAuthSession

  const handleLoginSuccess = useCallback(
    (session?: any) => {
      sessionStorage.removeItem('zzh_sso_pending')
      if (session) {
        flushSync(() => {
          setSession(session)
          setIsAuthenticated(true)
          setAuthCheckError('')
          setAuthSession(session)
        })
        markAuthSessionExpected()
        navigate('/home', { replace: true })
        return
      }
      if (import.meta.env.DEV && !import.meta.env.VITE_ZZH_REMOTE_ORIGIN) {
        const mock = { user: { id: 1, nickname: 'dev' }, workspaces: [{ id: 1, name: 'dev' }] }
        flushSync(() => {
          setSession(mock)
          setIsAuthenticated(true)
          setAuthCheckError('')
          setAuthSession(mock)
        })
        markAuthSessionExpected()
        navigate('/home', { replace: true })
        return
      }
      loadAuthSession().then(() => {
        if (useWorkspaceSessionStore.getState().authSession) {
          navigate('/home', { replace: true })
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
    navigate('/welcome', { replace: true })
  }, [navigate, setAuthSession, stopSessionRefresh])

  // 首次挂载执行会话检查；卸载时停止刷新计时器。
  useEffect(() => {
    loadAuthSession()
    return () => stopSessionRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 用 useMemo 固定 value 引用：否则每次渲染都是新对象，会让所有 useAuth() 消费者
  // （AuthProvider 包住整个路由树）连带全树重渲染。回调已是 useCallback 稳定引用。
  const value: AuthContextValue = useMemo(
    () => ({
      authSession,
      isAuthenticated,
      isCheckingSession,
      authCheckError,
      loadAuthSession,
      handleLoginSuccess,
      handleLogoutSuccess,
    }),
    [
      authSession,
      isAuthenticated,
      isCheckingSession,
      authCheckError,
      loadAuthSession,
      handleLoginSuccess,
      handleLogoutSuccess,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
