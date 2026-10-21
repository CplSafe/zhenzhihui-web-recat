import { beforeEach, describe, expect, it, vi } from 'vitest'
const request = vi.hoisted(() => vi.fn())
vi.mock('@/api/business', () => ({ requestBusinessJson: request }))
import { cancelHdTask, hdServiceError, listHdTasks, preflightHd, quoteHd, submitHd } from '@/api/canvasHd'

beforeEach(() => request.mockReset())
describe('canvas HD API contract', () => {
  it('sends preflight snapshots and quote parameters without adding prices or invented model codes', async () => {
    request.mockResolvedValue({ data: { items: [] } })
    const sources = [{ node_id: 'n1', asset_id: 10, kind: 'video' as const, name: '镜头' }]
    const signal = new AbortController().signal
    expect(await preflightHd(21, 3, sources, signal)).toEqual({ items: [] })
    expect(request).toHaveBeenLastCalledWith(
      '/api/v1/ai/hd/preflight',
      expect.objectContaining({
        method: 'POST',
        signal,
        body: JSON.stringify({ workspace_id: 21, canvas_id: 3, sources }),
      }),
    )
    const target = { resolution: '1080P', fps: 0 }
    await quoteHd(21, 3, sources, target)
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ workspace_id: 21, canvas_id: 3, sources, target })
  })
  it('submits a server quote atomically and passes the exact caller idempotency key', async () => {
    request.mockResolvedValue({ tasks: [] })
    await submitHd(21, 3, 'quote-1', 'same-key')
    expect(request).toHaveBeenCalledWith(
      '/api/v1/ai/hd/batches',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspace_id: 21, canvas_id: 3, quote_id: 'quote-1', idempotency_key: 'same-key' }),
      }),
    )
    await cancelHdTask(21, 'HD/a')
    expect(request).toHaveBeenLastCalledWith(
      '/api/v1/ai/hd/tasks/HD%2Fa/cancel',
      expect.objectContaining({ method: 'POST', body: '{"workspace_id":21}' }),
    )
  })
  it('uses server paging, workspace and filters and omits empty filters', async () => {
    request.mockResolvedValue({ items: [], total: 0 })
    await listHdTasks(21)
    expect(request.mock.calls[0][0]).toBe('/api/v1/ai/hd/tasks?workspace_id=21&limit=50&offset=0')
    await listHdTasks(21, { page: 3, status: 'failed', kind: 'video', canvas_id: 3, keyword: 'HD 1' })
    const url = new URL(request.mock.calls[1][0], 'http://localhost')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      workspace_id: '21',
      limit: '50',
      offset: '100',
      status: 'failed',
      kind: 'video',
      canvas_id: '3',
      keyword: 'HD 1',
    })
  })
  it('rejects empty responses and reports an undeployed service distinctly', async () => {
    request.mockResolvedValue(null)
    await expect(listHdTasks(21)).rejects.toThrow('数据不完整')
    expect(hdServiceError({ status: 404 })).toContain('暂未接入')
    expect(hdServiceError({ status: 501 })).toContain('暂未接入')
    expect(hdServiceError(new Error('余额不足'))).toBe('余额不足')
    expect(hdServiceError(null)).toContain('请求失败')
  })
})
