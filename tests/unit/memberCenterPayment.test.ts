import { describe, expect, it } from 'vitest'
import {
  formatPriceCents,
  getMemberCenterPaymentUserScope,
  isSameMemberCenterPaymentScope,
  releaseMemberCenterPayment,
  resolvePurchasedTeamWorkspace,
  stopTrackingMemberCenterOrder,
  tryAcquireMemberCenterPayment,
  tryTrackMemberCenterOrder,
} from '@/utils/memberCenterPayment'

describe('会员中心价格精度', () => {
  it.each([
    [1, '0.01'],
    [100, '1'],
    [79112, '791.12'],
    [undefined, '0'],
  ])('将 %s 分显示为 %s 元', (cents, expected) => {
    expect(formatPriceCents(cents)).toBe(expected)
  })
})

describe('member-center payment concurrency', () => {
  it('allows only one payment entry until the active operation releases its lock', () => {
    const lock = { current: false }

    expect(tryAcquireMemberCenterPayment(lock)).toBe(true)
    expect(tryAcquireMemberCenterPayment(lock)).toBe(false)

    releaseMemberCenterPayment(lock)
    expect(tryAcquireMemberCenterPayment(lock)).toBe(true)
  })

  it('tracks only one polling loop for each order id and permits a new loop after cleanup', () => {
    const activeOrderIds = new Map<number, symbol>()

    const firstToken = tryTrackMemberCenterOrder(activeOrderIds, 91)
    expect(firstToken).toBeTypeOf('symbol')
    expect(tryTrackMemberCenterOrder(activeOrderIds, 91)).toBeNull()
    expect(tryTrackMemberCenterOrder(activeOrderIds, 92)).toBeTypeOf('symbol')

    stopTrackingMemberCenterOrder(activeOrderIds, 91, firstToken!)
    expect(tryTrackMemberCenterOrder(activeOrderIds, 91)).toBeTypeOf('symbol')
  })

  it('does not let a stale polling loop remove a newer watcher for the same order', () => {
    const activeOrders = new Map<number, symbol>()
    const staleToken = tryTrackMemberCenterOrder(activeOrders, 91)!
    activeOrders.clear()
    const currentToken = tryTrackMemberCenterOrder(activeOrders, 91)!

    stopTrackingMemberCenterOrder(activeOrders, 91, staleToken)

    expect(activeOrders.get(91)).toBe(currentToken)
  })

  it('resolves concurrent new-team orders from each order immutable team name', () => {
    const workspaces = [
      { id: 21, type: 'personal', name: '个人空间' },
      { id: 22, type: 'team', name: '甲团队' },
      { id: 23, type: 'team', name: '乙团队' },
    ]
    const baseline = [21]

    expect(
      resolvePurchasedTeamWorkspace(workspaces, {
        orderedTeamName: '甲团队',
        workspaceBaselineIds: baseline,
      })?.id,
    ).toBe(22)
    expect(
      resolvePurchasedTeamWorkspace(workspaces, {
        orderedTeamName: '乙团队',
        workspaceBaselineIds: baseline,
      })?.id,
    ).toBe(23)
  })

  it('prefers the backend workspace id and does not guess from an empty baseline', () => {
    const workspaces = [
      { id: 22, type: 'team', name: '旧团队' },
      { id: 23, type: 'team', name: '新团队' },
    ]

    expect(
      resolvePurchasedTeamWorkspace(workspaces, {
        targetWorkspaceId: 23,
        orderedTeamName: '旧团队',
        workspaceBaselineIds: [22],
      })?.id,
    ).toBe(23)
    expect(resolvePurchasedTeamWorkspace(workspaces, {})).toBeNull()
  })

  it('never resolves an existing same-name team from the pre-order baseline', () => {
    const workspaces = [
      { id: 21, type: 'personal', name: '个人空间' },
      { id: 22, type: 'team', name: '同名团队' },
      { id: 23, type: 'team', name: '同名团队' },
    ]

    expect(
      resolvePurchasedTeamWorkspace(workspaces, {
        orderedTeamName: '同名团队',
        workspaceBaselineIds: [21, 22],
      })?.id,
    ).toBe(23)
  })

  it('rejects a backend target that is personal or already existed before the order', () => {
    expect(
      resolvePurchasedTeamWorkspace(
        [
          { id: 21, type: 'personal', name: '个人空间' },
          { id: 22, type: 'team', name: '旧团队' },
        ],
        { targetWorkspaceId: 22, workspaceBaselineIds: [21, 22] },
      ),
    ).toBeNull()
    expect(
      resolvePurchasedTeamWorkspace(
        [
          { id: 21, type: 'personal', name: '个人空间' },
          { id: 22, type: 'team', name: '旧团队' },
        ],
        { targetWorkspaceId: 21, workspaceBaselineIds: [22] },
      ),
    ).toBeNull()
  })

  it('does not guess when multiple new team workspaces are possible', () => {
    expect(
      resolvePurchasedTeamWorkspace(
        [
          { id: 21, type: 'personal', name: '个人空间' },
          { id: 22, type: 'team', name: '并发团队 A' },
          { id: 23, type: 'team', name: '并发团队 B' },
        ],
        { orderedTeamName: '后端规范化后的其他名称', workspaceBaselineIds: [21] },
      ),
    ).toBeNull()
  })

  it('does not guess when concurrent orders create duplicate new team names', () => {
    expect(
      resolvePurchasedTeamWorkspace(
        [
          { id: 21, type: 'personal', name: '个人空间' },
          { id: 22, type: 'team', name: '同名新团队' },
          { id: 23, type: 'team', name: '同名新团队' },
        ],
        { orderedTeamName: '同名新团队', workspaceBaselineIds: [21] },
      ),
    ).toBeNull()
  })

  it('binds a payment action to the exact authenticated user and workspace', () => {
    const expected = { userId: 'user-7', workspaceId: 21 }

    expect(getMemberCenterPaymentUserScope({ user_id: 'user-7' })).toBe('user-7')
    expect(isSameMemberCenterPaymentScope(expected, { userId: 'user-7', workspaceId: 21 })).toBe(true)
    expect(isSameMemberCenterPaymentScope(expected, { userId: 'user-8', workspaceId: 21 })).toBe(false)
    expect(isSameMemberCenterPaymentScope(expected, { userId: 'user-7', workspaceId: 22 })).toBe(false)
    expect(isSameMemberCenterPaymentScope(expected, { userId: '', workspaceId: 21 })).toBe(false)
  })
})
