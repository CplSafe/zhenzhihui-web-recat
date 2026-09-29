import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openComingSoon: vi.fn(),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/stores/ui', () => ({ openComingSoon: mocks.openComingSoon }))

describe('useSidebarNavigate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens the creative entry as an explicit fresh session', () => {
    const { result } = renderHook(() => useSidebarNavigate())

    act(() => result.current('creative'))

    expect(mocks.navigate).toHaveBeenCalledWith('/smart', { state: { taskCenterNewSession: true } })
  })

  it('keeps ordinary sidebar destinations unchanged', () => {
    const { result } = renderHook(() => useSidebarNavigate())

    act(() => result.current('projects'))

    expect(mocks.navigate).toHaveBeenCalledWith('/projects')
  })
})
