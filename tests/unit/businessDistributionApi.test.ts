import {
  createDistributionWithdrawal,
  createDistributionWithdrawalMethod,
  deleteDistributionWithdrawalMethod,
  exportDistributionCommissions,
  listDistributionWithdrawalMethods,
  listDistributionWithdrawals,
} from '@/api/business'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify({ data: value }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[callIndex]?.[1]?.body || '{}'))
}

describe('business distribution withdrawal API contract', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists withdrawal methods and withdrawal records with the documented query', async () => {
    await listDistributionWithdrawalMethods()
    await listDistributionWithdrawals({ status: 'pending', limit: 20, offset: 0 })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/distribution/withdrawal-methods')
    const url = new URL(String(fetchMock.mock.calls[1]?.[0]), 'https://app.example.com')
    expect(url.pathname).toBe('/api/v1/distribution/withdrawals')
    expect(url.searchParams.get('status')).toBe('pending')
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('offset')).toBe('0')
  })

  it('exports the backend XLSX file with supported filters and response filename', async () => {
    const fileBytes = new Uint8Array([80, 75, 3, 4])
    fetchMock.mockResolvedValueOnce(
      new Response(fileBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition':
            "attachment; filename*=UTF-8''%E9%82%80%E8%AF%B7%E6%94%B6%E7%9B%8A%E6%98%8E%E7%BB%86.xlsx",
        },
      }),
    )

    const exported = await exportDistributionCommissions({
      kind: 'customer',
      level: 2,
      orderType: 'credits_recharge',
    })

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'https://app.example.com')
    expect(url.pathname).toBe('/api/v1/distribution/commissions/export')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: 'customer',
      level: '2',
      order_type: 'credits_recharge',
    })
    expect(exported.fileName).toBe('邀请收益明细.xlsx')
    expect(exported.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(Array.from(new Uint8Array(await exported.blob.arrayBuffer()))).toEqual(Array.from(fileBytes))
  })

  it('creates and deletes a bank-card withdrawal method', async () => {
    await createDistributionWithdrawalMethod({
      methodType: 'bank_card',
      accountName: '张三',
      accountNumber: '6222000012345678',
      bankName: '招商银行',
      isDefault: true,
    })
    await deleteDistributionWithdrawalMethod({ id: 9 })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/distribution/withdrawal-methods')
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'POST' }))
    expect(requestBody(fetchMock)).toEqual({
      method_type: 'bank_card',
      account_name: '张三',
      account_number: '6222000012345678',
      bank_name: '招商银行',
      is_default: true,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/distribution/withdrawal-methods/9',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('submits cents and the caller-provided idempotency key', async () => {
    await createDistributionWithdrawal({
      methodId: 7,
      amountCents: 5000,
      idempotencyKey: 'withdrawal-stable-key',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/distribution/withdrawals',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Idempotency-Key': 'withdrawal-stable-key',
        }),
      }),
    )
    expect(requestBody(fetchMock)).toEqual({ method_id: 7, amount_cents: 5000 })
  })

  it('rejects invalid withdrawal inputs before sending a request', () => {
    expect(() =>
      createDistributionWithdrawalMethod({
        methodType: 'alipay',
        accountName: '张三',
        accountNumber: 'test@example.com',
      }),
    ).toThrow('当前仅支持银行卡提现')
    expect(() =>
      createDistributionWithdrawal({
        methodId: 1,
        amountCents: 5000,
        idempotencyKey: '',
      }),
    ).toThrow('Idempotency-Key')
    expect(() =>
      createDistributionWithdrawalMethod({
        methodType: 'bank_card',
        accountName: '张三',
        accountNumber: '6222000012345678',
      }),
    ).toThrow('开户银行')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
