import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  openTeamManage: vi.fn(),
  renameTeam: vi.fn(),
  safeSwitch: vi.fn(),
  showToast: vi.fn(),
  state: {
    activeId: 21,
    baseCredits: 1000,
    credits: 750,
    currentMember: { role: 'owner', workspace_id: 21 } as any,
    currentUser: { id: 101, nickname: 'Alice' } as any,
    currentWorkspace: { id: 21, name: 'Alpha团队', owner_user_id: 101, type: 'team' } as any,
    expiresAt: '2027-01-02T00:00:00Z',
    planName: '团队版',
    switchLocked: false,
    switchReason: '',
    workspaces: [
      { id: 21, name: 'Alpha团队', type: 'team' },
      { id: 22, name: 'Beta团队', type: 'team' },
    ] as any[],
  },
}))

vi.mock('@/composables/useSafeWorkspaceSwitch', () => ({ useSafeWorkspaceSwitch: () => mocks.safeSwitch }))
vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: mocks.confirm }),
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('@/stores/ui', () => ({
  openTeamManage: mocks.openTeamManage,
  useUiStore: (selector: (state: any) => unknown) =>
    selector({
      workspaceSwitchLocked: mocks.state.switchLocked,
      workspaceSwitchLockReason: mocks.state.switchReason,
    }),
}))
vi.mock('@/stores/workspaceSession', () => ({
  useAllWorkspaces: () => mocks.state.workspaces,
  useCurrentMember: () => mocks.state.currentMember,
  useCurrentPlanExpiresAt: () => mocks.state.expiresAt,
  useCurrentPlanName: () => mocks.state.planName,
  useCurrentUser: () => mocks.state.currentUser,
  useCurrentWorkspace: () => mocks.state.currentWorkspace,
  usePlanBaseCredits: () => mocks.state.baseCredits,
  useWalletCredits: () => mocks.state.credits,
  useWorkspaceId: () => mocks.state.activeId,
  useWorkspaceSessionStore: Object.assign(
    (selector: (state: any) => unknown) => selector({ renameTeam: mocks.renameTeam }),
    {
      getState: () => ({ renameTeam: mocks.renameTeam }),
    },
  ),
}))

import PersonalPanel from '@/components/layout/PersonalPanel'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('PersonalPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mocks.state, {
      activeId: 21,
      baseCredits: 1000,
      credits: 750,
      currentMember: { role: 'owner', workspace_id: 21 },
      currentUser: { id: 101, nickname: 'Alice' },
      currentWorkspace: { id: 21, name: 'Alpha团队', owner_user_id: 101, type: 'team' },
      expiresAt: '2027-01-02T00:00:00Z',
      planName: '团队版',
      switchLocked: false,
      switchReason: '',
      workspaces: [
        { id: 21, name: 'Alpha团队', type: 'team' },
        { id: 22, name: 'Beta团队', type: 'team' },
      ],
    })
    mocks.confirm.mockResolvedValue(null)
    mocks.renameTeam.mockResolvedValue(undefined)
    mocks.safeSwitch.mockReturnValue(true)
  })

  it('shows role, membership usage, and switches one non-active workspace before closing', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onMember = vi.fn()
    render(<PersonalPanel onClose={onClose} onMember={onMember} />)

    expect(screen.getByText('超级管理员')).toBeInTheDocument()
    expect(screen.getByText('积分已用25%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Alpha团队/ })).toHaveAttribute('aria-current', 'true')
    await user.click(screen.getByRole('button', { name: /Beta团队/ }))
    expect(mocks.safeSwitch).toHaveBeenCalledWith(22)
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /团队版/ }))
    expect(onMember).toHaveBeenCalledTimes(1)
  })

  it('does not reveal team identity when member data belongs to another workspace', () => {
    mocks.state.currentMember = { role: 'owner', workspace_id: 999 }
    mocks.state.currentWorkspace = { id: 21, name: '机密团队名称', type: 'team' }
    render(<PersonalPanel />)

    expect(screen.queryByText('机密团队名称')).not.toBeInTheDocument()
    expect(screen.getAllByText('团队空间')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '团队成员' })).not.toBeInTheDocument()
  })

  it('deduplicates rename confirmation and ignores it after the active workspace changes', async () => {
    const user = userEvent.setup()
    const pending = deferred<string | null>()
    mocks.confirm.mockReturnValue(pending.promise)
    const view = render(<PersonalPanel />)

    await user.dblClick(screen.getByRole('button', { name: '重命名团队' }))
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    mocks.state.activeId = 22
    mocks.state.currentWorkspace = { id: 22, name: 'Beta团队', owner_user_id: 101, type: 'team' }
    view.rerender(<PersonalPanel />)
    await act(async () => {
      pending.resolve('迟到的新名称')
      await pending.promise
    })

    expect(mocks.renameTeam).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalledWith('团队名称已更新', 'success')
  })

  it('recovers after a rename conflict and allows retry', async () => {
    const user = userEvent.setup()
    mocks.confirm.mockResolvedValueOnce('新团队名').mockResolvedValueOnce('最终团队名')
    mocks.renameTeam.mockRejectedValueOnce({ status: 409 }).mockResolvedValueOnce(undefined)
    render(<PersonalPanel />)

    await user.click(screen.getByRole('button', { name: '重命名团队' }))
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('已存在同名空间,请换一个名称', 'error'))
    expect(screen.getByRole('button', { name: '重命名团队' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '重命名团队' }))
    await waitFor(() => expect(mocks.renameTeam).toHaveBeenCalledTimes(2))
    expect(mocks.showToast).toHaveBeenCalledWith('团队名称已更新', 'success')
  })
})
