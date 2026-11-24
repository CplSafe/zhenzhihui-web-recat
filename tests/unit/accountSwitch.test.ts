import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAuthenticatedSession, resetAuthenticatedSession } from '@/api/auth'
import { installAccountSwitchTransport, subscribeToAccountSwitchExpiry } from '@/api/accountSwitch'
import { runSharedSessionRefresh } from '@/api/sessionRefresh'

const switchKey = 'zzh.auth.account-switch.v1'
const switchId = 'a'.repeat(64)
const account = {
  impersonating: true,
  impersonation_id: switchId,
  access_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
  user: { id: 4 },
  workspaces: [{ id: 12, type: 'personal' }],
}
const reply = (data: unknown) => Response.json({ code: 0, data })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem(switchKey, switchId)
  resetAuthenticatedSession()
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

it('loads the target through the normal session and business APIs without a normal login or a refresh', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin)
    if (url.pathname === '/api/v1/auth/session') return reply(account)
    if (url.pathname === '/api/v1/me') return reply({ user: { id: 4, nickname: '目标用户' } })
    if (url.pathname === '/api/v1/workspaces/12/members') return reply([{ user_id: 4, role: 'owner' }])
    return reply(null)
  })
  vi.stubGlobal('fetch', fetchMock)
  installAccountSwitchTransport(() => false)

  await expect(getAuthenticatedSession()).resolves.toMatchObject({
    ...account,
    user: { id: 4, nickname: '目标用户' },
    currentMember: { user_id: 4, role: 'owner' },
  })
  await fetch('/api/v1/creative/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
  // Another tab can change its hint. This old document continues to use its own bound ID.
  localStorage.setItem(switchKey, 'b'.repeat(64))
  await fetch(new Request(`${location.origin}/api/v1/canvases/41/elements`, { method: 'PATCH' }))
  await fetch('https://storage.example/api/v1/objects/1', { method: 'PUT' })
  await fetch('/api/v1/auth/session', { credentials: 'omit', headers: { Authorization: 'Bearer readonly-grant' } })
  await expect(runSharedSessionRefresh()).resolves.toMatchObject({ ok: false, status: 401 })

  expect(fetchMock).toHaveBeenCalledTimes(7)
  for (const [, init] of fetchMock.mock.calls.slice(0, 5)) {
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).get('X-ZZH-Account-Switch')).toBe(switchId)
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
  }
  expect(new Headers(fetchMock.mock.calls[3][1]?.headers).get('Content-Type')).toBe('application/json')
  expect(new Headers(fetchMock.mock.calls[5][1]?.headers).has('X-ZZH-Account-Switch')).toBe(false)
  expect(fetchMock.mock.calls[6][1]?.credentials).toBe('omit')
  expect(new Headers(fetchMock.mock.calls[6][1]?.headers).get('Authorization')).toBe('Bearer readonly-grant')
  expect(localStorage.getItem('zzh_has_auth_session')).toBeNull()
})

it('handles revocation without switching a document to the underlying account', async () => {
  const revoked = Response.json({ code: 10101, code_string: 'IMPERSONATION_EXPIRED' }, { status: 401 })
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(reply({ user: { id: 999 } }))
    .mockResolvedValueOnce(revoked)
  vi.stubGlobal('fetch', fetchMock)
  installAccountSwitchTransport(() => false)
  await expect(getAuthenticatedSession()).rejects.toMatchObject({ status: 401, code: 'IMPERSONATION_EXPIRED' })
  expect(fetchMock).toHaveBeenCalledTimes(1)

  const onExpiry = vi.fn()
  const unsubscribe = subscribeToAccountSwitchExpiry(onExpiry)
  try {
    const response = await fetch('/api/v1/creative/projects')
    await expect(response.json()).resolves.toMatchObject({ code_string: 'IMPERSONATION_EXPIRED' })
    await vi.waitFor(() => expect(onExpiry).toHaveBeenCalledOnce())
  } finally {
    unsubscribe()
  }
})
