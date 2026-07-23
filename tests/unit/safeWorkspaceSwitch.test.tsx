import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: 1,
  currentWorkspace: { id: 1, type: 'personal' } as any,
  locationPathname: '/smart/88',
  navigationLog: [] as string[],
  navigate: vi.fn(),
  switchWorkspace: vi.fn(),
  workspaces: [
    { id: 1, type: 'personal' },
    { id: 2, type: 'team' },
    { id: 3, type: 'team' },
  ] as any[],
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mocks.locationPathname }),
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/stores/workspaceSession', () => {
  const useWorkspaceSessionStore = Object.assign(vi.fn(), {
    getState: () => ({
      activeWorkspaceId: mocks.activeWorkspaceId,
      currentWorkspace: mocks.currentWorkspace,
      switchWorkspace: mocks.switchWorkspace,
      workspaces: mocks.workspaces,
    }),
  })
  return {
    deriveAllWorkspaces: (state: { workspaces: any[] }) => state.workspaces,
    deriveCurrentWorkspace: (state: { currentWorkspace: any }) => state.currentWorkspace,
    deriveWorkspaceId: (state: { activeWorkspaceId: number }) => state.activeWorkspaceId,
    useWorkspaceSessionStore,
  }
})

import {
  WORKSPACE_SWITCH_BRIDGE_PATH,
  resolveWorkspaceSwitchResetPath,
  useSafeWorkspaceSwitch,
} from '@/composables/useSafeWorkspaceSwitch'
import { useUiStore } from '@/stores/ui'

describe('safe workspace switch', () => {
  beforeEach(() => {
    mocks.activeWorkspaceId = 1
    mocks.currentWorkspace = { id: 1, type: 'personal' }
    mocks.locationPathname = '/smart/88'
    mocks.navigationLog.length = 0
    mocks.navigate.mockReset()
    mocks.switchWorkspace.mockReset()
    mocks.navigate.mockImplementation((path: string) => {
      mocks.navigationLog.push(`navigate:${path}`)
    })
    mocks.switchWorkspace.mockImplementation((id: number) => {
      mocks.navigationLog.push(`switch:${id}`)
    })
    useUiStore.setState({ workspaceSwitchLocked: false, workspaceSwitchLockReason: '' })
  })

  it('unmounts the source creative route before crossing the personal/team boundary', () => {
    const { result } = renderHook(() => useSafeWorkspaceSwitch())

    act(() => {
      expect(result.current(2)).toBe(true)
    })

    expect(mocks.navigationLog).toEqual([`navigate:${WORKSPACE_SWITCH_BRIDGE_PATH}`, 'switch:2', 'navigate:/smart'])
    expect(mocks.navigate).toHaveBeenNthCalledWith(
      1,
      WORKSPACE_SWITCH_BRIDGE_PATH,
      expect.objectContaining({ replace: true, flushSync: true }),
    )
    expect(mocks.navigate).toHaveBeenNthCalledWith(
      2,
      '/smart',
      expect.objectContaining({
        replace: true,
        flushSync: true,
        state: expect.objectContaining({ workspaceSwitchReset: true }),
      }),
    )
  })

  it('keeps a team project route pinned during a team-to-team switch', () => {
    mocks.activeWorkspaceId = 2
    mocks.currentWorkspace = { id: 2, type: 'team' }
    const { result } = renderHook(() => useSafeWorkspaceSwitch())

    act(() => {
      expect(result.current(3)).toBe(true)
    })

    expect(mocks.navigationLog).toEqual(['switch:3'])
  })

  it('uses the captured source after leaving an active team removed it from the store', () => {
    mocks.activeWorkspaceId = 1
    mocks.currentWorkspace = { id: 1, type: 'personal' }
    const { result } = renderHook(() => useSafeWorkspaceSwitch())

    act(() => {
      expect(result.current(1, { sourceWorkspace: { id: 2, type: 'team' } })).toBe(true)
    })

    expect(mocks.navigationLog).toEqual([`navigate:${WORKSPACE_SWITCH_BRIDGE_PATH}`, 'switch:1', 'navigate:/smart'])
    expect(mocks.switchWorkspace).toHaveBeenCalledWith(1, { forceMemberReload: true })
  })

  it('resets both blank smart and hot-copy sessions consistently', () => {
    expect(resolveWorkspaceSwitchResetPath('/smart', { id: 2, type: 'team' }, { id: 3, type: 'team' })).toBe('/smart')
    expect(resolveWorkspaceSwitchResetPath('/hot-copy/9', { id: 1, type: 'personal' }, { id: 2, type: 'team' })).toBe(
      '/hot-copy',
    )
  })

  it('refuses every switch path while a video generation owns the global lock', () => {
    useUiStore.setState({
      workspaceSwitchLocked: true,
      workspaceSwitchLockReason: '视频正在生成',
    })
    const { result } = renderHook(() => useSafeWorkspaceSwitch())

    act(() => {
      expect(result.current(2)).toBe(false)
    })

    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.switchWorkspace).not.toHaveBeenCalled()
    expect(useUiStore.getState().toast.message).toBe('视频正在生成')
  })

  it('finishes a required transition after an active workspace was already removed', () => {
    useUiStore.setState({
      workspaceSwitchLocked: true,
      workspaceSwitchLockReason: '视频正在生成',
    })
    const { result } = renderHook(() => useSafeWorkspaceSwitch())

    act(() => {
      expect(
        result.current(1, {
          sourceWorkspace: { id: 2, type: 'team' },
          allowLockedTransition: true,
        }),
      ).toBe(true)
    })

    expect(mocks.navigationLog).toEqual([`navigate:${WORKSPACE_SWITCH_BRIDGE_PATH}`, 'switch:1', 'navigate:/smart'])
  })
})
