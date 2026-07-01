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
  resetAuthenticatedSession,
} from '../api/auth'
import { useWorkspaceSessionStore } from '../stores/workspaceSession'
import { clearSmartDraft } from '../utils/smartDraft'
import { clearAllCache } from '../utils/swrCache'

// 登出时清掉本地在制草稿(智能成片全局键 + 爆款复制按空间键)。
// 这些草稿键不按用户隔离,不清的话同一浏览器换账号时新用户会继承上个用户的在制项目,
// 触发「在制重定向 → /smart/:id 后端 404 → 一直项目加载失败」。
function clearLocalDraftsOnLogout() {
  try {
    clearSmartDraft()
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith('zzh_hotcopy_draft_')) window.localStorage.removeItem(k)
    }
  } catch {
    /* 隐私模式 / SSR:忽略 */
  }
}

// 续期调度:优先按【后端返回的 TTL】在到期前续期;拿不到 TTL 时用兜底间隔。
const REFRESH_DEFAULT_MS = 4 * 60 * 1000 // TTL 未知时的兜底间隔:4 分钟(稳在常见短 access-token TTL 内)
const REFRESH_SAFETY_RATIO = 0.7 // 在 TTL 的 70% 处续期,留出余量(到期前就换好新 token)
const REFRESH_MIN_MS = 60 * 1000 // 续期最短间隔 1 分钟(防止极短 TTL 触发刷新风暴)
const REFRESH_MAX_MS = 10 * 60 * 1000 // 续期最长间隔 10 分钟
const VISIBILITY_REFRESH_GAP_MS = 2 * 60 * 1000 // 回到页面时:距上次续期超过 2 分钟才再续,避免频繁刷新

// 从 session/refresh 响应里尽量解析出 access-token 的剩余有效期(毫秒)。
// 兼容多种后端字段名:相对秒数(expires_in 等)或绝对过期时间戳/ISO(expires_at 等)。拿不到返回 0。
function extractSessionTtlMs(resp: any): number {
  if (!resp || typeof resp !== 'object') return 0
  const inSec = Number(
    resp.expires_in ??
      resp.access_expires_in ??
      resp.expire_in ??
      resp.ttl ??
      resp.session?.expires_in ??
      resp.data?.expires_in ??
      0,
  )
  if (inSec > 0) return inSec * 1000
  const at =
    resp.expires_at ?? resp.expire_at ?? resp.access_expires_at ?? resp.expiresAt ?? resp.session?.expires_at ?? null
  if (at != null) {
    let ms = 0
    if (typeof at === 'number')
      ms = at < 1e12 ? at * 1000 : at // 10 位秒 / 13 位毫秒
    else {
      const t = new Date(at).getTime()
      if (!Number.isNaN(t)) ms = t
    }
    const delta = ms - Date.now()
    if (delta > 0) return delta
  }
  return 0
}

// 据响应 TTL 计算下次续期延迟:有 TTL → TTL×70%(clamp 到 [1min,10min]);无 → 4min 兜底。
function computeRefreshDelay(resp?: any): number {
  const ttl = extractSessionTtlMs(resp)
  if (ttl > 0) return Math.min(REFRESH_MAX_MS, Math.max(REFRESH_MIN_MS, Math.floor(ttl * REFRESH_SAFETY_RATIO)))
  return REFRESH_DEFAULT_MS
}

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

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // loadAuthSession 的最新引用（供刷新失败回调调用，规避与 startSessionRefresh 的循环依赖）。
  const loadAuthSessionRef = useRef<() => Promise<void>>(async () => {})
  // 并发序号：仅最新一次会话检查的结果可写回 state，避免慢请求覆盖快请求。
  const loadSeqRef = useRef(0)
  // 上次成功续期的时间戳，供「回到页面时续期」节流用。
  const lastRefreshRef = useRef(0)

  const stopSessionRefresh = useCallback(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current)
      refreshTimer.current = null
    }
  }, [])

  // 自重排续期:每次续期成功后,按【本次响应的 TTL】安排下一次,确保始终在 token 到期前换好新 token。
  // initialResp 为初次会话响应(loadAuthSession 传入),用它的 TTL 决定首次续期时机。
  const startSessionRefresh = useCallback(
    (initialResp?: any) => {
      stopSessionRefresh()
      lastRefreshRef.current = Date.now()
      const scheduleNext = (resp?: any) => {
        refreshTimer.current = setTimeout(async () => {
          try {
            const next = await refreshSession()
            lastRefreshRef.current = Date.now()
            scheduleNext(next) // 按本次 refresh 返回的 TTL 安排下一次
          } catch {
            // 刷新失败 → 会话可能已过期：立即重新校验会话；若确已失效会清掉登录态,
            // 由 App 的中央守卫跳转登录,而不是停留在"已登录"的死会话上。
            stopSessionRefresh()
            loadAuthSessionRef.current()
          }
        }, computeRefreshDelay(resp))
      }
      scheduleNext(initialResp)
    },
    [stopSessionRefresh],
  )

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
      startSessionRefresh(session) // 用初次会话的 TTL(若有)决定首次续期时机
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
    // 作废任何在途的会话校验:bump 序号让其 isStale() 命中,不再写状态;并丢弃共享 in-flight promise。
    // 否则登出前发起的 getAuthenticatedSession 若在此之后 resolve,会把刚清掉的会话「复活」。
    loadSeqRef.current++
    resetAuthenticatedSession()
    setSession(null)
    setIsAuthenticated(false)
    setIsCheckingSession(false)
    setAuthCheckError('')
    setAuthSession(null)
    clearAuthSessionMarker()
    clearLocalDraftsOnLogout() // #4:换账号前清掉上个用户的在制草稿,避免新用户继承导致「项目加载失败」
    clearAllCache() // 清 SWR sessionStorage 缓存,避免换账号沿用上个会话的缓存数据
    navigate('/welcome', { replace: true })
  }, [navigate, setAuthSession, stopSessionRefresh])

  // 首次挂载执行会话检查；卸载时停止刷新计时器。
  useEffect(() => {
    loadAuthSession()
    return () => stopSessionRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 回到页面 / 窗口重新聚焦时主动续期一次(后台标签页计时器会被节流,切回来可能已临近过期)。
  useEffect(() => {
    if (!isAuthenticated) return
    const maybeRefresh = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastRefreshRef.current < VISIBILITY_REFRESH_GAP_MS) return
      lastRefreshRef.current = now
      refreshSession()
        .then(() => {
          lastRefreshRef.current = Date.now()
        })
        .catch(() => {
          stopSessionRefresh()
          loadAuthSessionRef.current()
        })
    }
    document.addEventListener('visibilitychange', maybeRefresh)
    window.addEventListener('focus', maybeRefresh)
    return () => {
      document.removeEventListener('visibilitychange', maybeRefresh)
      window.removeEventListener('focus', maybeRefresh)
    }
  }, [isAuthenticated, stopSessionRefresh])

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
