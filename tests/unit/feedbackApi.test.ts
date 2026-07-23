import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { listFeedbackTypes, listMyFeedback, submitFeedback } from '@/api/feedback'
import { server } from '../mocks/server'

describe('feedback API', () => {
  it('filters and sorts enabled feedback types', async () => {
    server.use(
      http.get('/api/v1/feedback-types', () =>
        HttpResponse.json({
          data: [
            { id: 3, name: ' 体验问题 ', position: 20 },
            { id: 2, name: '功能问题', position: 10 },
            { id: 1, name: '已停用', enabled: false, position: 1 },
            { id: 0, name: '无效', position: 2 },
            { id: 4, name: '   ', position: 3 },
          ],
        }),
      ),
    )

    await expect(listFeedbackTypes()).resolves.toEqual([
      { id: 2, name: '功能问题', position: 10 },
      { id: 3, name: '体验问题', position: 20 },
    ])
  })

  it.each([503, 200])('returns an empty type list for HTTP/JSON failure (%s)', async (status) => {
    server.use(
      http.get('/api/v1/feedback-types', () =>
        status === 200
          ? new HttpResponse('bad-json', { headers: { 'Content-Type': 'application/json' } })
          : new HttpResponse(null, { status }),
      ),
    )
    await expect(listFeedbackTypes()).resolves.toEqual([])
  })

  it('submits the normalized feedback body once', async () => {
    let submittedBody: unknown
    server.use(
      http.post('/api/v1/feedback', async ({ request }) => {
        submittedBody = await request.json()
        return HttpResponse.json({ code: 0, data: { id: 9 } })
      }),
    )

    await expect(
      submitFeedback({ feedbackType: 7, content: '页面卡顿', contact: 'user@example.com', assetIds: [1, 0, 2] }),
    ).resolves.toBeUndefined()
    expect(submittedBody).toEqual({
      feedback_type: 7,
      content: '页面卡顿',
      contact: 'user@example.com',
      asset_ids: [1, 2],
    })
  })

  it.each([
    ['HTTP error', new HttpResponse(null, { status: 500 }), '提交失败 (500)'],
    ['business error', HttpResponse.json({ code: 1001, message: '提交频繁' }), '提交频繁'],
  ])('rejects a %s', async (_name, response, message) => {
    server.use(http.post('/api/v1/feedback', () => response))
    await expect(submitFeedback({ feedbackType: 1, content: '反馈内容' })).rejects.toThrow(message)
  })

  it('maps envelope pagination and sanitizes attachment ids', async () => {
    let query = ''
    server.use(
      http.get('/api/v1/feedback', ({ request }) => {
        query = new URL(request.url).search
        return HttpResponse.json({
          data: {
            items: [
              {
                id: '8',
                feedback_type: '3',
                content: '内容',
                contact: '13800000000',
                status: 'processing',
                created_at: '2026-07-21T00:00:00Z',
                asset_ids_json: ['4', 0, 5],
              },
            ],
          },
        })
      }),
    )

    await expect(listMyFeedback({ limit: 5, offset: 10 })).resolves.toEqual([
      {
        id: 8,
        feedbackType: 3,
        content: '内容',
        contact: '13800000000',
        status: 'processing',
        createdAt: '2026-07-21T00:00:00Z',
        assetIds: [4, 5],
      },
    ])
    expect(query).toBe('?limit=5&offset=10')
  })

  it('returns an empty history for network, HTTP, and malformed payload failures', async () => {
    server.use(http.get('/api/v1/feedback', () => HttpResponse.error()))
    await expect(listMyFeedback()).resolves.toEqual([])

    server.use(http.get('/api/v1/feedback', () => new HttpResponse(null, { status: 401 })))
    await expect(listMyFeedback()).resolves.toEqual([])

    server.use(http.get('/api/v1/feedback', () => HttpResponse.json({ data: null })))
    await expect(listMyFeedback()).resolves.toEqual([])
  })
})
