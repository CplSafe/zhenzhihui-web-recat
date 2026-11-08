import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { useDeliveryProjectItems } from '@/composables/useDeliveryProjectItems'
import { server } from '../mocks/server'

describe('项目管理真实交付任务', () => {
  it('分页读取人工任务并隔离工作空间，包含本设备已知的人工任务', async () => {
    localStorage.setItem('zzh.manual.tasks.7.21', JSON.stringify([91]))
    server.use(
      http.get('/api/v1/ai/tasks', ({ request }) => {
        const url = new URL(request.url)
        const ws = Number(url.searchParams.get('workspace_id'))
        if (url.searchParams.get('task_type') === 'promo_t5')
          return HttpResponse.json({
            code: 0,
            data: { items: [{ order_type: 'promo_t5', promo_order_id: ws === 21 ? 31 : 41 }], total: 1 },
          })
        const offset = Number(url.searchParams.get('offset'))
        return HttpResponse.json({
          code: 0,
          data: {
            items: ws === 21 ? [{ id: offset ? 12 : 11, operation_code: 'video.t1', status: 'succeeded' }] : [],
            total: ws === 21 ? 2 : 0,
          },
        })
      }),
      http.get('/api/v1/ai/tasks/91', () =>
        HttpResponse.json({ code: 0, data: { id: 91, operation_code: 'video.generate', status: 'succeeded' } }),
      ),
      http.get('/api/v1/promo/orders', () =>
        HttpResponse.json({
          code: 0,
          data: {
            items: [
              { id: 31, status: 'pending' },
              { id: 41, status: 'pending' },
            ],
            total: 2,
          },
        }),
      ),
    )
    const { result, rerender } = renderHook(({ workspace }) => useDeliveryProjectItems(7, workspace), {
      initialProps: { workspace: 21 },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.manual.map((task) => task.id)).toEqual([11, 12, 91])
    expect(result.current.promo.map((order) => order.id)).toEqual([31])
    rerender({ workspace: 22 })
    expect(result.current.manual).toEqual([])
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.promo.map((order) => order.id)).toEqual([41])
    localStorage.removeItem('zzh.manual.tasks.7.21')
  })

  it('一个接口失败时保留另一类数据并提供重试', async () => {
    let fail = true
    server.use(
      http.get('/api/v1/ai/tasks', () =>
        HttpResponse.json({
          code: 0,
          data: { items: [{ id: 3, operation_code: 'video.t1', status: 'succeeded' }], total: 1 },
        }),
      ),
      http.get('/api/v1/promo/orders', () =>
        fail
          ? HttpResponse.json({ code: 1, message: '暂不可用' }, { status: 503 })
          : HttpResponse.json({ code: 0, data: { items: [], total: 0 } }),
      ),
    )
    const { result } = renderHook(() => useDeliveryProjectItems(7, 21))
    await waitFor(() => expect(result.current.errors).toEqual(['宣传片订单']))
    expect(result.current.manual.map((task) => task.id)).toEqual([3])
    fail = false
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.errors).toEqual([]))
  })
})
