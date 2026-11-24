import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelled: vi.fn(),
  getAccountSwitchId: vi.fn(),
  getError: vi.fn((_error: unknown, fallback: string) => fallback),
  hasConfiguredDevBackend: vi.fn(),
  leaveAccountSwitch: vi.fn(),
  logoutSession: vi.fn(),
  markDevLogout: vi.fn(),
  showToast: vi.fn(),
  start: vi.fn(),
  success: vi.fn(),
}))

vi.mock('@/api/accountSwitch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/accountSwitch')>()),
  getAccountSwitchId: mocks.getAccountSwitchId,
}))
vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  getAuthErrorMessage: mocks.getError,
  logoutSession: mocks.logoutSession,
}))
vi.mock('@/api/viewAsUser', () => ({ leaveAccountSwitch: mocks.leaveAccountSwitch }))
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({
    handleLogoutCancelled: mocks.cancelled,
    handleLogoutStart: mocks.start,
    handleLogoutSuccess: mocks.success,
  }),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('@/utils/devAuth', () => ({ markDevLogout: mocks.markDevLogout }))
vi.mock('@/utils/devBackend', () => ({ hasConfiguredDevBackend: mocks.hasConfiguredDevBackend }))

import { AuthApiError } from '@/api/auth'
import { useLogout } from '@/composables/useLogout'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('useLogout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DEV', false)
    mocks.getAccountSwitchId.mockReturnValue('')
    mocks.hasConfiguredDevBackend.mockReturnValue(true)
    mocks.leaveAccountSwitch.mockResolvedValue(undefined)
    mocks.logoutSession.mockResolvedValue(undefined)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('deduplicates a pending logout request', async () => {
    const pending = deferred<void>()
    mocks.logoutSession.mockReturnValue(pending.promise)
    const { result } = renderHook(() => useLogout())

    act(() => {
      void result.current.logout()
      void result.current.logout()
    })
    expect(mocks.logoutSession).toHaveBeenCalledTimes(1)
    expect(result.current.isLoggingOut).toBe(true)

    await act(async () => {
      pending.resolve(undefined)
      await pending.promise
    })
    expect(mocks.success).toHaveBeenCalledTimes(1)
  })

  it('restores the authenticated state after failure and allows retry', async () => {
    const error = new Error('退出服务繁忙')
    mocks.logoutSession.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)
    mocks.getError.mockReturnValue('退出服务繁忙')
    const { result } = renderHook(() => useLogout())

    await act(async () => result.current.logout())
    expect(mocks.start).toHaveBeenCalledTimes(1)
    expect(mocks.cancelled).toHaveBeenCalledTimes(1)
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('退出服务繁忙', 'error')
    expect(result.current.isLoggingOut).toBe(false)

    await act(async () => result.current.logout())
    expect(mocks.logoutSession).toHaveBeenCalledTimes(2)
    expect(mocks.success).toHaveBeenCalledTimes(1)
  })

  it('retries ending a switched account session without logging out the ordinary account', async () => {
    mocks.getAccountSwitchId.mockReturnValue('switched-session')
    mocks.leaveAccountSwitch.mockRejectedValueOnce(new Error('暂时不可用'))
    const { result } = renderHook(() => useLogout())

    await act(async () => result.current.logout())
    expect(mocks.showToast).toHaveBeenCalledWith('暂时无法退出切换，请重试。', 'error')
    expect(result.current.isLoggingOut).toBe(false)

    await act(async () => result.current.logout())
    expect(mocks.leaveAccountSwitch).toHaveBeenNthCalledWith(2, 'switched-session')
    expect(mocks.logoutSession).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it.each([{ status: 401 }, { code: 10101, status: 200 }, { code: 'UNAUTHORIZED', status: 200 }])(
    'clears local state when the server confirms the session is already gone (%o)',
    async (errorData) => {
      mocks.logoutSession.mockRejectedValueOnce(new AuthApiError('未登录', errorData))
      const { result } = renderHook(() => useLogout())

      await act(async () => result.current.logout())

      expect(mocks.success).toHaveBeenCalledOnce()
      expect(mocks.cancelled).not.toHaveBeenCalled()
      expect(mocks.showToast).not.toHaveBeenCalledWith(expect.anything(), 'error')
      expect(result.current.isLoggingOut).toBe(false)
    },
  )

  it.each([true, false])('uses the server in development only when configured (%s)', async (configured) => {
    vi.stubEnv('DEV', true)
    mocks.hasConfiguredDevBackend.mockReturnValue(configured)
    const { result } = renderHook(() => useLogout())

    await act(async () => result.current.logout())

    expect(mocks.logoutSession).toHaveBeenCalledTimes(configured ? 1 : 0)
    expect(mocks.markDevLogout).toHaveBeenCalledTimes(configured ? 0 : 1)
    expect(mocks.success).toHaveBeenCalledOnce()
  })
})
