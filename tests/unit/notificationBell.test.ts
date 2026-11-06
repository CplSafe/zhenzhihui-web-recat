import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { loadNotifications, loadScriptApprovalNotifications } from '@/components/layout/NotificationBell'
import { server } from '../mocks/server'

describe('loadNotifications 通知推导', () => {
  it('汇总「收到申请 / 需求完成 / 被接单 / 申请被接受或拒绝」，按时间倒序', async () => {
    server.use(
      http.get('/api/v1/market/me/demands', () =>
        HttpResponse.json({
          code: 0,
          data: {
            items: [
              // open：其待处理申请会生成「收到接单申请」
              { id: 9, title: '国庆宣传视频', status: 'open', published_at: '2026-08-20T00:00:00Z' },
              // completed：「需求已完成」
              {
                id: 8,
                title: '产品短片',
                status: 'completed',
                published_at: '2026-08-01T00:00:00Z',
                completed_at: '2026-08-22T00:00:00Z',
              },
              // in_progress + assignee：「正在制作中」
              {
                id: 7,
                title: '开屏动画',
                status: 'in_progress',
                published_at: '2026-08-10T00:00:00Z',
                assignee: { id: 4, nickname: '小王' },
              },
            ],
            total: 3,
          },
        }),
      ),
      http.get('/api/v1/market/demands/9/applications', () =>
        HttpResponse.json({
          code: 0,
          data: {
            items: [
              {
                id: 21,
                demand_id: 9,
                status: 'pending',
                applicant: { id: 4, nickname: '小王' },
                created_at: '2026-08-24T00:00:00Z',
              },
              // 非 pending 的不产生「收到申请」
              {
                id: 22,
                demand_id: 9,
                status: 'rejected',
                applicant: { id: 5, nickname: '小李' },
                created_at: '2026-08-23T00:00:00Z',
              },
            ],
            total: 2,
          },
        }),
      ),
      http.get('/api/v1/market/me/applications', () =>
        HttpResponse.json({
          code: 0,
          data: {
            items: [
              {
                id: 31,
                demand_id: 100,
                demand: { id: 100, title: '别人的需求' },
                status: 'accepted',
                responded_at: '2026-08-21T00:00:00Z',
              },
            ],
            total: 1,
          },
        }),
      ),
    )
    const items = await loadNotifications()
    expect(items.map((item) => item.key)).toEqual([
      'app-received-21', // 08-24 收到申请
      'demand-completed-8', // 08-22 已完成
      'app-accepted-31', // 08-21 申请被接受
      'demand-progress-7', // 08-10 被接单
    ])
    expect(items[0].text).toContain('收到 小王 的接单申请')
    expect(items[0].text).toContain('国庆宣传视频')
    expect(items[0]).toMatchObject({ title: '收到新的接单申请', href: '/demand/9', tone: 'info' })
    expect(items[1].text).toContain('已完成')
    expect(items[2].text).toContain('已被接受')
  })

  it('接口失败时明确失败，不把未拉到数据伪装成暂无通知', async () => {
    server.use(
      http.get('/api/v1/market/me/demands', () => HttpResponse.json({ code: 1, message: 'boom' }, { status: 500 })),
      http.get('/api/v1/market/me/applications', () => HttpResponse.json({ code: 1 }, { status: 500 })),
    )
    await expect(loadNotifications()).rejects.toThrow()
  })
})

describe('剧本审核通过通知', () => {
  it('后端重复返回同一分页时停止，避免无休止加载', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/student-applications', () => {
        calls++
        return HttpResponse.json({ code: 0, data: { items: [{ id: 1 }], total: 100 } })
      }),
    )
    await expect(loadScriptApprovalNotifications()).rejects.toThrow('分页未向前推进')
    expect(calls).toBe(2)
  })
  it('读取各页并只生成真实通过记录，包含备注、阶段和秒级时间', async () => {
    server.use(
      http.get('/api/v1/student-applications', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset'))
        return HttpResponse.json({ code: 0, data: { items: offset === 0 ? [{ id: 1 }] : [{ id: 2 }], total: 2 } })
      }),
      http.get('/api/v1/student-applications/:id', ({ params }) =>
        HttpResponse.json({
          code: 0,
          data: {
            application: { id: Number(params.id), title: `作品${params.id}` },
            progress_available: true,
            workflow: {
              reviews:
                params.id === '1'
                  ? [
                      {
                        status: 2,
                        version: 1,
                        stage: 'creative',
                        task_id: 't1',
                        reason: '修改开头',
                        finished_at: 1700000000,
                      },
                      { status: 3, version: 2, stage: 'card', reason: '未通过', finished_at: 1700000010 },
                    ]
                  : [{ status: 2, version: 2, stage: 'script', task_id: 't2', finished_at: 1700000020 }],
            },
          },
        }),
      ),
    )
    const notices = await loadScriptApprovalNotifications()
    expect(notices).toHaveLength(2)
    expect(notices[0]).toMatchObject({ href: '/script-ideas/1', ts: 1700000000000 })
    expect(notices[0].text).toContain('审核备注：修改开头')
    expect(notices[1].text).toContain('暂无审核备注')
  })
})
