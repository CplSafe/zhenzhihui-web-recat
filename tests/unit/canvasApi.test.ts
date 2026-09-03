import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestBusinessJson: vi.fn() }))

vi.mock('@/api/business', () => ({
  requestBusinessJson: mocks.requestBusinessJson,
  BusinessApiError: class BusinessApiError extends Error {
    status: number
    response: unknown

    constructor(message: string, options: { status?: number; response?: unknown } = {}) {
      super(message)
      this.status = options.status || 0
      this.response = options.response || null
    }
  },
}))

import { fetchAllCanvasElements } from '@/api/canvasApi'

describe('fetchAllCanvasElements', () => {
  beforeEach(() => mocks.requestBusinessJson.mockReset())

  it('reads every cursor page before returning the final revision', async () => {
    mocks.requestBusinessJson
      .mockResolvedValueOnce({
        data: {
          items: [{ element_id: 'node-1', kind: 'node', op: 'upsert' }],
          sync_revision: 12,
          history_floor_revision: 3,
          state: { viewport: 'first-page-only' },
          next_cursor: 'page-2',
          has_more: true,
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ element_id: 'node-2', kind: 'node', op: 'upsert' }],
          sync_revision: 12,
          history_floor_revision: 3,
          has_more: false,
        },
      })

    await expect(fetchAllCanvasElements({ workspaceId: 7, canvasId: 9, afterRevision: 4 })).resolves.toEqual(
      expect.objectContaining({
        elements: [
          expect.objectContaining({ element_id: 'node-1' }),
          expect.objectContaining({ element_id: 'node-2' }),
        ],
        sync_revision: 12,
        state: { viewport: 'first-page-only' },
        has_more: false,
      }),
    )
    expect(mocks.requestBusinessJson).toHaveBeenNthCalledWith(
      2,
      '/api/v1/canvases/9/elements?workspace_id=7&after_revision=4&limit=1000&cursor=page-2',
    )
  })

  it('rejects repeated cursors rather than accepting an incomplete canvas', async () => {
    mocks.requestBusinessJson
      .mockResolvedValueOnce({
        data: { items: [], sync_revision: 20, next_cursor: 'same', has_more: true },
      })
      .mockResolvedValueOnce({
        data: { items: [], sync_revision: 20, next_cursor: 'same', has_more: true },
      })

    await expect(fetchAllCanvasElements({ workspaceId: 7, canvasId: 9 })).rejects.toThrow('画布分页游标异常')
  })
})
