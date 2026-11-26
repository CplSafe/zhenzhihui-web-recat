import {
  startOAuth,
  AuthApiError,
  clearAuthSessionMarker,
  clearExistingSession,
  getAuthenticatedSession,
  getCurrentUser,
  getSession,
  hasAuthSessionMarker,
  listWorkspaceMembers,
  logoutSession,
  markAuthSessionExpected,
  refreshSession,
  resetAuthenticatedSession,
  updateMyProfile,
  uploadMyAvatar,
} from '@/api/auth'
import { AUTH_REQUEST_BOUNDARY_KEY, getAuthRequestScope, observeAuthRequestBoundary } from '@/api/authRequestScope'
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
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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
  observeAuthRequestBoundary()
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

  it.each([
    ['success', 200, { data: { ok: true } }],
    ['HTTP unauthorized', 401, { message: 'not signed in' }],
    ['business unauthorized name', 200, { code_string: 'UNAUTHORIZED' }],
    ['business unauthorized code', 200, { code: 10101 }],
  ])('clears the marker when logout returns %s', async (_name, status, payload) => {
    markAuthSessionExpected()
    const fetchMock = vi.fn(async () => jsonResponse(payload, status))
    vi.stubGlobal('fetch', fetchMock)

    await expect(clearExistingSession()).resolves.toBeUndefined()
    expect(hasAuthSessionMarker()).toBe(false)
    expect(localStorage.getItem(AUTH_REQUEST_BOUNDARY_KEY)).toMatch(/^account-change:/)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('preserves the marker and lets the caller handle an unconfirmed logout', async () => {
    markAuthSessionExpected()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: 'logout failed' }, 500)),
    )

    await expect(clearExistingSession()).rejects.toMatchObject({ status: 500, message: 'logout failed' })
    expect(hasAuthSessionMarker()).toBe(true)
    expect(localStorage.getItem(AUTH_REQUEST_BOUNDARY_KEY)).toBeNull()
  })

  it('allows a new session probe after clearing the previous session', async () => {
    const oldSession = deferred<Response>()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (path === '/api/v1/auth/session') return jsonResponse({ data: { user: { id: 9 } } })
      if (path === '/api/v1/auth/logout' || path === '/api/v1/me') return emptyResponse()
      throw new Error(`Unexpected request: ${path}`)
    })
    fetchMock.mockImplementationOnce(() => oldSession.promise)
    vi.stubGlobal('fetch', fetchMock)
    markAuthSessionExpected()
    const oldProbe = getAuthenticatedSession()
    await clearExistingSession()

    markAuthSessionExpected()
    await expect(getAuthenticatedSession()).resolves.toMatchObject({ user: { id: 9 } })
    oldSession.resolve(jsonResponse({ data: { user: { id: 7 } } }))
    await expect(oldProbe).rejects.toMatchObject({ cause: 'aborted', code: 'AUTH_SESSION_CHANGED' })
  })

  it('waits for the shared refresh lock before issuing a logout request', async () => {
    const refreshFinished = deferred<void>()
    const request = vi.fn(async (_name: string, _options: LockOptions, callback: () => Promise<unknown>) => {
      await refreshFinished.promise
      return callback()
    })
    const fetchMock = vi.fn(async () => emptyResponse())
    vi.stubGlobal('navigator', { locks: { request } })
    vi.stubGlobal('fetch', fetchMock)

    const logout = logoutSession()
    expect(request).toHaveBeenCalledWith('zzh.auth.refresh', { signal: expect.any(AbortSignal) }, expect.any(Function))
    expect(fetchMock).not.toHaveBeenCalled()
    refreshFinished.resolve(undefined)
    await logout
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(localStorage.getItem(AUTH_REQUEST_BOUNDARY_KEY)).toMatch(/^logout:/)
  })

  it('does not log out the newer cookie if the requesting tab waited behind the shared auth lock', async () => {
    const queued = deferred<void>()
    const request = vi.fn(async (_name: string, _options: LockOptions, callback: () => Promise<unknown>) => {
      await queued.promise
      return callback()
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('navigator', { locks: { request } })
    vi.stubGlobal('fetch', fetchMock)

    const logout = logoutSession()
    const rejected = expect(logout).rejects.toMatchObject({ cause: 'aborted', code: 'AUTH_SESSION_CHANGED' })
    localStorage.setItem(AUTH_REQUEST_BOUNDARY_KEY, 'account-change:peer')
    markAuthSessionExpected()
    queued.resolve(undefined)

    await rejected
    expect(fetchMock).not.toHaveBeenCalled()
    expect(hasAuthSessionMarker()).toBe(true)
  })
})

