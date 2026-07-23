import {
  BusinessApiError,
  createWorkspace,
  createWorkspaceInvitation,
  deleteWorkspaceInvitation,
  disbandWorkspace,
  getWorkspaceMemberStatistics,
  getWorkspaceOverview,
  leaveWorkspace,
  listWorkspaceInvitations,
  listWorkspaces,
  redeemWorkspaceInvitation,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
  updateWorkspace,
  updateWorkspaceMemberQuota,
  updateWorkspaceMemberRole,
} from '@/api/business'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const INVALID_POSITIVE_INTEGERS = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1]

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function success(data: unknown = { ok: true }): Response {
  return response({ data })
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[callIndex]?.[1]?.body || '{}'))
}

describe('business team, member and invitation API contract', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(() => Promise.resolve(success()))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the workspace collection contract and normalizes workspace names', async () => {
    await listWorkspaces()
    await createWorkspace({ name: '  设计团队  ', type: 'team' })
    await updateWorkspace({ workspaceId: 21, name: '  新团队名称  ' })

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/workspaces',
      '/api/v1/workspaces',
      '/api/v1/workspaces/21',
    ])
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    )
    expect(requestBody(fetchMock, 1)).toEqual({ name: '设计团队', type: 'team' })
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({ method: 'PATCH', headers: { 'Content-Type': 'application/json' } }),
    )
    expect(requestBody(fetchMock, 2)).toEqual({ name: '新团队名称' })
  })

  it('normalizes invitation codes and pins every invitation request to its workspace', async () => {
    await redeemWorkspaceInvitation({ inviteCode: ' AB\n 12\tCD ' })
    await listWorkspaceInvitations(22)
    await createWorkspaceInvitation({ workspaceId: 22, expiryDays: 7.9, role: ' admin ' })
    await createWorkspaceInvitation({ workspaceId: 22, expiryDays: 0, role: '' })
    await deleteWorkspaceInvitation({ workspaceId: 22, invitationId: 81 })

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/invitations/redeem',
      '/api/v1/workspaces/22/invitations',
      '/api/v1/workspaces/22/invitations',
      '/api/v1/workspaces/22/invitations',
      '/api/v1/workspaces/22/invitations/81',
    ])
    expect(requestBody(fetchMock, 0)).toEqual({ code: 'AB12CD' })
    expect(requestBody(fetchMock, 2)).toEqual({ expires_in_days: 7, role: 'admin' })
    expect(requestBody(fetchMock, 3)).toEqual({ role: 'member' })
    expect(fetchMock.mock.calls[4]?.[1]).toEqual(expect.objectContaining({ method: 'DELETE' }))
  })

  it('pins member mutations to both workspace and user and preserves quota zeroes', async () => {
    await removeWorkspaceMember({ workspaceId: 23, userId: 101 })
    await updateWorkspaceMemberRole({ workspaceId: 23, userId: 102, role: ' admin ' })
    await updateWorkspaceMemberQuota({
      workspaceId: 23,
      userId: 103,
      canGenerate: false,
      maxTaskCredits: 0,
      monthlyCreditLimit: '0',
    })
    await transferWorkspaceOwnership({ workspaceId: 23, userId: 104 })

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/workspaces/23/members/101',
      '/api/v1/workspaces/23/members/102',
      '/api/v1/workspaces/23/members/103/quota',
      '/api/v1/workspaces/23/transfer-ownership',
    ])
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'DELETE' }))
    expect(requestBody(fetchMock, 1)).toEqual({ role: 'admin' })
    expect(requestBody(fetchMock, 2)).toEqual({
      can_generate: false,
      max_task_credits: 0,
      monthly_credit_limit: 0,
    })
    expect(requestBody(fetchMock, 3)).toEqual({ to_user_id: 104 })
  })

  it('uses the exact workspace lifecycle and reporting endpoints', async () => {
    await leaveWorkspace({ workspaceId: 24 })
    await disbandWorkspace({ workspaceId: 25 })
    await getWorkspaceOverview(26)
    await getWorkspaceMemberStatistics(27)

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/workspaces/24/leave',
      '/api/v1/workspaces/25/disband',
      '/api/v1/workspaces/26/overview',
      '/api/v1/workspaces/27/member-statistics',
    ])
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'POST' }))
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: 'POST' }))
  })

  const invalidIdContracts: Array<[string, (invalidId: number) => unknown]> = [
    ['update workspace workspaceId', (workspaceId) => updateWorkspace({ workspaceId, name: '团队' })],
    ['leave workspace workspaceId', (workspaceId) => leaveWorkspace({ workspaceId })],
    ['disband workspace workspaceId', (workspaceId) => disbandWorkspace({ workspaceId })],
    ['list invitation workspaceId', (workspaceId) => listWorkspaceInvitations(workspaceId)],
    ['create invitation workspaceId', (workspaceId) => createWorkspaceInvitation({ workspaceId, expiryDays: 7 })],
    ['delete invitation workspaceId', (workspaceId) => deleteWorkspaceInvitation({ workspaceId, invitationId: 1 })],
    ['delete invitation invitationId', (invitationId) => deleteWorkspaceInvitation({ workspaceId: 1, invitationId })],
    ['remove member workspaceId', (workspaceId) => removeWorkspaceMember({ workspaceId, userId: 1 })],
    ['remove member userId', (userId) => removeWorkspaceMember({ workspaceId: 1, userId })],
    ['update role workspaceId', (workspaceId) => updateWorkspaceMemberRole({ workspaceId, userId: 1, role: 'member' })],
    ['update role userId', (userId) => updateWorkspaceMemberRole({ workspaceId: 1, userId, role: 'member' })],
    [
      'update quota workspaceId',
      (workspaceId) => updateWorkspaceMemberQuota({ workspaceId, userId: 1, maxTaskCredits: 1 }),
    ],
    ['update quota userId', (userId) => updateWorkspaceMemberQuota({ workspaceId: 1, userId, maxTaskCredits: 1 })],
    ['transfer ownership workspaceId', (workspaceId) => transferWorkspaceOwnership({ workspaceId, userId: 1 })],
    ['transfer ownership userId', (userId) => transferWorkspaceOwnership({ workspaceId: 1, userId })],
    ['overview workspaceId', (workspaceId) => getWorkspaceOverview(workspaceId)],
    ['member statistics workspaceId', (workspaceId) => getWorkspaceMemberStatistics(workspaceId)],
  ]

  it.each(invalidIdContracts)('rejects every invalid positive integer for %s before fetch', (_label, invoke) => {
    for (const invalidId of INVALID_POSITIVE_INTEGERS) {
      expect(() => invoke(invalidId)).toThrow(BusinessApiError)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid invitation, role and quota input before fetch', () => {
    expect(() => redeemWorkspaceInvitation({ inviteCode: ' \n\t ' })).toThrow(BusinessApiError)
    expect(() => updateWorkspace({ workspaceId: 1, name: '   ' })).toThrow(BusinessApiError)
    expect(() => updateWorkspaceMemberRole({ workspaceId: 1, userId: 2, role: '  ' })).toThrow(BusinessApiError)
    expect(() => updateWorkspaceMemberQuota({ workspaceId: 1, userId: 2, maxTaskCredits: -1 })).toThrow(
      BusinessApiError,
    )
    expect(() =>
      updateWorkspaceMemberQuota({ workspaceId: 1, userId: 2, monthlyCreditLimit: Number.POSITIVE_INFINITY }),
    ).toThrow(BusinessApiError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes once and retries a safe team read after an expired session', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ message: 'expired' }, 401))
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(success([{ id: 21, type: 'team' }]))

    await expect(listWorkspaces()).resolves.toEqual([{ id: 21, type: 'team' }])
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/workspaces',
      '/api/v1/auth/refresh',
      '/api/v1/workspaces',
    ])
  })

  it('surfaces a 401 when session refresh fails without repeatedly replaying the request', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ message: 'expired', code_string: 'UNAUTHORIZED' }, 401))
      .mockResolvedValueOnce(response({ message: 'refresh failed' }, 401))

    await expect(listWorkspaceInvitations(21)).rejects.toMatchObject({
      name: 'BusinessApiError',
      status: 401,
      code: 'UNAUTHORIZED',
    })
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/workspaces/21/invitations',
      '/api/v1/auth/refresh',
    ])
  })

  it.each([
    ['numeric code', { code: 40901, message: 'member already removed' }],
    ['code string', { code_string: 'TEAM_MEMBER_LIMIT', message: 'team full' }],
  ])('rejects a 200 response carrying a %s business error', async (_label, payload) => {
    fetchMock.mockResolvedValueOnce(response(payload))

    await expect(createWorkspaceInvitation({ workspaceId: 21, expiryDays: 7 })).rejects.toMatchObject({
      name: 'BusinessApiError',
      status: 200,
      message: payload.message,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['leave workspace', () => leaveWorkspace({ workspaceId: 31 })],
    ['disband workspace', () => disbandWorkspace({ workspaceId: 31 })],
    ['delete invitation', () => deleteWorkspaceInvitation({ workspaceId: 31, invitationId: 41 })],
    ['remove member', () => removeWorkspaceMember({ workspaceId: 31, userId: 51 })],
    ['transfer ownership', () => transferWorkspaceOwnership({ workspaceId: 31, userId: 52 })],
  ])('does not automatically retry the destructive %s request after a server failure', async (_label, action) => {
    fetchMock.mockResolvedValue(response({ message: 'temporary failure' }, 503))

    await expect(action()).rejects.toMatchObject({ name: 'BusinessApiError', status: 503 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
