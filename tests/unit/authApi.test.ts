import {
  AuthApiError,
  clearAuthSessionMarker,
  clearExistingSession,
  getAuthenticatedSession,
  getSession,
  hasAuthSessionMarker,
  logoutSession,
  markAuthSessionExpected,
  refreshSession,
  resetAuthenticatedSession,
} from '@/api/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(payload: string, status = 200) {
  return new Response(payload, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  })
}

function emptyResponse(status = 200) {
  return new Response(null, { status })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function requestPath(input: RequestInfo | URL) {
  return new URL(String(input), window.location.origin).pathname
}

function installSuccessfulSessionFetch({
  session = { user: { id: 7 }, workspace: { id: 21 } },
  profile = { user: { id: 7, nickname: '测试用户' } },
  members = [{ user_id: 7, role: 'owner' }],
}: {
  session?: Record<string, unknown>
  profile?: Record<string, unknown>
  members?: unknown[]
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = requestPath(input)
    if (path === '/api/v1/auth/session') return jsonResponse({ data: session })
    if (path === '/api/v1/me') return jsonResponse({ data: profile })
    if (path === '/api/v1/workspaces/21/members') return jsonResponse({ data: members })
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  resetAuthenticatedSession()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  resetAuthenticatedSession()
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('auth session marker', () => {
  it.each(['0', 'true', ' 1 ', '', '2'])('treats the boundary value %j as no marker', (value) => {
    window.localStorage.setItem('zzh_has_auth_session', value)
    expect(hasAuthSessionMarker()).toBe(false)
  })

  it('marks and clears an expected session using only the canonical value', () => {
    expect(hasAuthSessionMarker()).toBe(false)

    markAuthSessionExpected()
    expect(window.localStorage.getItem('zzh_has_auth_session')).toBe('1')
    expect(hasAuthSessionMarker()).toBe(true)

    clearAuthSessionMarker()
    expect(hasAuthSessionMarker()).toBe(false)
  })

  it('rejects without making a request when neither marker nor SSO callback is present', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAuthenticatedSession()).rejects.toMatchObject({
      name: 'AuthApiError',
      status: 401,
      code: 'UNAUTHORIZED',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows an SSO callback to validate a session without a historical marker', async () => {
    window.sessionStorage.setItem('zzh_sso_pending', '1')
    const fetchMock = installSuccessfulSessionFetch()

    await expect(getAuthenticatedSession()).resolves.toMatchObject({
      user: { id: 7, nickname: '测试用户' },
      workspace: { id: 21 },
      currentMember: { user_id: 7, role: 'owner' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('raw session lifecycle requests', () => {
  it.each([
    ['refreshSession', refreshSession, '/api/v1/auth/refresh'],
    ['logoutSession', logoutSession, '/api/v1/auth/logout'],
  ] as const)('sends %s as an authenticated POST', async (_name, request, expectedPath) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ data: { ok: true } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(request()).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(requestPath(fetchMock.mock.calls[0]![0])).toBe(expectedPath)
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    })
  })

  it.each([200, 401, 500])('always clears the marker when logout returns HTTP %i', async (status) => {
    markAuthSessionExpected()
    const fetchMock = vi.fn(async () =>
      status === 200
        ? jsonResponse({ data: { ok: true } }, status)
        : jsonResponse({ message: 'logout failed' }, status),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(clearExistingSession()).resolves.toBeUndefined()
    expect(hasAuthSessionMarker()).toBe(false)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('getAuthenticatedSession', () => {
  it('loads session, profile and the matching current workspace member', async () => {
    markAuthSessionExpected()
    const fetchMock = installSuccessfulSessionFetch()

    await expect(getAuthenticatedSession()).resolves.toEqual({
      user: { id: 7, nickname: '测试用户' },
      workspace: { id: 21 },
      currentMember: { user_id: 7, role: 'owner' },
    })
    expect(fetchMock.mock.calls.map(([input]) => requestPath(input))).toEqual([
      '/api/v1/auth/session',
      '/api/v1/me',
      '/api/v1/workspaces/21/members',
    ])
  })

  it('refreshes exactly once after a session 401 and continues with the refreshed session', async () => {
    markAuthSessionExpected()
    const paths: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input)
      paths.push(path)
      if (path === '/api/v1/auth/session') {
        return jsonResponse({ code_string: 'UNAUTHORIZED', message: 'expired' }, 401)
      }
      if (path === '/api/v1/auth/refresh') {
        expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
        return jsonResponse({ data: { user: { id: 8 }, workspace: { id: 21 } } })
      }
      if (path === '/api/v1/me') return jsonResponse({ data: { user: { id: 8, nickname: '刷新用户' } } })
      if (path === '/api/v1/workspaces/21/members') {
        return jsonResponse({ data: [{ user_id: 8, role: 'member' }] })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAuthenticatedSession()).resolves.toMatchObject({
      user: { id: 8, nickname: '刷新用户' },
      currentMember: { user_id: 8, role: 'member' },
    })
    expect(paths).toEqual([
      '/api/v1/auth/session',
      '/api/v1/auth/refresh',
      '/api/v1/me',
      '/api/v1/workspaces/21/members',
    ])
  })

  it('stops the chain when refresh also fails', async () => {
    markAuthSessionExpected()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (path === '/api/v1/auth/session' || path === '/api/v1/auth/refresh') {
        return jsonResponse({ code_string: 'UNAUTHORIZED', message: 'expired' }, 401)
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAuthenticatedSession()).rejects.toMatchObject({
      name: 'AuthApiError',
      status: 401,
      code: 'UNAUTHORIZED',
    })
    expect(fetchMock.mock.calls.map(([input]) => requestPath(input))).toEqual([
      '/api/v1/auth/session',
      '/api/v1/auth/refresh',
    ])
  })

  it('treats a profile 401 as fatal and does not request workspace members', async () => {
    markAuthSessionExpected()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (path === '/api/v1/auth/session') {
        return jsonResponse({ data: { user: { id: 7 }, workspace: { id: 21 } } })
      }
      if (path === '/api/v1/me') {
        return jsonResponse({ code_string: 'UNAUTHORIZED', message: 'profile expired' }, 401)
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAuthenticatedSession()).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
    expect(fetchMock.mock.calls.map(([input]) => requestPath(input))).toEqual(['/api/v1/auth/session', '/api/v1/me'])
  })

  it('keeps the valid session when profile loading fails with a non-401 error', async () => {
    markAuthSessionExpected()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (path === '/api/v1/auth/session') {
        return jsonResponse({ data: { user: { id: 7 }, workspace: { id: 21 } } })
      }
      if (path === '/api/v1/me') return jsonResponse({ message: 'temporarily unavailable' }, 503)
      if (path === '/api/v1/workspaces/21/members') {
        return jsonResponse({ data: [{ user_id: 7, role: 'owner' }] })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await getAuthenticatedSession()

    expect(result).toMatchObject({
      user: { id: 7 },
      workspace: { id: 21 },
      currentMember: { user_id: 7, role: 'owner' },
    })
    expect(result.profileLoadError).toBeInstanceOf(AuthApiError)
    expect(result.profileLoadError).toMatchObject({ status: 503 })
  })

  it.each([
    ['an empty body', () => emptyResponse()],
    ['data:null', () => jsonResponse({ data: null })],
    ['a primitive payload', () => jsonResponse('unexpected')],
    ['an array payload', () => jsonResponse([])],
  ])('fails closed when the session endpoint returns %s', async (_label, responseFactory) => {
    markAuthSessionExpected()
    const fetchMock = vi.fn(async () => responseFactory())
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAuthenticatedSession()).rejects.toMatchObject({
      name: 'AuthApiError',
      status: 401,
      code: 'UNAUTHORIZED',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('deduplicates concurrent authentication chains and starts a new one after settlement', async () => {
    markAuthSessionExpected()
    const firstSession = deferred<Response>()
    let sessionCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (path === '/api/v1/auth/session') {
        sessionCalls += 1
        if (sessionCalls === 1) return firstSession.promise
        return jsonResponse({ data: { user: { id: 7 }, workspace: { id: 21 } } })
      }
      if (path === '/api/v1/me') return jsonResponse({ data: { user: { id: 7 } } })
      if (path === '/api/v1/workspaces/21/members') return jsonResponse({ data: [{ user_id: 7 }] })
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = getAuthenticatedSession()
    const concurrent = getAuthenticatedSession()

    expect(concurrent).toBe(first)
    expect(sessionCalls).toBe(1)

    firstSession.resolve(jsonResponse({ data: { user: { id: 7 }, workspace: { id: 21 } } }))
    await expect(first).resolves.toMatchObject({ user: { id: 7 } })

    await expect(getAuthenticatedSession()).resolves.toMatchObject({ user: { id: 7 } })
    expect(sessionCalls).toBe(2)
  })

  it('prevents an old request settled after reset from clearing the newer single-flight request', async () => {
    markAuthSessionExpected()
    const oldSession = deferred<Response>()
    const newSession = deferred<Response>()
    let sessionCalls = 0
    let profileCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (path === '/api/v1/auth/session') {
        sessionCalls += 1
        return sessionCalls === 1 ? oldSession.promise : newSession.promise
      }
      if (path === '/api/v1/me') {
        profileCalls += 1
        return jsonResponse({ data: { user: { id: profileCalls } } })
      }
      if (path === '/api/v1/workspaces/11/members') return jsonResponse({ data: [{ user_id: 1 }] })
      if (path === '/api/v1/workspaces/22/members') return jsonResponse({ data: [{ user_id: 2 }] })
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const oldRequest = getAuthenticatedSession()
    resetAuthenticatedSession()
    const newRequest = getAuthenticatedSession()

    expect(newRequest).not.toBe(oldRequest)
    expect(sessionCalls).toBe(2)

    oldSession.resolve(jsonResponse({ data: { user: { id: 1 }, workspace: { id: 11 } } }))
    await expect(oldRequest).resolves.toMatchObject({ user: { id: 1 } })

    const coalescedWithNew = getAuthenticatedSession()
    expect(coalescedWithNew).toBe(newRequest)
    expect(sessionCalls).toBe(2)

    newSession.resolve(jsonResponse({ data: { user: { id: 2 }, workspace: { id: 22 } } }))
    await expect(newRequest).resolves.toMatchObject({
      user: { id: 2 },
      currentMember: { user_id: 2 },
    })
    await expect(coalescedWithNew).resolves.toMatchObject({ user: { id: 2 } })
  })
})

describe('session response parsing', () => {
  it('returns null for a successful empty response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => emptyResponse()),
    )
    await expect(getSession()).resolves.toBeNull()
  })

  it('rejects invalid JSON with the response status and raw payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => textResponse('{not-json', 200)),
    )

    await expect(getSession()).rejects.toMatchObject({
      name: 'AuthApiError',
      message: '接口返回格式异常',
      status: 200,
      response: '{not-json',
    })
  })
})
