import { clearPageCache } from '@/utils/pageDataCache'
import { clearAllCache } from '@/utils/swrCache'
import { APP_HOME_PATH } from '@/utils/sidebarNavigation'
import { invalidateAuthRequestScope } from './authRequestScope'

const SWITCH_HINT_KEY = 'zzh.auth.account-switch.v1'
export const ACCOUNT_SWITCH_HEADER = 'X-ZZH-Account-Switch'
export const USER_VIEW_EXCHANGE_PATH = '/api/v1/auth/impersonation/exchange'
export const USER_VIEW_END_PATH = '/api/v1/auth/impersonation/end'

// The ID binds requests to the identity displayed by this document. Only the
// HttpOnly cookie authenticates it, and an old document keeps its old ID.
let currentId = ''
let onExpiry: (() => void) | undefined

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
    return ''
  }
}

function saveSwitchHint(id: string): boolean {
  try {
    if (id) localStorage.setItem(SWITCH_HINT_KEY, id)
    else localStorage.removeItem(SWITCH_HINT_KEY)
    return true
  } catch {
    return false
  }
}

export function clearAccountSwitchCaches(): void {
  clearPageCache()
  clearAllCache()
}

export function acceptAccountSwitchSession(session: AccountSwitchSession): boolean {
  if (currentId === session.impersonation_id) return true
  invalidateAuthRequestScope()
  clearAccountSwitchCaches()
  currentId = session.impersonation_id
  return saveSwitchHint(currentId)
}

export function subscribeToAccountSwitchExpiry(listener: () => void): () => void {
  onExpiry = listener
  return () => {
    if (onExpiry === listener) onExpiry = undefined
  }
}

/** Install before mounting routes. Keep the matching ID on every business fetch in this document. */
export function installAccountSwitchTransport(isHandoffPath: (path: string) => boolean): void {
  currentId = readSwitchHint()
  const fetchNormally = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const id = currentId
    if (!id) return fetchNormally(input, init)
    const request = input instanceof Request ? input : null
    const url = new URL(request?.url ?? String(input), window.location.href)
    const credentials = init?.credentials ?? request?.credentials
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith('/api/v1/') ||
      url.pathname === USER_VIEW_EXCHANGE_PATH ||
      url.pathname === USER_VIEW_END_PATH ||
      credentials === 'omit'
    ) {
      return fetchNormally(input, init)
    }

    const headers = new Headers(init?.headers ?? request?.headers)
    headers.set(ACCOUNT_SWITCH_HEADER, id)
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
          if (body?.code_string === 'IMPERSONATION_EXPIRED' && currentId === id) onExpiry?.()
        })
        .catch(() => undefined)
    }
    return response
  }

  const reconcile = () => {
    const next = readSwitchHint()
    if (next === currentId || isHandoffPath(window.location.pathname)) return
    invalidateAuthRequestScope()
    clearAccountSwitchCaches()
    // Keep the old tab's ID attached until document navigation completes.
    window.location.replace(next ? APP_HOME_PATH : '/')
  }
  window.addEventListener('storage', (event) => {
    if (event.key === SWITCH_HINT_KEY) reconcile()
  })
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) reconcile()
  })
}

/** Called after server revocation so stale requests keep their old ID until navigation. */
export function restoreOrdinaryAccount(id: string): void {
  invalidateAuthRequestScope()
  if (readSwitchHint() === id) saveSwitchHint('')
  clearAccountSwitchCaches()
  window.location.replace('/')
}
