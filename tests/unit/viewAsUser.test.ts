import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { endViewAsUser, loadViewAsUser, readAsUser, takeViewAsUserLaunchCode } from '@/api/viewAsUser'

const identity = { user: { id: 4, nickname: '目标用户' }, workspaces: [{ id: 12, name: '团队', type: 'team' }] }
const exchangeData = () => ({
  ...identity,
  access_token: 'view-only-token',
  access_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
})
const succeed = (data: unknown) => Response.json({ code: 0, data })
const signal = () => new AbortController().signal

beforeEach(() => {
  window.history.replaceState(null, '', '/view-as-user#code=one-time-code')
  localStorage.setItem('zzh_has_auth_session', '1')
  takeViewAsUserLaunchCode()
})

afterEach(() => {
  window.history.replaceState(null, '', '/view-as-user#code=cleanup')
  takeViewAsUserLaunchCode()
  localStorage.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

it('scrubs launch credentials and isolates exchange, reload, reads, and exit from the ordinary session', async () => {
  window.history.replaceState(null, '', '/view-as-user#code=one%2Btime')
  const code = takeViewAsUserLaunchCode()
  expect(code).toBe('one+time')
  expect(window.location.hash).toBe('')

  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(succeed(exchangeData()))
    .mockResolvedValueOnce(succeed(identity))
    .mockResolvedValueOnce(succeed({ used_credits: 30 }))
    .mockResolvedValueOnce(succeed(null))
  vi.stubGlobal('fetch', fetchMock)

  await expect(loadViewAsUser(code, signal())).resolves.toMatchObject({ session: identity })
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    '/api/v1/auth/impersonation/exchange',
    expect.objectContaining({
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'one+time' }),
    }),
  )

  await expect(loadViewAsUser(null, signal())).resolves.toMatchObject({ session: identity })
  await expect(readAsUser('/api/v1/me/usage-summary')).resolves.toEqual({ used_credits: 30 })
  for (const [index, path] of ['/api/v1/auth/session', '/api/v1/me/usage-summary'].entries()) {
    expect(fetchMock).toHaveBeenNthCalledWith(
      index + 2,
      path,
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        headers: { Authorization: 'Bearer view-only-token' },
      }),
    )
  }
  expect(localStorage.length).toBe(1)
  expect(sessionStorage.length).toBe(1)

  endViewAsUser()
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/v1/auth/impersonation/end',
    expect.objectContaining({
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
      headers: { Authorization: 'Bearer view-only-token' },
    }),
  )
  expect(localStorage.getItem('zzh_has_auth_session')).toBe('1')
  expect(sessionStorage.length).toBe(0)
  await expect(loadViewAsUser(null, signal())).resolves.toHaveProperty('error')
  expect(fetchMock).toHaveBeenCalledTimes(4)
})

it('never uses the existing login when a launch is missing, expired, or rejected', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(succeed({ ...exchangeData(), access_token_expires_at: new Date(0).toISOString() }))
    .mockResolvedValueOnce(Response.json({ code: 10101 }, { status: 401 }))
  vi.stubGlobal('fetch', fetchMock)

  await expect(loadViewAsUser(null, signal())).resolves.toHaveProperty('error')
  await expect(loadViewAsUser('', signal())).resolves.toHaveProperty('error')
  expect(fetchMock).not.toHaveBeenCalled()
  await expect(loadViewAsUser('expired', signal())).resolves.toHaveProperty('error')
  await expect(loadViewAsUser('rejected', signal())).resolves.toHaveProperty('error')
  expect(sessionStorage.length).toBe(0)
  expect(localStorage.getItem('zzh_has_auth_session')).toBe('1')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('blocks cross-origin credential destinations and removes a revoked grant on unauthorized reads', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(succeed(exchangeData()))
    .mockResolvedValueOnce(Response.json({ code: 10101 }, { status: 401 }))
  vi.stubGlobal('fetch', fetchMock)

  await loadViewAsUser('active', signal())
  await expect(readAsUser('https://other.example/api/v1/me')).rejects.toMatchObject({ status: 400 })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await expect(readAsUser('/api/v1/me/usage-summary')).rejects.toMatchObject({ status: 401 })
  expect(sessionStorage.length).toBe(0)
  await expect(readAsUser('/api/v1/me/usage-summary')).rejects.toMatchObject({ status: 401 })
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
