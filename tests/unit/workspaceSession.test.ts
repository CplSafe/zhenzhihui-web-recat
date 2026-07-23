import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  disbandWorkspace: vi.fn(),
  getSubscription: vi.fn(),
  getWallet: vi.fn(),
  leaveWorkspace: vi.fn(),
  listBillingPlans: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  listWorkspaces: vi.fn(),
  redeemWorkspaceInvitation: vi.fn(),
  updateWorkspace: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  createWorkspace: mocks.createWorkspace,
  disbandWorkspace: mocks.disbandWorkspace,
  extractPageItems: (payload: any) => (Array.isArray(payload) ? payload : payload?.items || []),
  getSubscription: mocks.getSubscription,
  getWallet: mocks.getWallet,
  leaveWorkspace: mocks.leaveWorkspace,
  listBillingPlans: mocks.listBillingPlans,
  listWorkspaces: mocks.listWorkspaces,
  redeemWorkspaceInvitation: mocks.redeemWorkspaceInvitation,
  setActiveWorkspaceId: vi.fn(),
  updateWorkspace: mocks.updateWorkspace,
}))

vi.mock('@/api/auth', () => ({
  listWorkspaceMembers: mocks.listWorkspaceMembers,
}))

import { deriveCurrentMember, deriveWorkspaceId, useWorkspaceSessionStore } from '@/stores/workspaceSession'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const personalWorkspace = { id: 1, name: '个人空间', type: 'personal' }
const teamWorkspace = { id: 2, name: '团队空间', type: 'team', owner_user_id: 99 }
const personalMember = { user_id: 7, workspace_id: 1, role: 'owner' }
const teamMember = { user_id: 7, workspace_id: 2, role: 'member' }

function seedActiveWorkspace(workspaceId: number, member: any) {
  useWorkspaceSessionStore.setState({
    authSession: {
      user: { id: 7 },
      workspace: personalWorkspace,
      workspaces: [personalWorkspace, teamWorkspace],
      currentMember: personalMember,
    },
    userWorkspaces: [personalWorkspace, teamWorkspace],
    activeWorkspaceOverrideId: workspaceId,
    pendingWorkspaceTransition: null,
    currentSubscription: { active: true },
    currentWallet: { available: 10 },
    billingPlans: [{ code: 'paid' }],
    billingPlanCandidates: ['paid'],
    currentWorkspaceMember: member,
    currentWorkspaceMemberWorkspaceId: workspaceId,
  })
}

