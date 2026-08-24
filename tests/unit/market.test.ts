import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  acceptDemandApplication,
  applicationStatusLabel,
  applyToDemand,
  cancelMarketDemand,
  completeMarketDemand,
  createMarketDemand,
  demandStatusLabel,
  encodeDemandDescription,
  formatDemandDate,
  formatDemandPrice,
  getMarketDemand,
  isDemandApplyDeadlinePassed,
  listDemandApplications,
  listMarketDemands,
  listMyApplications,
  listMyDemands,
  normalizeDemandApplication,
  normalizeMarketDemand,
  publishMarketDemand,
  rejectDemandApplication,
  splitDemandDescription,
  withdrawDemandApplication,
  type DemandExtras,
} from '@/api/market'
import { server } from '../mocks/server'

const EXTRAS: DemandExtras = {
  duration: '30S',
  ratio: '9:16',
  quantity: 10,
  applyDeadline: '2026/08/25',
  deliveryDeadline: '2026/08/30',
  materials: [{ name: '素材1.jpg', url: 'https://cdn.example.com/a.jpg', assetId: 7 }, { name: '脚本参考.docx' }],
  targetIpId: 42,
  targetIpName: '小鹿酱',
}

describe('demand description 元数据块', () => {
  it('编码后可无损拆回纯文本与扩展字段', () => {
    const encoded = encodeDemandDescription('围绕国庆聚会场景，突出产品特点。', EXTRAS)
    const { text, extras } = splitDemandDescription(encoded)
    expect(text).toBe('围绕国庆聚会场景，突出产品特点。')
    expect(extras).toEqual(EXTRAS)
  })

  it('没有扩展字段时不追加元数据块', () => {
    expect(encodeDemandDescription('  纯文本  ', {})).toBe('纯文本')
    expect(encodeDemandDescription('a', { materials: [] })).toBe('a')
  })

  it('无元数据块或元数据损坏时按纯文本处理', () => {
    expect(splitDemandDescription('普通描述')).toEqual({ text: '普通描述', extras: {} })
    expect(splitDemandDescription(undefined)).toEqual({ text: '', extras: {} })
    const broken = `正文\n\n[ZZH-DEMAND-META]{not-json`
    expect(splitDemandDescription(broken)).toEqual({ text: broken.trim(), extras: {} })
  })

  it('丢弃元数据里的非法字段值', () => {
    const encoded = encodeDemandDescription('t', {
      quantity: -3,
      materials: [{ name: '' }, { name: 'ok.png' }],
    } as DemandExtras)
    const { extras } = splitDemandDescription(encoded)
    expect(extras.quantity).toBeUndefined()
    expect(extras.materials).toEqual([{ name: 'ok.png' }])
  })
})

describe('normalize', () => {
  it('归一化需求字段并拆出元数据', () => {
    const demand = normalizeMarketDemand({
      id: 9,
      title: '王老吉国庆宣传视频',
      description: encodeDemandDescription('内容概述', EXTRAS),
      status: 'open',
      budget_cents: 20000,
      budget_type: 'fixed',
      currency: 'CNY',
      category: 'video',
      publisher: { id: 3, nickname: 'Joy的桥', avatar_url: 'https://cdn.example.com/j.png' },
      assignee: null,
      created_at: '2026-08-01T00:00:00Z',
    })
    expect(demand.id).toBe(9)
    expect(demand.description).toBe('内容概述')
    expect(demand.extras.quantity).toBe(10)
    expect(demand.publisher.nickname).toBe('Joy的桥')
    expect(demand.assignee).toBeNull()
    expect(demand.deliveryDeadline).toBe('2026/08/30')
  })

  it('空对象也能得到安全默认值', () => {
    const demand = normalizeMarketDemand(null)
    expect(demand.id).toBe(0)
    expect(demand.title).toBe('未命名需求')
    expect(demand.status).toBe('draft')
    const application = normalizeDemandApplication({ id: 5, demand: { id: 9, title: 't' } })
    expect(application.demandId).toBe(9)
    expect(application.demand?.title).toBe('t')
  })
})

