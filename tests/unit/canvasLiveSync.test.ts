import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPermanentCanvasSaveError, fetchAllCanvasElements, subscribeCanvasEvents } from '@/api/canvasApi'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/api/business', () => ({ requestBusinessJson: request, BusinessApiError: Error }))

afterEach(() => {
  vi.unstubAllGlobals()
  request.mockReset()
})

describe('live canvas synchronization', () => {
  it('retries unchanged drafts after a temporary Agent lock and keeps terminal rejections blocked', () => {
    expect(isPermanentCanvasSaveError(423, 'CANVAS_AGENT_LOCKED')).toBe(false)
    expect(isPermanentCanvasSaveError(403, 'FORBIDDEN')).toBe(true)
    expect(isPermanentCanvasSaveError(409, 'CANVAS_REVISION_CONFLICT', true)).toBe(false)
    expect(isPermanentCanvasSaveError(400, 'CANVAS_INVALID_INPUT')).toBe(true)
  })

  it('translates persisted tombstones and keeps the first page watermark across concurrent edits', async () => {
    request.mockResolvedValueOnce({
      data: {
        items: [{ element_id: 'a', kind: 'node', deleted: true }],
        sync_revision: 4,
        has_more: true,
        next_cursor: 'next',
      },
    })
    request.mockResolvedValueOnce({
      data: { items: [{ element_id: 'b', kind: 'node', deleted: false }], sync_revision: 6 },
    })
    const page = await fetchAllCanvasElements({ workspaceId: 2, canvasId: 3, afterRevision: 1 })
    expect(page.sync_revision).toBe(4)
    expect(page.elements.map(({ op }) => op)).toEqual(['delete', 'upsert'])
  })

  it('opens a credentialed event stream and closes it when collaboration eligibility ends', () => {
    const target = new EventTarget()
    const close = vi.fn()
    const construct = vi.fn()
    vi.stubGlobal(
      'EventSource',
      class {
        constructor(url: string, init: EventSourceInit) {
          construct(url, init)
        }
        addEventListener = target.addEventListener.bind(target)
        close = close
      },
    )
    const onRevision = vi.fn()
    const onDeleted = vi.fn()
    subscribeCanvasEvents({ workspaceId: 2, canvasId: 3, afterRevision: 7, onRevision, onDeleted })
    expect(construct).toHaveBeenCalledWith('/api/v1/canvases/3/events?workspace_id=2&after_revision=7', {
      withCredentials: true,
    })
    target.dispatchEvent(new MessageEvent('canvas.revision', { data: '{"revision":8}' }))
    expect(onRevision).toHaveBeenCalledWith(8)
    target.dispatchEvent(new MessageEvent('canvas.collaboration_disabled'))
    expect(close).toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
