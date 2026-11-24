import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createWorkspaceInvitation: vi.fn(),
  deleteTeam: vi.fn(),
  deleteWorkspaceInvitation: vi.fn(),
  disbandTeam: vi.fn(),
  finalizeWorkspaceRemoval: vi.fn(),
  getSubscription: vi.fn(),
  listWorkspaceInvitations: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  loadWorkspaces: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  requestConfirm: vi.fn(),
  switchWorkspaceSafely: vi.fn(),
  transferWorkspaceOwnership: vi.fn(),
  updateWorkspaceMemberQuota: vi.fn(),
  updateWorkspaceMemberRole: vi.fn(),
  ui: { workspaceSwitchLockReason: '', workspaceSwitchLocked: false },
}))

vi.mock('@/api/auth', () => ({
  listWorkspaceMembers: mocks.listWorkspaceMembers,
}))

vi.mock('@/api/business', () => ({
  createWorkspaceInvitation: mocks.createWorkspaceInvitation,
  deleteWorkspaceInvitation: mocks.deleteWorkspaceInvitation,
  getSubscription: mocks.getSubscription,
  listWorkspaceInvitations: mocks.listWorkspaceInvitations,
  removeWorkspaceMember: mocks.removeWorkspaceMember,
  transferWorkspaceOwnership: mocks.transferWorkspaceOwnership,
  updateWorkspaceMemberQuota: mocks.updateWorkspaceMemberQuota,
  updateWorkspaceMemberRole: mocks.updateWorkspaceMemberRole,
}))

vi.mock('@/stores/workspaceSession', () => {
  const state = {
    deleteTeam: mocks.deleteTeam,
    disbandTeam: mocks.disbandTeam,
    finalizeWorkspaceRemoval: mocks.finalizeWorkspaceRemoval,
    loadWorkspaces: mocks.loadWorkspaces,
  }
  const useWorkspaceSessionStore = Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state,
  })
  return {
    extractWorkspaceMemberItems: (payload: any) =>
      Array.isArray(payload) ? payload : payload?.items || payload?.list || payload?.members || payload?.records || [],
    useWorkspaceSessionStore,
  }
})

vi.mock('@/stores/ui', () => ({
  useUiStore: (selector: (state: typeof mocks.ui) => unknown) => selector(mocks.ui),
}))

vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: mocks.requestConfirm }),
}))

vi.mock('@/composables/useSafeWorkspaceSwitch', () => ({
  useSafeWorkspaceSwitch: () => mocks.switchWorkspaceSafely,
}))

import TeamManagementModal from '@/components/team/TeamManagementModal'
import { markInitialTeamInvitation } from '@/utils/teamInitialInvitation'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function member(id: number, name: string, role: 'owner' | 'admin' | 'member' = 'member') {
  return { id, mobile: `1760000000${id}`, name, role, user_id: id }
}

function modalProps(overrides: Record<string, unknown> = {}) {
  return {
    currentMember: { role: 'owner', user_id: 7, workspace_id: 21 },
    onClose: vi.fn(),
    onToast: vi.fn(),
    open: true,
    sessionUserId: 7,
    workspace: { id: 21, name: '甲团队', owner_user_id: 7, type: 'team' },
    workspaceId: 21,
    ...overrides,
  }
}

