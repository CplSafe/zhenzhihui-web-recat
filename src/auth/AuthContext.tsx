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
import { clearHotCopyDraftsForUser } from '../utils/hotCopyDraft'
import { clearSmartEntryDraftsForUser } from '../utils/smartEntryDraft'
import { clearSmartDraftsForUser } from '../utils/smartDraft'
import { clearAllCache } from '../utils/swrCache'
import { beginLogoutDraftWriteBarrier, releaseLogoutDraftWriteBarrier } from '../utils/logoutBarrier'
import { detachRunningVideoGensForOwner } from '../utils/videoGenRegistry'
import { hasConfiguredDevBackend } from '../utils/devBackend'

/** 用于通知同浏览器其他标签页同步登出的 localStorage 事件键。 */
const AUTH_LOGOUT_EVENT_KEY = 'zzh.auth.logout-event.v1'

/** 从不同后端会话字段中提取稳定的用户草稿隔离标识。 */
function getDraftUserScopeFromSession(session: any): string {
  const user = session?.user || {}
  return String(user.id ?? user.user_id ?? user.userId ?? user.account_id ?? user.uid ?? '').trim()
}

/** 从工作空间 store 中读取当前会话对应的草稿用户域。 */
function getCurrentDraftUserScope(): string {
  return getDraftUserScopeFromSession(useWorkspaceSessionStore.getState().authSession)
}

/** 登录成功后只解除该用户的登出写入屏障。 */
function releaseDraftWriteBarrierForSession(session: any): void {
  const ownerScope = getDraftUserScopeFromSession(session)
  if (ownerScope) releaseLogoutDraftWriteBarrier(ownerScope)
}

/**
 * 登出时只删除当前账号的本地草稿。
 * 其他账号的 user-scoped 草稿必须保留；无法归属的旧键由各清理函数安全移除。
 */
function clearLocalDraftsOnLogout(userId: string) {
  try {
    clearSmartDraftsForUser(userId)
    clearHotCopyDraftsForUser(userId)
    clearSmartEntryDraftsForUser(userId)
  } catch {
    /* 隐私模式 / SSR:忽略 */
  }
}

/** 会话续期策略：优先按后端 TTL 在到期前刷新，无 TTL 时使用固定兜底间隔。 */
const REFRESH_DEFAULT_MS = 4 * 60 * 1000 // TTL 未知时的兜底间隔:4 分钟(稳在常见短 access-token TTL 内)
const REFRESH_SAFETY_RATIO = 0.7 // 在 TTL 的 70% 处续期,留出余量(到期前就换好新 token)
const REFRESH_MIN_MS = 60 * 1000 // 续期最短间隔 1 分钟(防止极短 TTL 触发刷新风暴)
const REFRESH_MAX_MS = 10 * 60 * 1000 // 续期最长间隔 10 分钟
const VISIBILITY_REFRESH_GAP_MS = 2 * 60 * 1000 // 回到页面时:距上次续期超过 2 分钟才再续,避免频繁刷新

/**
 * 从 session/refresh 响应中解析 access-token 剩余有效期（毫秒）。
 * 兼容相对秒数、绝对时间戳和 ISO 日期，无法识别时返回 0。
 */
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

/** 按 TTL 的 70% 计算续期延迟，并限制在 1–10 分钟以避免刷新风暴或过期窗口。 */
function computeRefreshDelay(resp?: any): number {
  const ttl = extractSessionTtlMs(resp)
  if (ttl > 0) return Math.min(REFRESH_MAX_MS, Math.max(REFRESH_MIN_MS, Math.floor(ttl * REFRESH_SAFETY_RATIO)))
  return REFRESH_DEFAULT_MS
}

/** 路由树可消费的鉴权状态与登录、登出处理器。 */
export interface AuthContextValue {
  authSession: any
  isAuthenticated: boolean
  isCheckingSession: boolean
  authCheckError: string
  loadAuthSession: () => Promise<void>
  handleLoginSuccess: (session?: any) => void
  handleLogoutStart: () => void
  handleLogoutCancelled: () => void
  handleLogoutSuccess: () => void
}

/** 鉴权上下文实例，null 用于识别组件被误用在 Provider 外部。 */
const AuthContext = createContext<AuthContextValue | null>(null)

