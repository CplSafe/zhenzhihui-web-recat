import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAuthenticated: false,
  navigate: vi.fn(),
  requestConfirm: vi.fn(),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: mocks.isAuthenticated }) }))
vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: mocks.requestConfirm }),
}))

import { useRequireAuth } from '@/composables/useRequireAuth'

describe('useRequireAuth', () => {
  beforeEach(() => {
    mocks.isAuthenticated = false
    mocks.navigate.mockReset()
    mocks.requestConfirm.mockReset()
  })

  it('runs the protected action immediately for an authenticated user', async () => {
    mocks.isAuthenticated = true
    const action = vi.fn()
    const { result } = renderHook(() => useRequireAuth())

    await expect(result.current(action)).resolves.toBe(true)
    expect(action).toHaveBeenCalledOnce()
    expect(mocks.requestConfirm).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('returns false and stays on the page when a guest cancels', async () => {
    mocks.requestConfirm.mockResolvedValue(false)
    const action = vi.fn()
    const { result } = renderHook(() => useRequireAuth())

    await expect(result.current(action)).resolves.toBe(false)
    expect(mocks.requestConfirm).toHaveBeenCalledWith('登录后即可使用此功能', {
      title: '需要登录',
      confirmLabel: '去登录',
      cancelLabel: '取消',
    })
    expect(action).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('navigates a confirming guest to login without executing the action', async () => {
    mocks.requestConfirm.mockResolvedValue(true)
    const action = vi.fn()
    const { result } = renderHook(() => useRequireAuth())

    await expect(result.current(action)).resolves.toBe(false)
    expect(action).not.toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledOnce()
    expect(mocks.navigate).toHaveBeenCalledWith('/login')
  })

  it('uses the latest authentication state after a session update', async () => {
    mocks.requestConfirm.mockResolvedValue(false)
    const action = vi.fn()
    const { result, rerender } = renderHook(() => useRequireAuth())
    await result.current(action)
    expect(action).not.toHaveBeenCalled()

    mocks.isAuthenticated = true
    rerender()
    await act(async () => {
      await result.current(action)
    })
    expect(action).toHaveBeenCalledOnce()
  })
})