describe('展示格式化', () => {
  it('formatDemandPrice 覆盖固定价/面议/免费', () => {
    expect(formatDemandPrice({ budgetCents: 20000, budgetType: 'fixed' })).toBe('200元')
    expect(formatDemandPrice({ budgetCents: 12345, budgetType: 'fixed' })).toBe('123.45元')
    expect(formatDemandPrice({ budgetCents: 0, budgetType: 'negotiable' })).toBe('面议')
    expect(formatDemandPrice({ budgetCents: 0, budgetType: 'unpaid' })).toBe('免费')
  })

  it('formatDemandDate 兼容 ISO、已格式化与非法值', () => {
    expect(formatDemandDate('2026-08-25T08:00:00Z')).toMatch(/^2026\/8\/25$/)
    expect(formatDemandDate('2026/8/25')).toBe('2026/8/25')
    expect(formatDemandDate('')).toBe('')
    expect(formatDemandDate('not-a-date')).toBe('not-a-date')
  })

  it('isDemandApplyDeadlinePassed 截止日当天仍可报名，次日起截止', () => {
    const noon = (day: string) => new Date(`${day}T12:00:00`).getTime()
    expect(isDemandApplyDeadlinePassed('2026/08/25', noon('2026-08-25'))).toBe(false)
    expect(isDemandApplyDeadlinePassed('2026/08/25', noon('2026-08-26'))).toBe(true)
    expect(isDemandApplyDeadlinePassed('2026/08/25', noon('2026-08-24'))).toBe(false)
    expect(isDemandApplyDeadlinePassed('', noon('2026-08-26'))).toBe(false)
    expect(isDemandApplyDeadlinePassed(undefined, noon('2026-08-26'))).toBe(false)
    expect(isDemandApplyDeadlinePassed('not-a-date', noon('2026-08-26'))).toBe(false)
  })

  it('状态文案映射', () => {
    expect(demandStatusLabel('in_progress')).toBe('制作中')
    expect(demandStatusLabel('unknown-x')).toBe('unknown-x')
    expect(applicationStatusLabel('pending')).toBe('待处理')
  })
})