/** 读取当前鉴权上下文，脱离 AuthProvider 使用时立即报错。 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用')
  return ctx
}

/**
 * 统一管理会话初始化、单飞续期、跨标签登出与账号草稿隔离。
 * 登出会先阻断旧账号和匿名域的延迟写入，防止已卸载页面将私有草稿落到 anon 键下。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const setAuthSession = useWorkspaceSessionStore((s) => s.setAuthSession)

  const [authSession, setSession] = useState<any>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [authCheckError, setAuthCheckError] = useState('')

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshEpochRef = useRef(0)
  const refreshInFlightRef = useRef<{
    epoch: number
    controller: AbortController
    promise: Promise<any>
  } | null>(null)
  // loadAuthSession 的最新引用（供刷新失败回调调用，规避与 startSessionRefresh 的循环依赖）。
  const loadAuthSessionRef = useRef<() => Promise<void>>(async () => {})
  // loadAuthSession 定义在登出清理回调之前；通过 ref 复用同一条隐私安全清理链，
  // 避免自动会话失效路径为了声明顺序而复制一份容易漂移的清理逻辑。
  const clearLocalAuthStateRef = useRef<(draftUserScope: string, broadcast: boolean) => void>(() => {})
  // 并发序号：仅最新一次会话检查的结果可写回 state，避免慢请求覆盖快请求。
  const loadSeqRef = useRef(0)
  // 上次成功续期的时间戳，供「回到页面时续期」节流用。
  const lastRefreshRef = useRef(0)

  const stopSessionRefresh = useCallback(() => {
    refreshEpochRef.current += 1
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current)
      refreshTimer.current = null
    }
    refreshInFlightRef.current?.controller.abort()
    refreshInFlightRef.current = null
  }, [])

  const runSessionRefresh = useCallback((): Promise<any> => {
    const epoch = refreshEpochRef.current
    const existing = refreshInFlightRef.current
    if (existing?.epoch === epoch) return existing.promise

    const controller = new AbortController()
    const promise = refreshSession({ signal: controller.signal })
    const entry = { epoch, controller, promise }
    refreshInFlightRef.current = entry
    void promise
      .finally(() => {
        if (refreshInFlightRef.current === entry) refreshInFlightRef.current = null
      })
      .catch(() => undefined)
    return promise
  }, [])

  // 自重排续期:每次续期成功后,按【本次响应的 TTL】安排下一次,确保始终在 token 到期前换好新 token。
  // initialResp 为初次会话响应(loadAuthSession 传入),用它的 TTL 决定首次续期时机。
  const startSessionRefresh = useCallback(
    (initialResp?: any) => {
      stopSessionRefresh()
      const refreshEpoch = refreshEpochRef.current
      lastRefreshRef.current = Date.now()
      const scheduleNext = (resp?: any) => {
        refreshTimer.current = setTimeout(async () => {
          if (refreshEpochRef.current !== refreshEpoch) return
          try {
            const next = await runSessionRefresh()
            if (refreshEpochRef.current !== refreshEpoch) return
            lastRefreshRef.current = Date.now()
            scheduleNext(next) // 按本次 refresh 返回的 TTL 安排下一次
          } catch {
            if (refreshEpochRef.current !== refreshEpoch) return
            // 刷新失败 → 会话可能已过期：立即重新校验会话；若确已失效会清掉登录态,
            // 由 App 的中央守卫跳转登录,而不是停留在"已登录"的死会话上。
            stopSessionRefresh()
            loadAuthSessionRef.current()
          }
        }, computeRefreshDelay(resp))
      }
      scheduleNext(initialResp)
    },
    [runSessionRefresh, stopSessionRefresh],
  )

  const loadAuthSession = useCallback(async () => {
    const seq = ++loadSeqRef.current
    const isStale = () => seq !== loadSeqRef.current
    setIsCheckingSession(true)
    setAuthCheckError('')

    // 开发模式：仅在未配置代理后端时用 mock session 跳过鉴权。
    const hasRemoteBackend = hasConfiguredDevBackend()
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
      if (isStale()) return
      setSession(mock)
      setIsAuthenticated(true)
      setAuthSession(mock)
      releaseDraftWriteBarrierForSession(mock)
      setIsCheckingSession(false)
      return
    }

    try {
      const session = await getAuthenticatedSession()
      if (isStale()) return
      setSession(session)
      setIsAuthenticated(true)
      setAuthSession(session)
      releaseDraftWriteBarrierForSession(session)
      markAuthSessionExpected()
      sessionStorage.removeItem('zzh_sso_pending')
      startSessionRefresh(session) // 用初次会话的 TTL(若有)决定首次续期时机
    } catch (error: any) {
      if (isStale()) return
      const existingDraftUserScope = getCurrentDraftUserScope()
      if (existingDraftUserScope) {
        // 已登录会话自动过期/被服务端撤销时，与显式登出使用同一条清理链。
        // 必须在 store 切到 anon 之前同时封锁旧账号与 anon，防止仍挂载的
        // /smart、/hot-copy 页面把旧内容异步保存到匿名草稿。
        clearLocalAuthStateRef.current(existingDraftUserScope, false)
      } else {
        // 首次匿名访客的会话探测失败不应永久封锁 anon 草稿。
        stopSessionRefresh()
        setSession(null)
        setIsAuthenticated(false)
        setAuthSession(null)
      }

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
      // A login result is newer than any session bootstrap already in flight.
      loadSeqRef.current += 1
      resetAuthenticatedSession()
      if (session) {
        flushSync(() => {
          setSession(session)
          setIsAuthenticated(true)
          setAuthCheckError('')
          setAuthSession(session)
        })
        releaseDraftWriteBarrierForSession(session)
        markAuthSessionExpected()
        startSessionRefresh(session)
        navigate('/home', { replace: true })
        return
      }
      if (import.meta.env.DEV && !hasConfiguredDevBackend()) {
        const mock = { user: { id: 1, nickname: 'dev' }, workspaces: [{ id: 1, name: 'dev' }] }
        flushSync(() => {
          setSession(mock)
          setIsAuthenticated(true)
          setAuthCheckError('')
          setAuthSession(mock)
        })
        releaseDraftWriteBarrierForSession(mock)
        markAuthSessionExpected()
        startSessionRefresh(mock)
        navigate('/home', { replace: true })
        return
      }
      loadAuthSession().then(() => {
        if (useWorkspaceSessionStore.getState().authSession) {
          navigate('/home', { replace: true })
        }
      })
    },
    [loadAuthSession, navigate, setAuthSession, startSessionRefresh],
  )

  const clearLocalAuthState = useCallback(
    (draftUserScope: string, broadcast: boolean) => {
      // The store switches every draft helper to the anonymous scope when the
      // session is cleared. Block both identities first so unmount cleanups or
      // delayed callbacks cannot recreate the signed-out user's draft under
      // an `anon` key.
      beginLogoutDraftWriteBarrier(draftUserScope)
      beginLogoutDraftWriteBarrier('anon')
      stopSessionRefresh()
      // 作废任何在途的会话校验:bump 序号让其 isStale() 命中,不再写状态;并丢弃共享 in-flight promise。
      // 否则登出前发起的 getAuthenticatedSession 若在此之后 resolve,会把刚清掉的会话「复活」。
      loadSeqRef.current++
      resetAuthenticatedSession()
      setSession(null)
      setIsAuthenticated(false)
      setIsCheckingSession(false)
      setAuthCheckError('')
      clearLocalDraftsOnLogout(draftUserScope)
      clearLocalDraftsOnLogout('anon')
      detachRunningVideoGensForOwner(draftUserScope)
      setAuthSession(null)
      clearAuthSessionMarker()
      clearAllCache() // 清 SWR sessionStorage 缓存,避免换账号沿用上个会话的缓存数据
      if (broadcast) {
        try {
          localStorage.setItem(
            AUTH_LOGOUT_EVENT_KEY,
            JSON.stringify({
              userId: draftUserScope,
              nonce: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            }),
          )
        } catch {
          /* Storage may be unavailable; the current tab is still cleared. */
        }
      }
      navigate('/welcome', { replace: true })
    },
    [navigate, setAuthSession, stopSessionRefresh],
  )
  clearLocalAuthStateRef.current = clearLocalAuthState

  const handleLogoutStart = useCallback(() => {
    // Abort refresh before POST /logout starts, so an older refresh cannot race
    // the server logout response and restore its cookie afterward.
    stopSessionRefresh()
    loadSeqRef.current += 1
    resetAuthenticatedSession()
  }, [stopSessionRefresh])

  const handleLogoutCancelled = useCallback(() => {
    if (authSession && isAuthenticated) startSessionRefresh(authSession)
  }, [authSession, isAuthenticated, startSessionRefresh])

  const handleLogoutSuccess = useCallback(() => {
    clearLocalAuthState(getCurrentDraftUserScope(), true)
  }, [clearLocalAuthState])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_LOGOUT_EVENT_KEY || !event.newValue) return
      try {
        const payload = JSON.parse(event.newValue)
        const currentUserScope = getCurrentDraftUserScope()
        if (!currentUserScope) return
        if (String(payload?.userId || '') !== currentUserScope) return
        clearLocalAuthState(currentUserScope, false)
      } catch {
        /* Ignore malformed cross-tab events. */
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [clearLocalAuthState])

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
      const refreshEpoch = refreshEpochRef.current
      runSessionRefresh()
        .then(() => {
          if (refreshEpochRef.current === refreshEpoch) lastRefreshRef.current = Date.now()
        })
        .catch(() => {
          if (refreshEpochRef.current !== refreshEpoch) return
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
  }, [isAuthenticated, runSessionRefresh, stopSessionRefresh])

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
      handleLogoutStart,
      handleLogoutCancelled,
      handleLogoutSuccess,
    }),
    [
      authSession,
      isAuthenticated,
      isCheckingSession,
      authCheckError,
      loadAuthSession,
      handleLoginSuccess,
      handleLogoutStart,
      handleLogoutCancelled,
      handleLogoutSuccess,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
