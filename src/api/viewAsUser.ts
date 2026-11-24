import { withRequestTimeout } from './requestTimeout'
import {
  acceptAccountSwitchSession,
  ACCOUNT_SWITCH_HEADER,
  isAccountSwitchSession,
  restoreOrdinaryAccount,
  USER_VIEW_END_PATH,
  USER_VIEW_EXCHANGE_PATH,
  type AccountSwitchSession,
} from './accountSwitch'

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

type ViewAsUserLaunch = { session: ViewAsUserSession } | { mode: 'account' } | { error: string }
interface ViewAsUserLaunchRequest {
  code: string
  mode: 'account' | 'readonly'
}
interface ApiEnvelope<T> {
  code: number
  code_string?: string
  message?: string
  data?: T
}

export class ViewAsUserError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
  }
}

export function isViewAsUserPath(path: string): boolean {
  return path === VIEW_AS_USER_PATH || path === `${VIEW_AS_USER_PATH}/`
}

let grant: ViewAsUserGrant | null = null

/** Read and remove the launch code before the router and telemetry see the URL. */
export function takeViewAsUserLaunchRequest(): ViewAsUserLaunchRequest | null {
  if (!isViewAsUserPath(window.location.pathname) || !window.location.hash) return null
  const params = new URLSearchParams(window.location.hash.slice(1))
  window.history.replaceState(window.history.state, '', VIEW_AS_USER_PATH)
  clearGrant()
  return { code: params.get('code') ?? '', mode: params.get('mode') === 'account' ? 'account' : 'readonly' }
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

async function request<T>(path: string, options: RequestInit = {}, accountMode = false): Promise<T> {
  const url = new URL(path, window.location.origin)
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/v1/')) {
    throw new ViewAsUserError('查看请求地址无效', 400)
  }

  return withRequestTimeout(
    async (signal) => {
      const response = await fetch(`${url.pathname}${url.search}`, {
        ...options,
        signal,
        credentials: accountMode ? 'include' : 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: accountMode ? 'same-origin' : 'no-referrer',
      })
      const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null
      if (!response.ok || payload?.code !== 0 || payload.data === undefined) {
        throw new ViewAsUserError(payload?.message || '暂时无法读取，请稍后重试', response.status, payload?.code_string)
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

export async function loadViewAsUser(
  launch: ViewAsUserLaunchRequest | null,
  signal: AbortSignal,
): Promise<ViewAsUserLaunch> {
  try {
    const code = launch?.code ?? null
    const accountMode = launch?.mode === 'account'
    let identity: ViewAsUserIdentity
    if (code === null) {
      identity = await readAsUser<ViewAsUserIdentity>('/api/v1/auth/session', { signal })
    } else {
      if (!code) throw new ViewAsUserError('查看链接缺少凭证', 400)
      const response = await request<
        (ViewAsUserGrant & ViewAsUserIdentity) | (AccountSwitchSession & ViewAsUserIdentity & { mode: 'account' })
      >(
        USER_VIEW_EXCHANGE_PATH,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
          signal,
        },
        accountMode,
      )
      if (signal.aborted) throw signal.reason
      if (
        accountMode &&
        response &&
        'mode' in response &&
        response.mode === 'account' &&
        isAccountSwitchSession(response)
      ) {
        if (!acceptAccountSwitchSession(response)) {
          await revokeAccountSwitch(response.impersonation_id)
          return { error: '无法保存切换会话。请允许网站存储后，从后台重新切换。' }
        }
        return { mode: 'account' }
      }
      if (
        accountMode ||
        !response ||
        !('access_token' in response) ||
        typeof response.access_token !== 'string' ||
        !response.access_token ||
        !response.access_token_expires_at
      ) {
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
  void request<unknown>(USER_VIEW_END_PATH, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    keepalive: true,
  }).catch(() => undefined)
}

/** Revoke the switched identity before reloading the ordinary account. */
export async function leaveAccountSwitch(id: string): Promise<void> {
  await revokeAccountSwitch(id)
  restoreOrdinaryAccount(id)
}

function revokeAccountSwitch(id: string) {
  return request(USER_VIEW_END_PATH, { method: 'POST', headers: { [ACCOUNT_SWITCH_HEADER]: id } }, true)
}
