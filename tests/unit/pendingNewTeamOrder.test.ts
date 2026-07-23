import { beforeEach, describe, expect, it } from 'vitest'
import {
  bindPendingNewTeamOrder,
  clearPendingNewTeamOrder,
  loadPendingNewTeamOrder,
  loadPendingNewTeamOrders,
  PENDING_NEW_TEAM_ORDER_TTL_MS,
  savePendingNewTeamOrder,
} from '@/utils/pendingNewTeamOrder'

describe('pending new-team subscription intent', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('keeps the same idempotency intent across component remounts without storing a pay URL', () => {
    savePendingNewTeamOrder({
      userId: 'user-7',
      planId: 3,
      teamName: '测试团队',
      idempotencyKey: 'abc123',
      createdAt: 1000,
      workspaceBaselineIds: [21, 21, 22],
      orderId: 99,
      newWorkspaceId: 23,
      status: 'paid',
      updatedAt: 1500,
    })

    expect(loadPendingNewTeamOrder('user-7', 3, 2000)).toEqual({
      userId: 'user-7',
      planId: 3,
      teamName: '测试团队',
      idempotencyKey: 'abc123',
      createdAt: 1000,
      workspaceBaselineIds: [21, 22],
      orderId: 99,
      newWorkspaceId: 23,
      status: 'paid',
      updatedAt: 1500,
    })
    expect(window.localStorage.getItem('zzh.pending-new-team-order.v1.uuser-7.p3')).not.toContain('pay_url')
  })

  it('survives closing a tab and migrates a legacy session entry', () => {
    const key = 'zzh.pending-new-team-order.v1.uuser-7.p3'
    const legacyIntent = {
      userId: 'user-7',
      planId: 3,
      teamName: '待恢复团队',
      idempotencyKey: 'legacy123',
      createdAt: 1000,
      workspaceBaselineIds: [21],
      orderId: 99,
      status: 'paid',
      updatedAt: 1500,
    }
    window.sessionStorage.setItem(key, JSON.stringify(legacyIntent))

    expect(loadPendingNewTeamOrder('user-7', 3, 2000)).toEqual(legacyIntent)
    expect(window.localStorage.getItem(key)).toBe(JSON.stringify(legacyIntent))
    expect(window.sessionStorage.getItem(key)).toBeNull()

    // sessionStorage disappears with the old tab; localStorage recovery stays.
    window.sessionStorage.clear()
    expect(loadPendingNewTeamOrder('user-7', 3, 2000)).toEqual(legacyIntent)
  })

  it('isolates accounts and plans, then expires stale intents', () => {
    savePendingNewTeamOrder({
      userId: 'user-7',
      planId: 3,
      teamName: '测试团队',
      idempotencyKey: 'abc123',
      createdAt: 1000,
      workspaceBaselineIds: [],
    })

    expect(loadPendingNewTeamOrder('user-8', 3, 2000)).toBeNull()
    expect(loadPendingNewTeamOrder('user-7', 4, 2000)).toBeNull()
    expect(loadPendingNewTeamOrder('user-7', 3, 1000 + PENDING_NEW_TEAM_ORDER_TTL_MS)).toBeNull()
  })

  it('clears a terminal order explicitly', () => {
    savePendingNewTeamOrder({
      userId: 'user-7',
      planId: 3,
      teamName: '测试团队',
      idempotencyKey: 'abc123',
      createdAt: 1000,
      workspaceBaselineIds: [],
    })

    clearPendingNewTeamOrder('user-7', 3)

    expect(loadPendingNewTeamOrder('user-7', 3, 2000)).toBeNull()
  })

  it('loads all recoverable orders for one account and keeps a recently paid order alive', () => {
    savePendingNewTeamOrder({
      userId: 'user-7',
      planId: 3,
      teamName: '团队 A',
      idempotencyKey: 'abc123',
      createdAt: 1000,
      workspaceBaselineIds: [21],
      orderId: 91,
      status: 'pending',
    })
    savePendingNewTeamOrder({
      userId: 'user-7',
      planId: 4,
      teamName: '团队 B',
      idempotencyKey: 'def456',
      createdAt: 1000,
      updatedAt: 1000 + PENDING_NEW_TEAM_ORDER_TTL_MS - 100,
      workspaceBaselineIds: [21, 22],
      orderId: 92,
      status: 'paid',
    })
    savePendingNewTeamOrder({
      userId: 'user-8',
      planId: 3,
      teamName: '其他账号团队',
      idempotencyKey: 'ghi789',
      createdAt: 1000,
      workspaceBaselineIds: [],
    })

    expect(loadPendingNewTeamOrders('user-7', 1000 + PENDING_NEW_TEAM_ORDER_TTL_MS)).toEqual([
      expect.objectContaining({ planId: 4, orderId: 92, status: 'paid' }),
    ])
  })

  it('keeps the response order id when the polling intent later becomes paid', () => {
    const intent = {
      userId: 'user-7',
      planId: 8,
      teamName: '新团队',
      idempotencyKey: 'stablekey',
      createdAt: 1000,
      workspaceBaselineIds: [1],
      status: 'pending' as const,
    }

    const tracked = bindPendingNewTeamOrder(intent, 101, 202, 1100)
    expect(tracked).toEqual({
      ...intent,
      orderId: 101,
      newWorkspaceId: 202,
      updatedAt: 1100,
    })

    savePendingNewTeamOrder({ ...tracked!, status: 'paid', updatedAt: 1200 })
    expect(loadPendingNewTeamOrder('user-7', 8, 1300)).toEqual(
      expect.objectContaining({ orderId: 101, newWorkspaceId: 202, status: 'paid' }),
    )
  })
})