describe('TeamManagementModal behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ui.workspaceSwitchLocked = false
    mocks.ui.workspaceSwitchLockReason = ''
    mocks.getSubscription.mockResolvedValue({ max_members: 5 })
    mocks.listWorkspaceMembers.mockResolvedValue([])
    mocks.listWorkspaceInvitations.mockResolvedValue([])
    mocks.createWorkspaceInvitation.mockResolvedValue({
      code: 'NEWCODE1',
      expires_at: '2099-01-01T00:00:00.000Z',
      id: 9,
    })
    mocks.deleteWorkspaceInvitation.mockResolvedValue(undefined)
    mocks.requestConfirm.mockResolvedValue(true)
    mocks.switchWorkspaceSafely.mockReturnValue(true)
  })

  it('shows loading then an empty state and reports a member-load failure without exposing stale rows', async () => {
    const members = deferred<any[]>()
    const onToast = vi.fn()
    mocks.listWorkspaceMembers.mockReturnValue(members.promise)
    render(<TeamManagementModal {...modalProps({ onToast })} />)

    expect(screen.getByText('正在加载成员信息...')).toBeInTheDocument()
    await act(async () => {
      members.reject(new Error('成员接口失败'))
      await members.promise.catch(() => undefined)
    })

    expect(await screen.findByText('暂无成员')).toBeInTheDocument()
    expect(onToast).toHaveBeenCalledWith('成员接口失败', 'error')
  })

  it('ignores a late workspace A response after switching to workspace B', async () => {
    const workspaceA = deferred<any[]>()
    const workspaceB = deferred<any[]>()
    mocks.listWorkspaceMembers.mockImplementation((workspaceId: number) =>
      workspaceId === 21 ? workspaceA.promise : workspaceB.promise,
    )
    const propsA = modalProps({
      currentMember: { role: 'member', user_id: 7, workspace_id: 21 },
      sessionUserId: 7,
      workspace: { id: 21, name: '甲团队', owner_user_id: 99, type: 'team' },
    })
    const view = render(<TeamManagementModal {...propsA} />)
    await waitFor(() => expect(mocks.listWorkspaceMembers).toHaveBeenCalledWith(21))

    const propsB = modalProps({
      currentMember: { role: 'member', user_id: 7, workspace_id: 22 },
      sessionUserId: 7,
      workspace: { id: 22, name: '乙团队', owner_user_id: 99, type: 'team' },
      workspaceId: 22,
    })
    view.rerender(<TeamManagementModal {...propsB} />)
    await waitFor(() => expect(mocks.listWorkspaceMembers).toHaveBeenCalledWith(22))

    await act(async () => {
      workspaceB.resolve([member(7, '乙空间成员')])
      await workspaceB.promise
    })
    expect(await screen.findByText('乙空间成员')).toBeInTheDocument()

    await act(async () => {
      workspaceA.resolve([member(7, '甲空间旧成员')])
      await workspaceA.promise
    })
    expect(screen.queryByText('甲空间旧成员')).not.toBeInTheDocument()
    expect(screen.getByText('乙空间成员')).toBeInTheDocument()
  })

  it('does not apply or toast a member response after the modal closes', async () => {
    const members = deferred<any[]>()
    const onToast = vi.fn()
    mocks.listWorkspaceMembers.mockReturnValue(members.promise)
    const props = modalProps({ onToast })
    const view = render(<TeamManagementModal {...props} />)
    await waitFor(() => expect(mocks.listWorkspaceMembers).toHaveBeenCalled())

    view.rerender(<TeamManagementModal {...props} open={false} />)
    await act(async () => {
      members.resolve([member(8, '迟到成员')])
      await members.promise
    })

    expect(screen.queryByRole('dialog', { name: '团队管理' })).not.toBeInTheDocument()
    expect(onToast).not.toHaveBeenCalled()
  })

  it('lets the owner manage invitations and member roles and keeps ordinary members from inviting', async () => {
    const user = userEvent.setup()
    mocks.listWorkspaceMembers.mockResolvedValue([member(7, '所有者', 'owner'), member(8, '普通成员')])
    mocks.listWorkspaceInvitations.mockResolvedValue([
      { code: 'ABCD1234', created_at: '2026-07-01T00:00:00.000Z', expires_at: '2099-01-01', id: 3 },
    ])
    const owner = modalProps()
    const view = render(<TeamManagementModal {...owner} />)

    expect(await screen.findByText('普通成员')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '复制邀请码' })).toBeEnabled()
    expect(mocks.listWorkspaceInvitations).toHaveBeenCalledWith(21)
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument()

    const more = screen.getAllByRole('button', { name: '更多操作' })
    await user.click(more[more.length - 1])
    expect(screen.getByRole('button', { name: '设为管理员' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移出团队' })).toBeInTheDocument()
    view.unmount()

    vi.clearAllMocks()
    mocks.listWorkspaceMembers.mockResolvedValue([member(7, '普通成员')])
    const ordinary = modalProps({
      currentMember: { role: 'member', user_id: 7, workspace_id: 21 },
      sessionUserId: 7,
      workspace: { id: 21, name: '甲团队', owner_user_id: 99, type: 'team' },
    })
    render(<TeamManagementModal {...ordinary} />)
    expect(await screen.findByText('普通成员')).toBeInTheDocument()
    expect(mocks.listWorkspaceInvitations).not.toHaveBeenCalled()
    expect(screen.getByText('仅空间所有者和管理员可管理邀请码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制邀请码' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '生成邀请码' })).not.toBeInTheDocument()
  })

  it('lets a team admin copy and generate member invitations without revoking an existing code', async () => {
    const user = userEvent.setup()
    const onToast = vi.fn()
    mocks.listWorkspaceMembers.mockResolvedValue([{ ...member(7, '管理员', 'admin'), id: 91 }, member(8, '普通成员')])
    mocks.listWorkspaceInvitations.mockResolvedValue([
      {
        code: 'MEMB1234',
        created_at: '2026-07-01T00:00:00.000Z',
        expires_at: '2099-01-01',
        id: 3,
        role: 'member',
      },
      {
        code: 'ADMIN123',
        created_at: '2026-07-02T00:00:00.000Z',
        expires_at: '2099-01-01',
        id: 4,
        role: 'admin',
      },
    ])
    const props = modalProps({
      currentMember: null,
      onToast,
      workspace: { id: 21, name: '甲团队', owner_user_id: 99, type: 'team' },
    })
    const view = render(<TeamManagementModal {...props} />)

    expect(await screen.findByText('MEMB 1234')).toBeInTheDocument()
    expect(screen.queryByText('ADMI N123')).not.toBeInTheDocument()
    expect(mocks.listWorkspaceInvitations).toHaveBeenCalledWith(21)
    expect(screen.queryByRole('button', { name: '撤销邀请' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '复制邀请码' }))
    expect(await navigator.clipboard.readText()).toBe('MEMB1234')

    await user.selectOptions(screen.getByRole('combobox', { name: '有效期' }), '30')
    await user.click(screen.getByRole('button', { name: '生成邀请码' }))
    expect(mocks.createWorkspaceInvitation).toHaveBeenCalledWith({ workspaceId: 21, expiryDays: 30 })
    expect(await screen.findByText('NEWC ODE1')).toBeInTheDocument()
    expect(onToast).toHaveBeenCalledWith('邀请码已生成', 'success')
    expect(mocks.deleteWorkspaceInvitation).not.toHaveBeenCalled()

    mocks.listWorkspaceMembers.mockResolvedValue([member(7, '乙空间成员')])
    view.rerender(
      <TeamManagementModal
        {...props}
        currentMember={{ role: 'admin', user_id: 7, workspace_id: 21 }}
        workspace={{ id: 22, name: '乙团队', owner_user_id: 99, type: 'team' }}
        workspaceId={22}
      />,
    )
    expect(await screen.findByText('乙空间成员')).toBeInTheDocument()
    expect(mocks.listWorkspaceInvitations).not.toHaveBeenCalledWith(22)
    expect(screen.queryByRole('button', { name: '生成邀请码' })).not.toBeInTheDocument()
    expect(screen.queryByText('NEWC ODE1')).not.toBeInTheDocument()
  })

  it('keeps invitation actions unavailable in a full team and a personal space', async () => {
    mocks.getSubscription.mockResolvedValue({ max_members: 2 })
    mocks.listWorkspaceMembers.mockResolvedValue([member(7, '管理员', 'admin'), member(99, '所有者', 'owner')])
    const props = modalProps({
      currentMember: { role: 'admin', user_id: 7, workspace_id: 21 },
      workspace: { id: 21, name: '甲团队', owner_user_id: 99, type: 'team' },
    })
    const view = render(<TeamManagementModal {...props} />)

    expect(await screen.findByText('席位已满(2/2),暂不可再邀请')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制邀请码' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '生成邀请码' })).not.toBeInTheDocument()

    view.rerender(
      <TeamManagementModal
        {...props}
        workspace={{ id: 22, name: '个人空间', owner_user_id: 7, type: 'personal' }}
        workspaceId={22}
      />,
    )
    expect(screen.getByText('个人空间不支持邀请码')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成邀请码' })).not.toBeInTheDocument()
    expect(mocks.listWorkspaceInvitations).not.toHaveBeenCalledWith(22)
    expect(mocks.createWorkspaceInvitation).not.toHaveBeenCalled()
  })

  it('lets the owner replace the current code and retry revoking the replacement after an API failure', async () => {
    const user = userEvent.setup()
    const onToast = vi.fn()
    mocks.listWorkspaceMembers.mockResolvedValue([member(7, '所有者', 'owner')])
    mocks.listWorkspaceInvitations
      .mockResolvedValueOnce([{ code: 'ABCD1234', expires_at: '2099-01-01', id: 3 }])
      .mockResolvedValueOnce([{ code: 'NEWCODE1', expires_at: '2099-01-01', id: 9 }])
    mocks.deleteWorkspaceInvitation
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('撤销失败，请重试'))
      .mockResolvedValueOnce(undefined)
    render(<TeamManagementModal {...modalProps({ onToast })} />)

    await user.click(await screen.findByRole('button', { name: '重新生成' }))
    expect(await screen.findByText('NEWC ODE1')).toBeInTheDocument()
    expect(mocks.deleteWorkspaceInvitation).toHaveBeenNthCalledWith(1, { workspaceId: 21, invitationId: 3 })
    expect(onToast).toHaveBeenCalledWith('邀请码已重新生成', 'success')

    await user.click(screen.getByRole('button', { name: '撤销邀请' }))
    expect(onToast).toHaveBeenCalledWith('撤销失败，请重试', 'error')
    expect(screen.getByText('NEWC ODE1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '撤销邀请' }))
    expect(mocks.deleteWorkspaceInvitation).toHaveBeenNthCalledWith(3, { workspaceId: 21, invitationId: 9 })
    expect(await screen.findByText('暂无邀请码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制邀请码' })).toBeDisabled()
  })

  it('keeps the first automatic invitation reserved for the owner', async () => {
    const invitations = deferred<any[]>()
    mocks.listWorkspaceInvitations.mockReturnValueOnce(invitations.promise)
    const admin = modalProps({
      currentMember: { role: 'admin', user_id: 8, workspace_id: 21 },
      sessionUserId: 8,
    })
    markInitialTeamInvitation(8, 21)
    const view = render(<TeamManagementModal {...admin} />)
    await waitFor(() => expect(mocks.listWorkspaceInvitations).toHaveBeenCalledWith(21))
    await act(async () => {
      invitations.resolve([])
      await invitations.promise
    })
    expect(mocks.createWorkspaceInvitation).not.toHaveBeenCalled()

    markInitialTeamInvitation(7, 21)
    view.rerender(<TeamManagementModal {...modalProps()} />)
    expect(await screen.findByText('NEWC ODE1')).toBeInTheDocument()
    expect(mocks.createWorkspaceInvitation).toHaveBeenCalledExactlyOnceWith({ workspaceId: 21, expiryDays: 7 })
  })

  it('deduplicates invitation generation, recovers after failure, and can retry', async () => {
    const user = userEvent.setup()
    const first = deferred<any>()
    const onToast = vi.fn()
    mocks.listWorkspaceMembers.mockResolvedValue([member(7, '所有者', 'owner')])
    mocks.createWorkspaceInvitation.mockReturnValueOnce(first.promise).mockResolvedValueOnce({
      code: 'RETRY123',
      expires_at: '2099-01-01',
      id: 10,
    })
    render(<TeamManagementModal {...modalProps({ onToast })} />)
    const regenerate = await screen.findByRole('button', { name: '生成邀请码' })

    await user.dblClick(regenerate)
    expect(mocks.createWorkspaceInvitation).toHaveBeenCalledTimes(1)
    await act(async () => {
      first.reject(new Error('生成失败'))
      await first.promise.catch(() => undefined)
    })
    expect(onToast).toHaveBeenCalledWith('生成失败', 'error')

    await user.click(screen.getByRole('button', { name: '生成邀请码' }))
    await waitFor(() => expect(mocks.createWorkspaceInvitation).toHaveBeenCalledTimes(2))
    expect(onToast).toHaveBeenCalledWith('邀请码已生成', 'success')
  })

  it('closes with Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TeamManagementModal {...modalProps({ onClose })} />)

    expect(screen.getByRole('dialog', { name: '团队管理' })).toHaveAttribute('aria-modal', 'true')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
