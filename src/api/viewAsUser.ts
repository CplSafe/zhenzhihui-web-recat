import { withRequestTimeout } from './requestTimeout'

export const VIEW_AS_USER_PATH = '/view-as-user'
const STORAGE_KEY = 'zzh.view-as-user.v1'

interface ViewAsUserGrant {
  access_token: string
  access_token_expires_at: string
}

export interface ViewedWorkspace {
  id: number
  name: string
  type: 'personal' | 'team' | 'enterprise'
}

interface ViewAsUserIdentity {
  user: { id: number; nickname?: string; mobile?: string; email?: string }
  workspaces: ViewedWorkspace[] | null
}

export interface ViewAsUserSession extends ViewAsUserIdentity {
  expiresAt: number
}

type ViewAsUserLaunch = { session: ViewAsUserSession } | { error: string }
interface ApiEnvelope<T> {
  code: number
  message?: string
  data?: T
}

export class ViewAsUserError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function isViewAsUserPath(path: string): boolean {
  return path === VIEW_AS_USER_PATH || path === `${VIEW_AS_USER_PATH}/`
}

let grant: ViewAsUserGrant | null = null

/** Read and remove the launch code before the router and telemetry see the URL. */
export function takeViewAsUserLaunchCode(): string | null {
  if (!isViewAsUserPath(window.location.pathname) || !window.location.hash) return null
  const code = new URLSearchParams(window.location.hash.slice(1)).get('code') ?? ''
  window.history.replaceState(window.history.state, '', VIEW_AS_USER_PATH)
  clearGrant()
  return code
}

function readGrant(): ViewAsUserGrant | null {
  if (grant) return grant
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null')
    if (typeof saved?.access_token === 'string' && typeof saved?.access_token_expires_at === 'string') {
      grant = saved
    }
  } catch {
    // The active view can still use an in-memory grant when storage is unavailable.
  }
  return grant
}

function clearGrant() {
  grant = null
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // The in-memory grant is already cleared.
  }
}

function saveGrant(newGrant: ViewAsUserGrant) {
  grant = newGrant
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(newGrant))
  } catch {
    // The current tab can use the grant until reload.
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = new URL(path, window.location.origin)
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/v1/')) {
    throw new ViewAsUserError('查看请求地址无效', 400)
  }

  return withRequestTimeout(
    async (signal) => {
      const response = await fetch(`${url.pathname}${url.search}`, {
        ...options,
        signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      })
      const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null
      if (!response.ok || payload?.code !== 0 || payload.data === undefined) {
        throw new ViewAsUserError(payload?.message || '暂时无法读取，请稍后重试', response.status)
      }
      return payload.data
    },
    { signal: options.signal },
  )
}

export async function readAsUser<T>(path: string, options: { signal?: AbortSignal } = {}): Promise<T> {
  const current = readGrant()
  if (!current?.access_token || !(Date.parse(current.access_token_expires_at) > Date.now())) {
    clearGrant()
    throw new ViewAsUserError('查看会话已失效', 401)
  }
  try {
    return await request<T>(path, {
      signal: options.signal,
      headers: { Authorization: `Bearer ${current.access_token}` },
    })
  } catch (error) {
    if (error instanceof ViewAsUserError && error.status === 401 && readGrant() === current) clearGrant()
    throw error
  }
}

export async function loadViewAsUser(code: string | null, signal: AbortSignal): Promise<ViewAsUserLaunch> {
  try {
    let identity: ViewAsUserIdentity
    if (code === null) {
      identity = await readAsUser<ViewAsUserIdentity>('/api/v1/auth/session', { signal })
    } else {
      if (!code) throw new ViewAsUserError('查看链接缺少凭证', 400)
      const response = await request<ViewAsUserGrant & ViewAsUserIdentity>('/api/v1/auth/impersonation/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        signal,
      })
      if (signal.aborted) throw signal.reason
      if (typeof response?.access_token !== 'string' || !response.access_token || !response.access_token_expires_at) {
        throw new ViewAsUserError('无法确认查看身份', 401)
      }
      saveGrant({ access_token: response.access_token, access_token_expires_at: response.access_token_expires_at })
      identity = response
    }
    if (signal.aborted) throw signal.reason
    if (!identity?.user?.id) throw new ViewAsUserError('无法确认查看身份', 401)
    const expiresAt = Date.parse(readGrant()?.access_token_expires_at ?? '')
    if (!(expiresAt > Date.now())) throw new ViewAsUserError('查看会话已失效', 401)
    return { session: { user: identity.user, workspaces: identity.workspaces, expiresAt } }
  } catch (error) {
    if (!signal.aborted) clearGrant()
    return {
      error:
        error instanceof ViewAsUserError && error.status >= 400 && error.status < 500
          ? '查看链接无效或已失效。请返回后台重新发起查看。'
          : '暂时无法开启查看。请返回后台重新发起查看。',
    }
  }
}

/** Remove this tab's grant before asking the server to revoke the same session. */
export function endViewAsUser(): void {
  const token = readGrant()?.access_token
  clearGrant()
  if (!token) return
  void request<unknown>('/api/v1/auth/impersonation/end', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    keepalive: true,
  }).catch(() => undefined)
}
