import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelled: vi.fn(),
  getError: vi.fn((_error: unknown, fallback: string) => fallback),
  logoutSession: vi.fn(),
  markDevLogout: vi.fn(),
  shouldClear: vi.fn(),
  showToast: vi.fn(),
  start: vi.fn(),
  success: vi.fn(),
}))

vi.mock('@/api/auth', () => ({
  getAuthErrorMessage: mocks.getError,
  logoutSession: mocks.logoutSession,
}))
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({
    handleLogoutCancelled: mocks.cancelled,
    handleLogoutStart: mocks.start,
    handleLogoutSuccess: mocks.success,
  }),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('@/utils/workflowGuards', () => ({ shouldClearSessionAfterLogoutFailure: mocks.shouldClear }))
vi.mock('@/App', () => ({ markDevLogout: mocks.markDevLogout }))

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
    mocks.logoutSession.mockResolvedValue(undefined)
    mocks.shouldClear.mockReturnValue(false)
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
})
