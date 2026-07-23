import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sourceWorkspace = { id: 2, type: 'team', name: '旧团队' }

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: 2,
  pendingTransition: null as any,
  consumePendingWorkspaceTransition: vi.fn(),
  finalizeWorkspaceRemoval: vi.fn(),
  switchWorkspaceSafely: vi.fn(),
}))

vi.mock('@/auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: vi.fn(),
}))
vi.mock('@/components/AppToast', () => ({ default: () => null }))
vi.mock('@/components/AppConfirmDialog', () => ({ default: () => null }))
vi.mock('@/components/task/TaskCenterCoordinator', () => ({ default: () => null }))
vi.mock('@/composables/useSafeWorkspaceSwitch', () => ({
  useSafeWorkspaceSwitch: () => mocks.switchWorkspaceSafely,
}))
vi.mock('@/stores/guide', () => ({
  useGuideStore: vi.fn(),
}))
vi.mock('@/stores/ui', () => ({
  useUiStore: vi.fn(),
}))
vi.mock('@/stores/workspaceSession', () => {
  const getState = () => ({
    activeWorkspaceId: mocks.activeWorkspaceId,
    pendingWorkspaceTransition: mocks.pendingTransition,
    consumePendingWorkspaceTransition: mocks.consumePendingWorkspaceTransition,
    finalizeWorkspaceRemoval: mocks.finalizeWorkspaceRemoval,
  })
  const useWorkspaceSessionStore = Object.assign(
    (selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState()),
    { getState },
  )
  return {
    deriveWorkspaceId: (state: { activeWorkspaceId: number }) => state.activeWorkspaceId,
    useWorkspaceSessionStore,
  }
})
vi.mock('@/utils/inviteCode', () => ({ captureInviteCode: vi.fn() }))

import { WorkspaceRefreshTransitionBridge } from '@/App'

describe('App workspace refresh transition bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activeWorkspaceId = 2
    mocks.pendingTransition = {
      removedWorkspaceId: 2,
      workspaceId: 1,
      sourceWorkspace,
    }
    mocks.switchWorkspaceSafely.mockImplementation(() => {
      mocks.activeWorkspaceId = 1
      return true
    })
    mocks.consumePendingWorkspaceTransition.mockImplementation(() => {
      const transition = mocks.pendingTransition
      mocks.pendingTransition = null
      return transition
    })
    mocks.finalizeWorkspaceRemoval.mockResolvedValue(undefined)
  })

  it('forces the route-safe switch before finalizing a workspace removed by refresh', async () => {
    render(<WorkspaceRefreshTransitionBridge />)

    // The safe switch uses a flush-synchronous bridge navigation. It must run
    // after React finishes the effect that discovered the pending transition.
    expect(mocks.switchWorkspaceSafely).not.toHaveBeenCalled()
    await waitFor(() => expect(mocks.finalizeWorkspaceRemoval).toHaveBeenCalledWith(2))
    expect(mocks.switchWorkspaceSafely).toHaveBeenCalledWith(1, {
      sourceWorkspace,
      allowLockedTransition: true,
      suppressLockedToast: true,
    })
    expect(mocks.consumePendingWorkspaceTransition).toHaveBeenCalledWith(2)
    expect(mocks.switchWorkspaceSafely.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.consumePendingWorkspaceTransition.mock.invocationCallOrder[0],
    )
    expect(mocks.consumePendingWorkspaceTransition.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.finalizeWorkspaceRemoval.mock.invocationCallOrder[0],
    )
  })
})
