import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createManualVideoTask,
  getManualVideoOperation,
  manualVideoPollDelay,
  reviseManualVideoTask,
} from '@/api/manualVideo'
import { canRefundPromoOrder, createPromoOrder, uploadPromoFile, type PromoOrder } from '@/api/promo'
import { requestBusinessJson } from '@/api/business'

vi.mock('@/api/business', () => ({ requestBusinessJson: vi.fn() }))

describe('人工视频与宣传片契约', () => {
  beforeEach(() => vi.mocked(requestBusinessJson).mockReset())

  it('仅识别 video.t1 模型或操作，并使用模型声明的操作码', () => {
    expect(getManualVideoOperation({ id: 1, model: 'video.t1', operation_codes: ['video.generate'] })).toBe(
      'video.generate',
    )
    expect(getManualVideoOperation({ id: 2, operation_codes: ['video.t1'] })).toBe('video.t1')
    expect(getManualVideoOperation({ id: 3, provider: 'manual-video', operation_codes: ['video.generate'] })).toBeNull()
    expect(getManualVideoOperation({ id: 4, model: 'video.t1', operation_codes: [] })).toBeNull()
    expect(getManualVideoOperation({ id: 5, enabled: false, operation_codes: ['video.t1'] })).toBeNull()
  })

  it('人工视频重试保留调用方幂等键和请求正文，修改使用独立接口', async () => {
    const input = {
      workspace_id: 1,
      model_version_id: 2,
      operation_code: 'video.generate',
      idempotency_key: 'same-key',
      prompt: '制作视频',
      params: { duration: 30 },
      input_assets: [],
    }
    await createManualVideoTask(input)
    await createManualVideoTask(input)
    const calls = vi.mocked(requestBusinessJson).mock.calls
    expect(calls[0][0]).toBe('/api/v1/ai/tasks')
    expect(calls[0][1]?.body).toEqual(calls[1][1]?.body)
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual(input)
    await reviseManualVideoTask(4, { workspace_id: 1, idempotency_key: 'revision-key', instruction: '修改片尾' })
    expect(vi.mocked(requestBusinessJson).mock.calls[2][0]).toBe('/api/v1/ai/tasks/4/revisions')
    expect(JSON.parse(String(vi.mocked(requestBusinessJson).mock.calls[2][1]?.body))).toEqual({
      workspace_id: 1,
      idempotency_key: 'revision-key',
      instruction: '修改片尾',
    })
  })

  it('人工任务在终态或后端要求停止时不再轮询', () => {
    expect(manualVideoPollDelay({ id: 1, status: 'manual_processing', poll_after_ms: 15000 })).toBe(15000)
    expect(manualVideoPollDelay({ id: 1, status: 'manual_processing', poll_after_ms: 0 })).toBeNull()
    expect(manualVideoPollDelay({ id: 1, status: 'succeeded', poll_after_ms: 15000 })).toBeNull()
  })

  it('宣传片退款同时要求逾期、未首次交付和积分冻结', () => {
    const order: PromoOrder = {
      id: 1,
      task_id: 2,
      status: 'overdue',
      billing_status: 'frozen',
      is_overdue: true,
      first_delivered_at: null,
      can_rework: false,
    }
    expect(canRefundPromoOrder(order)).toBe(true)
    expect(canRefundPromoOrder({ ...order, is_overdue: false })).toBe(false)
    expect(canRefundPromoOrder({ ...order, first_delivered_at: '2026-11-01' })).toBe(false)
    expect(canRefundPromoOrder({ ...order, billing_status: 'settled' })).toBe(false)
  })

  it('宣传片下单使用订单接口并原样保留幂等请求', async () => {
    const input = {
      intake_token: 'token',
      duration_seconds: 180,
      ratio: '16:9',
      resolution: '1080P',
      idempotency_key: 'order-key',
      config_hash: 'hash',
      company: '公司',
      contact: '联系人',
      phone: '123',
      scenario: 'product_launch' as const,
      narration: 'both' as const,
      brief: '需求',
      reference_url: '',
      authorized: true,
      acknowledged: true,
      authorization_version: 'v1',
    }
    await createPromoOrder(input)
    expect(vi.mocked(requestBusinessJson).mock.calls[0][0]).toBe('/api/v1/promo/orders')
    expect(JSON.parse(String(vi.mocked(requestBusinessJson).mock.calls[0][1]?.body))).toEqual(input)
  })

  it('对象存储直传不附带业务凭证且不跟随跳转', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const file = new File(['image'], 'image.png', { type: 'image/png' })
    await uploadPromoFile(
      {
        material: { id: 1, status: 'pending' },
        url: 'https://bucket.aliyuncs.com/upload',
        form_fields: { key: 'value' },
        expires_at: '',
      },
      file,
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://bucket.aliyuncs.com/upload')
    expect(init?.credentials).toBe('omit')
    expect(init?.redirect).toBe('error')
    expect((init?.body as FormData).get('key')).toBe('value')
    expect((init?.body as FormData).get('file')).toBe(file)
  })
})
