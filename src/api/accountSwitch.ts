import { clearPageCache } from '@/utils/pageDataCache'
import { clearAllCache } from '@/utils/swrCache'
import { APP_HOME_PATH } from '@/utils/sidebarNavigation'
import { withRequestTimeout } from './requestTimeout'

const SWITCH_HINT_KEY = 'zzh.auth.account-switch.v1'
const SWITCH_HEADER = 'X-ZZH-Account-Switch'
const EXCHANGE_PATH = '/api/v1/auth/impersonation/exchange'
const END_PATH = '/api/v1/auth/impersonation/end'
const EXPIRED_EVENT = 'zzh:account-switch-expired'

// The ID binds requests to the identity displayed by this document. Only the
// HttpOnly cookie authenticates it, and an old document keeps its old ID.
let currentId = ''

export interface AccountSwitchSession {
  impersonating: true
  impersonation_id: string
  access_token_expires_at: string
}

export function isAccountSwitchSession(value: unknown): value is AccountSwitchSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<AccountSwitchSession>
  return (
    session.impersonating === true &&
    typeof session.impersonation_id === 'string' &&
    /^[a-f0-9]{64}$/.test(session.impersonation_id) &&
    typeof session.access_token_expires_at === 'string' &&
    Number.isFinite(Date.parse(session.access_token_expires_at))
  )
}

export function getAccountSwitchId(): string {
  return currentId
}

function readSwitchHint(): string {
  try {
    return localStorage.getItem(SWITCH_HINT_KEY) || ''
  } catch {
    try {
      return sessionStorage.getItem(SWITCH_HINT_KEY) || ''
    } catch {
      return ''
    }
  }
}

function saveSwitchHint(id: string): void {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[name]
      if (id) storage.setItem(SWITCH_HINT_KEY, id)
      else storage.removeItem(SWITCH_HINT_KEY)
    } catch {
      // The current document retains its ID even when storage is unavailable.
    }
  }
}

export function clearAccountSwitchCaches(): void {
  clearPageCache()
  clearAllCache()
}

export function acceptAccountSwitchSession(session: AccountSwitchSession): void {
  if (currentId !== session.impersonation_id) clearAccountSwitchCaches()
  currentId = session.impersonation_id
  saveSwitchHint(currentId)
}

export function subscribeToAccountSwitchExpiry(listener: () => void): () => void {
  window.addEventListener(EXPIRED_EVENT, listener)
  return () => window.removeEventListener(EXPIRED_EVENT, listener)
}

/** Install before mounting routes. Keep the matching ID on every business fetch in this document. */
export function installAccountSwitchTransport(isHandoffPath: (path: string) => boolean): () => void {
  currentId = readSwitchHint()
  const originalFetch = window.fetch
  const fetchNormally = originalFetch.bind(window)
  const fetchInAccountSwitch: typeof fetch = async (input, init) => {
    const id = currentId
    if (!id) return fetchNormally(input, init)
    const request = input instanceof Request ? input : null
    const url = new URL(request?.url ?? String(input), window.location.href)
    const credentials = init?.credentials ?? request?.credentials
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith('/api/v1/') ||
      url.pathname === EXCHANGE_PATH ||
      url.pathname === END_PATH ||
      credentials === 'omit'
    ) {
      return fetchNormally(input, init)
    }

    const headers = new Headers(init?.headers ?? request?.headers)
    headers.set(SWITCH_HEADER, id)
    const response = await fetchNormally(input, {
      ...init,
      headers,
      credentials: 'include',
      referrerPolicy: 'same-origin',
    })
    if (response.status === 401) {
      void response
        .clone()
        .json()
        .then((body) => {
          if (body?.code_string === 'IMPERSONATION_EXPIRED' && currentId === id) {
            window.dispatchEvent(new Event(EXPIRED_EVENT))
          }
        })
        .catch(() => undefined)
    }
    return response
  }

  const reconcile = () => {
    const next = readSwitchHint()
    if (next === currentId || isHandoffPath(window.location.pathname)) return
    clearAccountSwitchCaches()
    // Keep the old tab's ID attached until document navigation completes.
    window.location.replace(next ? APP_HOME_PATH : '/')
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === SWITCH_HINT_KEY) reconcile()
  }
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) reconcile()
  }
  window.fetch = fetchInAccountSwitch
  window.addEventListener('storage', onStorage)
  window.addEventListener('pageshow', onPageShow)
  return () => {
    if (window.fetch === fetchInAccountSwitch) window.fetch = originalFetch
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('pageshow', onPageShow)
  }
}

/** Revoke the switched identity before reloading the ordinary session in a fresh document. */
export async function leaveAccountSwitch(): Promise<void> {
  const id = currentId
  if (!id) throw new Error('无法确认切换会话，请刷新页面后重试。')
  await withRequestTimeout(async (signal) => {
    const response = await fetch(END_PATH, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'same-origin',
      headers: { [SWITCH_HEADER]: id },
      signal,
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || result?.code !== 0) throw new Error(result?.message || '暂时无法退出切换，请重试。')
  })
  if (readSwitchHint() === id) saveSwitchHint('')
  clearAccountSwitchCaches()
  window.location.replace('/')
}