describe('authenticated profile requests', () => {
  it('rejects an old profile write before sending it and discards the late avatar response', async () => {
    const avatarResponse = deferred<Response>()
    const fetchMock = vi.fn((_input: RequestInfo | URL) => avatarResponse.promise)
    vi.stubGlobal('fetch', fetchMock)
    const authScope = getAuthRequestScope()
    const avatar = uploadMyAvatar(new File(['image'], 'avatar.png'), { authScope })
    expect(fetchMock).toHaveBeenCalledOnce()
    const avatarRejected = expect(avatar).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED', cause: 'aborted' })

    window.localStorage.setItem(AUTH_REQUEST_BOUNDARY_KEY, 'account-change:peer')
    await expect(updateMyProfile({ nickname: '旧昵称' }, { authScope })).rejects.toMatchObject({
      code: 'AUTH_SESSION_CHANGED',
    })
    await expect(getCurrentUser()).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    avatarResponse.resolve(jsonResponse({ code: 0, data: { avatar_url: '/old.png' } }))
    await avatarRejected
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(requestPath(fetchMock.mock.calls[0][0])).toBe('/api/v1/me/avatar')
  })
})

describe('getAuthenticatedSession', () => {
  it('verifies a new switched session using provisional headers before publishing its switch ID', async () => {
    vi.resetModules()
    const switchedAuth = await import('@/api/auth')
    const { ACCOUNT_SWITCH_HEADER, getAccountSwitchId } = await import('@/api/accountSwitch')
    const switchSession = {
      impersonating: true as const,
      impersonation_id: 'a'.repeat(64),
      access_token_expires_at: '2099-11-24T12:00:00.000Z',
      user: { id: 7 },
      workspace: { id: 21 },
    }
    const provisionalPaths: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        const path = requestPath(input)
        if (path === '/api/v1/auth/session') return jsonResponse({ data: switchSession })
        expect(getAccountSwitchId()).toBe('')
        expect(new Headers(options?.headers).get(ACCOUNT_SWITCH_HEADER)).toBe(switchSession.impersonation_id)
        provisionalPaths.push(path)
        if (path === '/api/v1/me') return jsonResponse({ data: { user: { id: 7, nickname: '匹配身份' } } })
        if (path === '/api/v1/workspaces/21/members') return jsonResponse({ data: [{ user_id: 7 }] })
        throw new Error(`Unexpected request: ${path}`)
      }),
    )
    switchedAuth.markAuthSessionExpected()

    await expect(switchedAuth.getAuthenticatedSession()).resolves.toMatchObject({
      user: { id: 7, nickname: '匹配身份' },
    })
    expect(provisionalPaths).toEqual(['/api/v1/me', '/api/v1/workspaces/21/members'])
    expect(getAccountSwitchId()).toBe(switchSession.impersonation_id)
  })

  it('uses native switch metadata when enriching the switched account with a matching profile', async () => {
    vi.resetModules()
    const switchedAuth = await import('@/api/auth')
    const { acceptAccountSwitchSession } = await import('@/api/accountSwitch')
    const switchSession = {
      impersonating: true as const,
      impersonation_id: 'a'.repeat(64),
      access_token_expires_at: '2026-11-24T12:00:00.000Z',
    }
    acceptAccountSwitchSession(switchSession)
    const fetchMock = installSuccessfulSessionFetch({
      session: { ...switchSession, user: { id: 7 }, workspace: { id: 21 } },
      profile: { impersonating: false, access_token_expires_at: null, user: { id: '7', nickname: '测试用户' } },
    })

    await expect(switchedAuth.getAuthenticatedSession()).resolves.toMatchObject({
      ...switchSession,
      user: { id: '7', nickname: '测试用户' },
      currentMember: { user_id: 7, role: 'owner' },
    })
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' })
  })

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

  it('accepts a workspace-only session with a valid identity from the profile', async () => {
    markAuthSessionExpected()
    installSuccessfulSessionFetch({ session: { workspace: { id: 21 } } })

    await expect(getAuthenticatedSession()).resolves.toMatchObject({
      user: { id: 7, nickname: '测试用户' },
      currentMember: { user_id: 7, role: 'owner' },
    })
  })

  it('uses only the verified profile user when the session user has no valid identity', async () => {
    markAuthSessionExpected()
    installSuccessfulSessionFetch({
      session: { user: { id: 0, mobile: '13800000000' }, workspace: { id: 21 } },
      profile: { user: { user_id: 7 } },
    })

    const authContext = await getAuthenticatedSession()
    expect(authContext.user).toEqual({ user_id: 7 })
  })

  it('preserves trusted session fields when the verified profile is partial', async () => {
    markAuthSessionExpected()
    installSuccessfulSessionFetch({
      session: { user: { id: 7, mobile: '13800000000' }, workspace: { id: 21 } },
      profile: { user: { id: '7', nickname: '测试用户' } },
    })

    await expect(getAuthenticatedSession()).resolves.toMatchObject({
      user: { id: '7', nickname: '测试用户', mobile: '13800000000' },
    })
  })

  it('discards profile fields when the profile has no valid identity to compare', async () => {
    markAuthSessionExpected()
    installSuccessfulSessionFetch({ profile: { user: { id: null, nickname: '未验证资料' } } })

    await expect(getAuthenticatedSession()).resolves.toEqual({
      user: { id: 7 },
      workspace: { id: 21 },
      currentMember: { user_id: 7, role: 'owner' },
    })
  })

  it('rejects divergent session and profile identities before loading workspace members', async () => {
    markAuthSessionExpected()
    const fetchMock = installSuccessfulSessionFetch({ profile: { user: { user_id: 8 } } })

    await expect(getAuthenticatedSession()).rejects.toMatchObject({
      name: 'AuthApiError',
      code: 'SESSION_IDENTITY_MISMATCH',
    })
    expect(fetchMock.mock.calls.map(([input]) => requestPath(input))).toEqual(['/api/v1/auth/session', '/api/v1/me'])
  })

  it('rejects a successful empty session response before loading the profile', async () => {
    markAuthSessionExpected()
    const fetchMock = installSuccessfulSessionFetch({ session: {} })

    await expect(getAuthenticatedSession()).rejects.toMatchObject({
      name: 'AuthApiError',
      code: 'SESSION_IDENTITY_MISSING',
    })
    expect(fetchMock.mock.calls.map(([input]) => requestPath(input))).toEqual(['/api/v1/auth/session'])
  })

  it('rejects assembled sessions without a valid identity before loading members', async () => {
    markAuthSessionExpected()
    const fetchMock = installSuccessfulSessionFetch({
      session: { user: { id: 0 }, workspace: { id: 21 } },
      profile: { user: { id: {} } },
    })

    await expect(getAuthenticatedSession()).rejects.toMatchObject({
      name: 'AuthApiError',
      code: 'SESSION_IDENTITY_MISSING',
    })
    expect(fetchMock.mock.calls.map(([input]) => requestPath(input))).toEqual(['/api/v1/auth/session', '/api/v1/me'])
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
        return jsonResponse({ data: { user: { id: 2 } } })
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

    oldSession.resolve(
      jsonResponse({
        data: {
          user: { id: 1 },
          workspace: { id: 11 },
          impersonating: true,
          impersonation_id: 'a'.repeat(64),
          access_token_expires_at: '2099-11-24T12:00:00.000Z',
        },
      }),
    )
    await expect(oldRequest).rejects.toMatchObject({ cause: 'aborted', code: 'AUTH_SESSION_CHANGED' })
    expect(localStorage.getItem('zzh.auth.account-switch.v1')).toBeNull()
    expect(profileCalls).toBe(0)

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

it('loads members again for a different authentication scope in the same workspace', async () => {
  const oldMembers = deferred<Response>()
  const fetchMock = vi
    .fn()
    .mockReturnValueOnce(oldMembers.promise)
    .mockResolvedValueOnce(jsonResponse({ data: [{ user_id: 8, role: 'member' }] }))
  vi.stubGlobal('fetch', fetchMock)

  const before = listWorkspaceMembers(21)
  expect(listWorkspaceMembers(21)).toBe(before)
  const rejected = expect(before).rejects.toMatchObject({ cause: 'aborted', code: 'AUTH_SESSION_CHANGED' })
  resetAuthenticatedSession()
  const after = listWorkspaceMembers(21)
  oldMembers.resolve(jsonResponse({ data: [{ user_id: 8, role: 'admin' }] }))

  await rejected
  await expect(after).resolves.toEqual([{ user_id: 8, role: 'member' }])
  expect(fetchMock).toHaveBeenCalledTimes(2)
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

it('passes hierarchy context alone to the signed OAuth flow', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
    jsonResponse({ data: { authorize_url: 'https://auth.example.test' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  await startOAuth({ hierarchyInvite: 'TOKEN', inviteCode: 'OLD', inviteType: 'channel' })
  const request = new URL(String(fetchMock.mock.calls[0]![0]), window.location.origin)
  expect(request.searchParams.get('hierarchy_invite')).toBe('TOKEN')
  expect(request.searchParams.has('invite_code')).toBe(false)
  expect(request.searchParams.has('invite_type')).toBe(false)
})
