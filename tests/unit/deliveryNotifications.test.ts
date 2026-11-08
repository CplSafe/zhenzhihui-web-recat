import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  loadManualDeliveryNotifications,
  loadPromoDeliveryNotifications,
} from '@/components/layout/deliveryNotifications'
import { server } from '../mocks/server'

describe('人工交付通知', () => {
  it('只显示当前空间中明确标识为 T+1 的任务，并为状态变化生成新消息', async () => {
    let status = 'awaiting_manual'
    server.use(
      http.get('/api/v1/ai/tasks', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('workspace_id')).toBe('21')
        expect(url.searchParams.get('operation_code')).toBe('video.t1')
        return HttpResponse.json({
          code: 0,
          data: {
            items: [
              { id: 1, operation_code: 'video.t1', status },
              { id: 2, operation_code: 'video.generate', status: 'succeeded' },
            ],
            total: 2,
          },
        })
      }),
    )
    const first = await loadManualDeliveryNotifications(21)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ href: '/smart?manualTask=1', title: 'T+1 精制任务 等待制作' })
    status = 'succeeded'
    const next = await loadManualDeliveryNotifications(21)
    expect(next[0].key).not.toBe(first[0].key)
    expect(next[0].title).toBe('T+1 精制任务 已交付')
  })

  it('以订单空间或任务归属过滤 T+5 订单', async () => {
    server.use(
      http.get('/api/v1/promo/orders', () =>
        HttpResponse.json({
          code: 0,
          data: {
            items: [
              { id: 3, workspace_id: 21, status: 'delivered' },
              { id: 4, workspace_id: 22, status: 'delivered' },
              { id: 5, status: 'pending' },
            ],
          },
        }),
      ),
      http.get('/api/v1/ai/tasks', () =>
        HttpResponse.json({ code: 0, data: { items: [{ order_type: 'promo_t5', promo_order_id: 5 }], total: 1 } }),
      ),
    )
    const notices = await loadPromoDeliveryNotifications(21)
    expect(notices.map((item) => item.href)).toEqual(['/promo?order=3', '/promo?order=5'])
  })

  it('识别当前用户和空间中本设备记录的人工任务', async () => {
    localStorage.setItem('zzh.manual.tasks.7.21', JSON.stringify([91]))
    server.use(
      http.get('/api/v1/ai/tasks', () => HttpResponse.json({ code: 0, data: { items: [], total: 0 } })),
      http.get('/api/v1/ai/tasks/91', () =>
        HttpResponse.json({ code: 0, data: { id: 91, operation_code: 'video.generate', status: 'succeeded' } }),
      ),
    )
    expect((await loadManualDeliveryNotifications(21, undefined, 7))[0]).toMatchObject({ href: '/smart?manualTask=91' })
    expect(await loadManualDeliveryNotifications(21, undefined, 8)).toEqual([])
    localStorage.removeItem('zzh.manual.tasks.7.21')
  })

  it('接口失败不会伪装成空消息', async () => {
    server.use(
      http.get('/api/v1/promo/orders', () => HttpResponse.json({ code: 1, message: '无法加载订单' }, { status: 500 })),
    )
    await expect(loadPromoDeliveryNotifications(21)).rejects.toThrow('无法加载订单')
  })
})
