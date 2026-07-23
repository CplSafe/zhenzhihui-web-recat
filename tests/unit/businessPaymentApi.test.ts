import {
  cancelSubscription,
  createRechargeOrder,
  createSubscriptionOrder,
  disableSubscriptionAutoRenew,
  listPaymentOrders,
  reconcilePaymentOrder,
} from '@/api/business'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const INVALID_POSITIVE_INTEGERS = [0, -1, Number.NaN, 1.5]

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify({ data: value }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[callIndex]?.[1]?.body || '{}'))
}

describe('business payment API contract', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('omits the existing workspace from a new-team order and preserves its immutable intent fields', async () => {
    await createSubscriptionOrder({
      workspaceId: 21,
      planId: 3,
      intent: 'new_team',
      newWorkspaceName: '  新团队  ',
      idempotencyKey: '  orderabc123  ',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/billing/subscription-orders',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(requestBody(fetchMock)).toEqual({
      plan_id: 3,
      intent: 'new_team',
      new_workspace_name: '新团队',
      idempotency_key: 'orderabc123',
    })
  })

  it.each(['subscribe', 'upgrade'])('locks a %s order to the requested workspace', async (intent) => {
    await createSubscriptionOrder({
      workspaceId: 22,
      planId: 4,
      intent,
      newWorkspaceName: '',
      idempotencyKey: 'stable-key',
    })

    expect(requestBody(fetchMock)).toEqual({
      plan_id: 4,
      intent,
      workspace_id: 22,
      idempotency_key: 'stable-key',
    })
  })

  it('locks a recharge order to the requested workspace and package', async () => {
    await createRechargeOrder({ workspaceId: 23, creditPackageId: 8 })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/billing/recharge-orders',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(requestBody(fetchMock)).toEqual({ workspace_id: 23, credit_package_id: 8 })
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid subscription plan before fetch: %s', (planId) => {
    expect(() => createSubscriptionOrder({ workspaceId: 21, planId, intent: 'subscribe' })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)(
    'rejects an invalid existing workspace for subscription and upgrade orders: %s',
    (workspaceId) => {
      expect(() => createSubscriptionOrder({ workspaceId, planId: 1, intent: 'subscribe' })).toThrow()
      expect(() => createSubscriptionOrder({ workspaceId, planId: 1, intent: 'upgrade' })).toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('does not require an existing workspace for a valid new-team order', async () => {
    await expect(
      createSubscriptionOrder({ workspaceId: 0, planId: 1, intent: 'new_team', newWorkspaceName: '新团队' }),
    ).resolves.toEqual({ ok: true })
    expect(requestBody(fetchMock)).toEqual({ plan_id: 1, intent: 'new_team', new_workspace_name: '新团队' })
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid recharge workspace before fetch: %s', (workspaceId) => {
    expect(() => createRechargeOrder({ workspaceId, creditPackageId: 1 })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid credit package before fetch: %s', (creditPackageId) => {
    expect(() => createRechargeOrder({ workspaceId: 1, creditPackageId })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    { limit: 0, offset: -1, expectedLimit: '20', expectedOffset: '0' },
    { limit: 1, offset: 0, expectedLimit: '1', expectedOffset: '0' },
    { limit: 100, offset: 9, expectedLimit: '100', expectedOffset: '9' },
    { limit: 101, offset: 2.9, expectedLimit: '100', expectedOffset: '2.9' },
  ])('normalizes payment-order pagination: $limit / $offset', async (boundary) => {
    await listPaymentOrders({
      workspaceId: 24,
      type: 'subscription',
      status: 'pending',
      limit: boundary.limit,
      offset: boundary.offset,
    })

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'https://app.example.com')
    expect(url.pathname).toBe('/api/v1/billing/payment-orders')
    expect(url.searchParams.get('workspace_id')).toBe('24')
    expect(url.searchParams.get('limit')).toBe(boundary.expectedLimit)
    expect(url.searchParams.get('offset')).toBe(boundary.expectedOffset)
    expect(url.searchParams.get('type')).toBe('subscription')
    expect(url.searchParams.get('status')).toBe('pending')
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid payment-order workspace before fetch: %s', (workspaceId) => {
    expect(() => listPaymentOrders({ workspaceId })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid reconcile order id before fetch: %s', (orderId) => {
    expect(() => reconcilePaymentOrder({ workspaceId: 1, orderId })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(INVALID_POSITIVE_INTEGERS)('rejects an invalid reconcile workspace before fetch: %s', (workspaceId) => {
    expect(() => reconcilePaymentOrder({ workspaceId, orderId: 1 })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['cancel workspace', cancelSubscription, { workspaceId: 0, subscriptionId: 1 }],
    ['cancel subscription', cancelSubscription, { workspaceId: 1, subscriptionId: 0 }],
    ['disable workspace', disableSubscriptionAutoRenew, { workspaceId: 0, subscriptionId: 1 }],
    ['disable subscription', disableSubscriptionAutoRenew, { workspaceId: 1, subscriptionId: 0 }],
  ] as const)('rejects an invalid %s before fetch', (_label, action, args) => {
    expect(() => action(args)).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([0, -1, Number.NaN, 1.5])('rejects non-integer subscription-management ids: %s', (invalidId) => {
    expect(() => cancelSubscription({ workspaceId: invalidId, subscriptionId: 1 })).toThrow()
    expect(() => cancelSubscription({ workspaceId: 1, subscriptionId: invalidId })).toThrow()
    expect(() => disableSubscriptionAutoRenew({ workspaceId: invalidId, subscriptionId: 1 })).toThrow()
    expect(() => disableSubscriptionAutoRenew({ workspaceId: 1, subscriptionId: invalidId })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts one as the minimum positive payment identifier', async () => {
    await createSubscriptionOrder({ workspaceId: 1, planId: 1, intent: 'subscribe' })
    await createRechargeOrder({ workspaceId: 1, creditPackageId: 1 })
    await listPaymentOrders({ workspaceId: 1 })
    await reconcilePaymentOrder({ workspaceId: 1, orderId: 1 })
    await cancelSubscription({ workspaceId: 1, subscriptionId: 1 })
    await disableSubscriptionAutoRenew({ workspaceId: 1, subscriptionId: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('keeps subscription management requests pinned to the explicit workspace', async () => {
    await cancelSubscription({ workspaceId: 31, subscriptionId: 9 })
    await disableSubscriptionAutoRenew({ workspaceId: 32, subscriptionId: 10 })
    await reconcilePaymentOrder({ workspaceId: 33, orderId: 11 })

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/billing/subscriptions/9/cancel?workspace_id=31',
      '/api/v1/billing/subscriptions/10/disable-auto-renew?workspace_id=32',
      '/api/v1/billing/payment-orders/11/reconcile?workspace_id=33',
    ])
  })
})
