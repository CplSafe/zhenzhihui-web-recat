export const AUTH_REQUEST_BOUNDARY_KEY = 'zzh.auth.request-boundary.v1'
export type AuthRequestBoundaryKind = 'logout' | 'account-change'

let generation = 0
let observedBoundary: string | undefined

export function readAuthRequestBoundary(): string {
  try {
    return typeof window === 'undefined' ? '' : window.localStorage.getItem(AUTH_REQUEST_BOUNDARY_KEY) || ''
  } catch {
    return ''
  }
}

/** Capture the identity boundary before a request or an asynchronous action starts. */
export function getAuthRequestScope(): number {
  observedBoundary ??= readAuthRequestBoundary()
  return generation
}

/** Invalidate pending work when login or logout changes the browser's authentication context. */
export function invalidateAuthRequestScope(): void {
  generation += 1
}

export function isAuthRequestScopeCurrent(scope: number): boolean {
  // A peer may have changed the shared cookie before its storage event reaches this tab.
  const currentBoundary = readAuthRequestBoundary()
  observedBoundary ??= currentBoundary
  return scope === generation && observedBoundary === currentBoundary
}

/** Record a confirmed cookie change before any peer can replay old work under the next identity. */
export function publishAuthRequestBoundary(kind: AuthRequestBoundaryKind): void {
  invalidateAuthRequestScope()
  try {
    const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const next = `${kind}:${nonce}`
    window.localStorage.setItem(AUTH_REQUEST_BOUNDARY_KEY, next)
    observedBoundary = next
  } catch {
    // A browser that blocks storage can still invalidate requests in this document.
  }
}

/** Adopt a peer boundary when the current tab is ready to discard the previous identity. */
export function observeAuthRequestBoundary(): void {
  const currentBoundary = readAuthRequestBoundary()
  if (observedBoundary !== undefined && observedBoundary !== currentBoundary) invalidateAuthRequestScope()
  observedBoundary = currentBoundary
}

export function getUnobservedAuthRequestBoundaryKind(): AuthRequestBoundaryKind | null {
  const currentBoundary = readAuthRequestBoundary()
  if (observedBoundary === undefined || observedBoundary === currentBoundary) return null
  return currentBoundary.startsWith('logout:') ? 'logout' : 'account-change'
}