describe('workspace session isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mocks.createWorkspace.mockResolvedValue(teamWorkspace)
    mocks.disbandWorkspace.mockResolvedValue(undefined)
    mocks.leaveWorkspace.mockResolvedValue(undefined)
    mocks.listBillingPlans.mockResolvedValue([])
    mocks.listWorkspaces.mockResolvedValue([personalWorkspace, teamWorkspace])
    mocks.redeemWorkspaceInvitation.mockResolvedValue({ Workspace: teamWorkspace })
    mocks.updateWorkspace.mockResolvedValue(teamWorkspace)
    mocks.getSubscription.mockResolvedValue(null)
    mocks.getWallet.mockResolvedValue(null)
    mocks.listWorkspaceMembers.mockImplementation((workspaceId: number) =>
      Promise.resolve(workspaceId === 1 ? [personalMember] : [teamMember]),
    )
    seedActiveWorkspace(1, personalMember)
  })

  it('clears the previous role immediately and rejects a stale member response', async () => {
    const oldMemberRequest = deferred<any[]>()
    const newMemberRequest = deferred<any[]>()
    mocks.listWorkspaceMembers.mockImplementation((workspaceId: number) =>
      workspaceId === 1 ? oldMemberRequest.promise : newMemberRequest.promise,
    )

    const staleRequest = useWorkspaceSessionStore.getState().loadCurrentWorkspaceMember(1)
    useWorkspaceSessionStore.getState().switchWorkspace(2)

    const switchingState = useWorkspaceSessionStore.getState()
    expect(deriveWorkspaceId(switchingState)).toBe(2)
    expect(switchingState.currentWorkspaceMember).toBeNull()
    expect(deriveCurrentMember(switchingState)).toBeNull()

    newMemberRequest.resolve([teamMember])
    await vi.waitFor(() => expect(deriveCurrentMember(useWorkspaceSessionStore.getState())).toEqual(teamMember))

    oldMemberRequest.resolve([{ ...personalMember, role: 'admin' }])
    await staleRequest
    expect(deriveCurrentMember(useWorkspaceSessionStore.getState())).toEqual(teamMember)
  })

  it('refreshes the joined workspace member after switching to it', async () => {
    const transition = await useWorkspaceSessionStore.getState().joinTeam('invite-code')

    expect(transition).toMatchObject({
      workspaceId: 2,
      sourceWorkspace: personalWorkspace,
    })
    expect(deriveWorkspaceId(useWorkspaceSessionStore.getState())).toBe(1)

    useWorkspaceSessionStore.getState().switchWorkspace(transition.workspaceId, { forceMemberReload: true })
    await vi.waitFor(() => expect(deriveCurrentMember(useWorkspaceSessionStore.getState())).toEqual(teamMember))
    expect(mocks.listWorkspaceMembers).toHaveBeenCalledWith(2)
  })

  it('refreshes the created workspace member after switching to it', async () => {
    mocks.listWorkspaces.mockResolvedValue([personalWorkspace])
    await useWorkspaceSessionStore.getState().createTeam('团队空间')

    await vi.waitFor(() => {
      expect(deriveWorkspaceId(useWorkspaceSessionStore.getState())).toBe(2)
      expect(deriveCurrentMember(useWorkspaceSessionStore.getState())).toEqual(teamMember)
    })
    expect(useWorkspaceSessionStore.getState().userWorkspaces).toContainEqual(teamWorkspace)
    expect(mocks.listWorkspaceMembers).toHaveBeenCalledWith(2)
  })

  it('falls back to personal space and refreshes its member after leaving the active team', async () => {
    seedActiveWorkspace(2, teamMember)
    mocks.listWorkspaces.mockResolvedValue([personalWorkspace])

    const transition = await useWorkspaceSessionStore.getState().deleteTeam(2)

    expect(transition).toEqual({
      workspaceId: 1,
      sourceWorkspace: teamWorkspace,
    })
    // The source scope must remain intact until the route bridge unmounts it.
    expect(deriveWorkspaceId(useWorkspaceSessionStore.getState())).toBe(2)
    expect(deriveCurrentMember(useWorkspaceSessionStore.getState())).toEqual(teamMember)
    expect(useWorkspaceSessionStore.getState().userWorkspaces).toEqual([personalWorkspace, teamWorkspace])

    useWorkspaceSessionStore.getState().switchWorkspace(transition.workspaceId, { forceMemberReload: true })
    await useWorkspaceSessionStore.getState().finalizeWorkspaceRemoval(2)
    await vi.waitFor(() => expect(deriveCurrentMember(useWorkspaceSessionStore.getState())).toEqual(personalMember))
    expect(useWorkspaceSessionStore.getState().userWorkspaces).toEqual([personalWorkspace])
    expect(mocks.listWorkspaceMembers).toHaveBeenCalledWith(1)
  })

  it('queues a safe bridge transition when a refresh no longer contains the active workspace', async () => {
    seedActiveWorkspace(2, teamMember)
    mocks.listWorkspaces.mockResolvedValue([personalWorkspace])

    await useWorkspaceSessionStore.getState().loadWorkspaces()

    const waitingState = useWorkspaceSessionStore.getState()
    expect(waitingState.pendingWorkspaceTransition).toEqual({
      removedWorkspaceId: 2,
      workspaceId: 1,
      sourceWorkspace: teamWorkspace,
    })
    expect(deriveWorkspaceId(waitingState)).toBe(2)
    expect(deriveCurrentMember(waitingState)).toEqual(teamMember)
    expect(waitingState.userWorkspaces).toEqual([personalWorkspace, teamWorkspace])

    // Mirrors the App-level bridge order: switch while the source is still present,
    // consume the exact transition, then remove the stale source from session state.
    waitingState.switchWorkspace(1, { forceMemberReload: true })
    const consumed = useWorkspaceSessionStore.getState().consumePendingWorkspaceTransition(2)
    expect(consumed).toEqual({
      removedWorkspaceId: 2,
      workspaceId: 1,
      sourceWorkspace: teamWorkspace,
    })
    await useWorkspaceSessionStore.getState().finalizeWorkspaceRemoval(2)

    const completedState = useWorkspaceSessionStore.getState()
    expect(deriveWorkspaceId(completedState)).toBe(1)
    expect(completedState.pendingWorkspaceTransition).toBeNull()
    expect(completedState.userWorkspaces).toEqual([personalWorkspace])
  })

  it('ignores workspace list responses from an older account session', async () => {
    const accountA = deferred<any[]>()
    const accountB = deferred<any[]>()
    const workspaceB = { id: 10, name: 'B personal', type: 'personal' }
    mocks.listWorkspaces.mockImplementationOnce(() => accountA.promise).mockImplementationOnce(() => accountB.promise)

    const staleLoad = useWorkspaceSessionStore.getState().loadWorkspaces()
    useWorkspaceSessionStore.getState().setAuthSession({
      user: { id: 8 },
      workspace: workspaceB,
      workspaces: [workspaceB],
    })
    const currentLoad = useWorkspaceSessionStore.getState().loadWorkspaces()

    accountB.resolve([workspaceB])
    await currentLoad
    accountA.resolve([personalWorkspace, teamWorkspace])
    await staleLoad

    expect(useWorkspaceSessionStore.getState().authSession?.user?.id).toBe(8)
    expect(useWorkspaceSessionStore.getState().userWorkspaces).toEqual([workspaceB])
  })

  it('does not finalize an old account removal against a newly authenticated account', async () => {
    const oldAccountRefresh = deferred<any[]>()
    const sameIdWorkspaceForAccountB = { id: 2, name: 'B 团队', type: 'team' }
    mocks.listWorkspaces.mockImplementationOnce(() => oldAccountRefresh.promise)

    const oldFinalization = useWorkspaceSessionStore.getState().finalizeWorkspaceRemoval(2)
    useWorkspaceSessionStore.getState().setAuthSession({
      user: { id: 8 },
      workspace: sameIdWorkspaceForAccountB,
      workspaces: [sameIdWorkspaceForAccountB],
    })

    oldAccountRefresh.resolve([personalWorkspace])
    await oldFinalization

    const current = useWorkspaceSessionStore.getState()
    expect(current.authSession?.user?.id).toBe(8)
    expect(current.userWorkspaces).toEqual([sameIdWorkspaceForAccountB])
    expect(current.authSession?.workspaces).toEqual([sameIdWorkspaceForAccountB])
  })

  it('keeps the selected workspace isolated for non-numeric account IDs', () => {
    const sessionFor = (userId: string) => ({
      user: { user_id: userId },
      workspace: personalWorkspace,
      workspaces: [personalWorkspace, teamWorkspace],
    })

    useWorkspaceSessionStore.getState().setAuthSession(sessionFor('account-a'))
    useWorkspaceSessionStore.getState().switchWorkspace(2)
    expect(deriveWorkspaceId(useWorkspaceSessionStore.getState())).toBe(2)

    useWorkspaceSessionStore.getState().setAuthSession(sessionFor('account-b'))
    expect(deriveWorkspaceId(useWorkspaceSessionStore.getState())).toBe(1)

    useWorkspaceSessionStore.getState().setAuthSession(sessionFor('account-a'))
    expect(deriveWorkspaceId(useWorkspaceSessionStore.getState())).toBe(2)
  })

  it('lets only the newest workspace list request update the same account', async () => {
    const older = deferred<any[]>()
    const newer = deferred<any[]>()
    const latestTeam = { id: 3, name: 'Latest team', type: 'team' }
    mocks.listWorkspaces.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise)

    const olderLoad = useWorkspaceSessionStore.getState().loadWorkspaces()
    const newerLoad = useWorkspaceSessionStore.getState().loadWorkspaces()
    newer.resolve([personalWorkspace, latestTeam])
    await newerLoad
    older.resolve([personalWorkspace, teamWorkspace])
    await olderLoad

    expect(useWorkspaceSessionStore.getState().userWorkspaces).toEqual([personalWorkspace, latestTeam])
  })

  it('accepts common paginated member response wrappers', async () => {
    mocks.listWorkspaceMembers.mockResolvedValue({
      data: { members: [teamMember] },
    })

    useWorkspaceSessionStore.getState().switchWorkspace(2, { forceMemberReload: true })

    await vi.waitFor(() => expect(deriveCurrentMember(useWorkspaceSessionStore.getState())).toEqual(teamMember))
  })

  it('matches workspace membership when the account ID is a string', async () => {
    const stringMember = { user_id: 'account-a', workspace_id: 1, role: 'owner' }
    mocks.listWorkspaceMembers.mockResolvedValue({ data: { members: [stringMember] } })

    useWorkspaceSessionStore.getState().setAuthSession({
      user: { user_id: 'account-a' },
      workspace: personalWorkspace,
      workspaces: [personalWorkspace, teamWorkspace],
    })

    await vi.waitFor(() => expect(deriveCurrentMember(useWorkspaceSessionStore.getState())).toEqual(stringMember))
  })

  it('returns a fallback for an active disband without activating it inside the mutation', async () => {
    const ownerTeam = { ...teamWorkspace, owner_user_id: 7 }
    seedActiveWorkspace(2, { ...teamMember, role: 'owner' })
    useWorkspaceSessionStore.setState({
      userWorkspaces: [personalWorkspace, ownerTeam],
      authSession: {
        user: { id: 7 },
        workspace: personalWorkspace,
        workspaces: [personalWorkspace, ownerTeam],
      },
    })
    mocks.listWorkspaces.mockResolvedValue([personalWorkspace])

    const transition = await useWorkspaceSessionStore.getState().disbandTeam(2)

    expect(transition).toEqual({
      workspaceId: 1,
      sourceWorkspace: ownerTeam,
    })
    expect(deriveWorkspaceId(useWorkspaceSessionStore.getState())).toBe(2)
    expect(useWorkspaceSessionStore.getState().currentWorkspaceMember).toEqual({ ...teamMember, role: 'owner' })
    expect(useWorkspaceSessionStore.getState().userWorkspaces).toEqual([personalWorkspace, ownerTeam])

    useWorkspaceSessionStore.getState().switchWorkspace(transition.workspaceId, { forceMemberReload: true })
    await useWorkspaceSessionStore.getState().finalizeWorkspaceRemoval(2)
    expect(useWorkspaceSessionStore.getState().userWorkspaces).toEqual([personalWorkspace])
  })
})