describe('请求封装', () => {
  it('listMarketDemands 透传筛选参数并过滤非法条目', async () => {
    let seenParams: URLSearchParams | null = null
    server.use(
      http.get('/api/v1/market/demands', ({ request }) => {
        seenParams = new URL(request.url).searchParams
        return HttpResponse.json({
          code: 0,
          data: { items: [{ id: 1, title: 'A' }, { title: '无 id 被过滤' }], total: 2 },
        })
      }),
    )
    const page = await listMarketDemands({ query: ' 王老吉 ', status: 'open', userId: 3, limit: 500 })
    expect(seenParams!.get('q')).toBe('王老吉')
    expect(seenParams!.get('status')).toBe('open')
    expect(seenParams!.get('user_id')).toBe('3')
    expect(seenParams!.get('limit')).toBe('100')
    expect(page.items).toHaveLength(1)
    expect(page.total).toBe(2)
  })

  it('createMarketDemand 提交定价与元数据；400 时去掉 delivery_deadline 重试', async () => {
    const bodies: any[] = []
    server.use(
      http.post('/api/v1/market/demands', async ({ request }) => {
        const body = await request.json()
        bodies.push(body)
        if (bodies.length === 1) {
          return HttpResponse.json({ code: 1, message: 'bad delivery_deadline' }, { status: 400 })
        }
        return HttpResponse.json({ code: 0, data: { id: 77, ...(body as object) } }, { status: 201 })
      }),
    )
    const demand = await createMarketDemand({
      title: '需求',
      description: '描述',
      pricePerItemYuan: 200,
      extras: { deliveryDeadline: '2026/08/30', quantity: 10 },
    })
    expect(bodies).toHaveLength(2)
    expect(bodies[0].budget_cents).toBe(20000)
    expect(bodies[0].budget_type).toBe('fixed')
    expect(bodies[0].delivery_deadline).toBeTruthy()
    expect(bodies[1].delivery_deadline).toBeUndefined()
    expect(demand.id).toBe(77)
    // 交付时间仍留在元数据里，展示不受降级影响
    expect(demand.extras.deliveryDeadline).toBe('2026/08/30')
  })

  it('createMarketDemand 无定价时按面议提交', async () => {
    server.use(
      http.post('/api/v1/market/demands', async ({ request }) => {
        const body: any = await request.json()
        expect(body.budget_type).toBe('negotiable')
        expect(body.budget_cents).toBe(0)
        return HttpResponse.json({ code: 0, data: { id: 78 } }, { status: 201 })
      }),
    )
    const demand = await createMarketDemand({ title: 't', description: '', pricePerItemYuan: 0, extras: {} })
    expect(demand.id).toBe(78)
  })

  it('需求生命周期动作命中对应端点', async () => {
    const hits: string[] = []
    const record =
      (name: string) =>
      ({ params }: { params: Record<string, unknown> }) => {
        hits.push(`${name}:${params.id ?? ''}`)
        return HttpResponse.json({ code: 0, data: { id: Number(params.id ?? 0) || 9, status: 'open' } })
      }
    server.use(
      http.get('/api/v1/market/demands/:id', record('get')),
      http.post('/api/v1/market/demands/:id/publish', record('publish')),
      http.post('/api/v1/market/demands/:id/cancel', record('cancel')),
      http.post('/api/v1/market/demands/:id/complete', record('complete')),
      http.post('/api/v1/market/applications/:id/accept', record('accept')),
      http.post('/api/v1/market/applications/:id/reject', record('reject')),
      http.post('/api/v1/market/applications/:id/withdraw', record('withdraw')),
    )
    await getMarketDemand(9)
    await publishMarketDemand(9)
    await cancelMarketDemand(9)
    await completeMarketDemand(9)
    await acceptDemandApplication(5)
    await rejectDemandApplication(5)
    await withdrawDemandApplication(5)
    expect(hits).toEqual(['get:9', 'publish:9', 'cancel:9', 'complete:9', 'accept:5', 'reject:5', 'withdraw:5'])
  })

  it('applyToDemand 将报价转成分并取整天数', async () => {
    server.use(
      http.post('/api/v1/market/demands/:id/applications', async ({ request }) => {
        const body: any = await request.json()
        expect(body.quote_cents).toBe(15050)
        expect(body.estimated_days).toBe(3)
        expect(body.message).toBe('可以三天交付')
        return HttpResponse.json({ code: 0, data: { id: 11, demand_id: 9, status: 'pending' } }, { status: 201 })
      }),
    )
    const application = await applyToDemand(9, { message: ' 可以三天交付 ', quoteYuan: 150.5, estimatedDays: 3.7 })
    expect(application.id).toBe(11)
    expect(application.status).toBe('pending')
  })

  it('我的需求 / 我的申请 / 需求申请列表返回归一化分页', async () => {
    server.use(
      http.get('/api/v1/market/me/demands', () =>
        HttpResponse.json({ code: 0, data: { items: [{ id: 1, title: 'A', status: 'completed' }], total: 1 } }),
      ),
      http.get('/api/v1/market/me/applications', () =>
        HttpResponse.json({ code: 0, data: { items: [{ id: 2, demand_id: 1, status: 'accepted' }], total: 1 } }),
      ),
      http.get('/api/v1/market/demands/:id/applications', () =>
        HttpResponse.json({ code: 0, data: { items: [{ id: 3, demand_id: 1, status: 'pending' }], total: 1 } }),
      ),
    )
    const demands = await listMyDemands()
    expect(demands.items[0].status).toBe('completed')
    const applications = await listMyApplications()
    expect(applications.items[0].status).toBe('accepted')
    const demandApplications = await listDemandApplications(1)
    expect(demandApplications.items[0].status).toBe('pending')
  })

  it('业务错误码抛出后端 message', async () => {
    server.use(http.get('/api/v1/market/demands/:id', () => HttpResponse.json({ code: 40004, message: '需求不存在' })))
    await expect(getMarketDemand(404)).rejects.toThrow('需求不存在')
  })
})
