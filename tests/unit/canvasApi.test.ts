import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestBusinessJson: vi.fn() }))

vi.mock('@/api/business', () => ({
  requestBusinessJson: mocks.requestBusinessJson,
  BusinessApiError: class BusinessApiError extends Error {
    status: number
    response: unknown
    code: string | null

    constructor(message: string, options: { status?: number; response?: unknown; code?: string } = {}) {
      super(message)
      this.code = options.code || null
      this.status = options.status || 0
      this.response = options.response || null
    }
  },
}))

import {
  changeCanvasMembers,
  createCanvas,
  duplicateCanvas,
  fetchAllCanvasElements,
  listCanvases,
  saveCanvasElements,
  saveCanvasElementsBatched,
} from '@/api/canvasApi'

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
          image_model_version_id: 11,
          video_model_version_id: 22,
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
        image_model_version_id: 11,
        video_model_version_id: 22,
        has_more: false,
      }),
    )
    expect(mocks.requestBusinessJson).toHaveBeenNthCalledWith(
      2,
      '/api/v1/canvases/9/elements?workspace_id=7&after_revision=4&limit=1000&cursor=page-2',
      { cache: 'no-store' },
    )
  })

  it.each([null, {}, { items: [] }, { sync_revision: 7 }, { items: [], sync_revision: null }])(
    'does not treat an incomplete response as an empty canvas: %j',
    async (data) => {
      mocks.requestBusinessJson.mockResolvedValue({ code: 0, data })
      await expect(
        fetchAllCanvasElements({ workspaceId: 7, canvasId: 9, requireValidSnapshot: true }),
      ).rejects.toMatchObject({ code: 'CANVAS_INVALID_SNAPSHOT' })
    },
  )

  it('accepts an explicit empty page with revision zero as a new canvas', async () => {
    mocks.requestBusinessJson.mockResolvedValue({ data: { items: [], sync_revision: '0' } })
    await expect(
      fetchAllCanvasElements({ workspaceId: 7, canvasId: 9, requireValidSnapshot: true }),
    ).resolves.toMatchObject({ elements: [], sync_revision: 0 })
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

describe('画布成员和默认模型协议', () => {
  beforeEach(() => mocks.requestBusinessJson.mockReset())

  it('发送用户所选模型和明确空的成员名单，并解析服务端的画布配置', async () => {
    mocks.requestBusinessJson.mockResolvedValueOnce({
      data: {
        id: 9,
        image_model_version_id: 11,
        video_model_version_id: 22,
        members_restricted: true,
      },
    })
    const result = await createCanvas({
      workspaceId: 7,
      title: '新品海报',
      imageModelVersionId: 11,
      videoModelVersionId: 22,
      memberUserIds: [],
    })
    expect(JSON.parse(mocks.requestBusinessJson.mock.calls[0][1].body)).toEqual({
      title: '新品海报',
      image_model_version_id: 11,
      video_model_version_id: 22,
      member_user_ids: [],
    })
    expect(result).toMatchObject({ imageModelVersionId: 11, videoModelVersionId: 22, membersRestricted: true })
  })

  it('成员管理请求只发送添加和移除的差量', async () => {
    mocks.requestBusinessJson.mockResolvedValueOnce({
      data: { members_restricted: true, can_manage: true, member_user_ids: [3, 4] },
    })
    const result = await changeCanvasMembers(7, 9, [4], [8])
    expect(mocks.requestBusinessJson).toHaveBeenCalledWith(
      '/api/v1/canvases/9/members?workspace_id=7',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ member_user_ids: [4], remove_user_ids: [8] }),
      }),
    )
    expect(result.member_user_ids).toEqual([3, 4])
  })
})

describe('duplicateCanvas', () => {
  beforeEach(() => mocks.requestBusinessJson.mockReset())

  it('creates a new canvas and copies live elements with their ids and state', async () => {
    mocks.requestBusinessJson
      .mockResolvedValueOnce({
        data: {
          items: [
            { element_id: 'node-1', kind: 'node', op: 'upsert', payload: { x: 1 } },
            { element_id: 'edge-1', kind: 'edge', op: 'upsert', payload: { source: 'node-1' } },
            { element_id: 'gone', kind: 'node', op: 'delete' },
          ],
          sync_revision: 30,
          state: { viewport: { zoom: 2 } },
          has_more: false,
        },
      })
      .mockResolvedValueOnce({ data: { id: 88, title: '画布-副本' } })
      .mockResolvedValueOnce({ data: { sync_revision: 1 } })

    await expect(duplicateCanvas({ workspaceId: 7, sourceCanvasId: 9, title: '画布-副本' })).resolves.toEqual(
      expect.objectContaining({ id: 88 }),
    )
    expect(mocks.requestBusinessJson).toHaveBeenNthCalledWith(
      2,
      '/api/v1/canvases?workspace_id=7',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: '画布-副本' }) }),
    )
    const [url, init] = mocks.requestBusinessJson.mock.calls[2]
    expect(url).toBe('/api/v1/canvases/88/elements?workspace_id=7')
    expect(JSON.parse(init.body)).toEqual({
      base_revision: 0,
      mutations: [
        { element_id: 'node-1', kind: 'node', op: 'upsert', payload: { x: 1 } },
        { element_id: 'edge-1', kind: 'edge', op: 'upsert', payload: { source: 'node-1' } },
      ],
      state: { viewport: { zoom: 2 } },
      schema_version: 1,
    })
  })

  it('removes the half-created copy when copying elements fails', async () => {
    mocks.requestBusinessJson
      .mockResolvedValueOnce({
        data: { items: [{ element_id: 'node-1', kind: 'node', op: 'upsert' }], has_more: false },
      })
      .mockResolvedValueOnce({ data: { id: 88 } })
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValueOnce({})

    await expect(duplicateCanvas({ workspaceId: 7, sourceCanvasId: 9, title: 'x' })).rejects.toThrow('save failed')
    expect(mocks.requestBusinessJson).toHaveBeenLastCalledWith('/api/v1/canvases/88?workspace_id=7', {
      method: 'DELETE',
    })
  })
})

describe('listCanvases', () => {
  beforeEach(() => mocks.requestBusinessJson.mockReset())

  it('keeps the creator user_id so team members can be told apart', async () => {
    mocks.requestBusinessJson.mockResolvedValueOnce({
      data: {
        items: [
          { id: 3, title: 'A', user_id: 8, used_credits: 1.362 },
          { id: 4, title: 'B', used_credits: 0 },
        ],
      },
    })

    await expect(listCanvases({ workspaceId: 7 })).resolves.toEqual([
      { id: 3, title: 'A', userId: 8, usedCredits: 1.362 },
      { id: 4, title: 'B', usedCredits: 0 },
    ])
  })
})

describe('画布保存请求大小', () => {
  beforeEach(() => mocks.requestBusinessJson.mockReset())

  it('按 UTF-8 字节拆批并使用上批的 revision，保留所有内容', async () => {
    mocks.requestBusinessJson
      .mockResolvedValueOnce({ data: { sync_revision: 5 } })
      .mockResolvedValueOnce({ data: { sync_revision: 6 } })
    const mutations = ['a', 'b'].map((id) => ({
      element_id: id,
      kind: 'node' as const,
      op: 'upsert' as const,
      payload: { id, data: { text: '画'.repeat(180000) } },
    }))
    await expect(
      saveCanvasElementsBatched({ workspaceId: 7, canvasId: 9, baseRevision: 4, mutations, state: { zoom: 1 } }),
    ).resolves.toEqual({ sync_revision: 6 })
    const bodies = mocks.requestBusinessJson.mock.calls.map((call) => JSON.parse(call[1].body))
    expect(bodies.map((body) => body.base_revision)).toEqual([4, 5])
    expect(bodies.flatMap((body) => body.mutations)).toEqual(mutations)
    expect(bodies[0].state).toEqual({ zoom: 1 })
    expect(bodies[1].state).toBeUndefined()
    for (const call of mocks.requestBusinessJson.mock.calls)
      expect(new TextEncoder().encode(call[1].body).length).toBeLessThanOrEqual(1000 * 1024)
  })

  it('超大单个元素在任何写入前被拒绝，避免截断数据或部分保存', async () => {
    const mutations = ['small', 'large'].map((id) => ({
      element_id: id,
      kind: 'node' as const,
      op: 'upsert' as const,
      payload: { text: id === 'large' ? '画'.repeat(350000) : 'ok' },
    }))
    await expect(
      saveCanvasElementsBatched({ workspaceId: 7, canvasId: 9, baseRevision: 0, mutations }),
    ).rejects.toMatchObject({ code: 'CANVAS_LOCAL_PAYLOAD_TOO_LARGE', message: expect.stringContaining('large') })
    expect(mocks.requestBusinessJson).not.toHaveBeenCalled()
  })
})

describe('saveCanvasElements acknowledgement', () => {
  beforeEach(() => mocks.requestBusinessJson.mockReset())

  it.each([undefined, null, 0, -1, 3, 4.5, '4.5', 'invalid', true])(
    'requires reconciliation for an unusable write revision %s',
    async (revision) => {
      mocks.requestBusinessJson.mockResolvedValue({ data: { sync_revision: revision } })
      await expect(
        saveCanvasElements({ workspaceId: 7, canvasId: 9, baseRevision: 4, mutations: [], state: { zoom: 1 } }),
      ).rejects.toMatchObject({ code: 'CANVAS_SAVE_ACK_UNKNOWN' })
    },
  )

  it('accepts the compatible revision field without moving the base backwards', async () => {
    mocks.requestBusinessJson.mockResolvedValue({ data: { revision: '4' } })
    await expect(
      saveCanvasElements({ workspaceId: 7, canvasId: 9, baseRevision: 4, mutations: [], state: { zoom: 1 } }),
    ).resolves.toEqual({ sync_revision: 4 })
  })

  it('requires read-back if a node edit returns its unchanged base revision', async () => {
    mocks.requestBusinessJson.mockResolvedValue({ data: { revision: '4' } })
    await expect(
      saveCanvasElements({
        workspaceId: 7,
        canvasId: 9,
        baseRevision: 4,
        mutations: [{ element_id: 'text', kind: 'node', op: 'upsert', payload: { data: { text: '新内容' } } }],
      }),
    ).rejects.toMatchObject({ code: 'CANVAS_SAVE_ACK_UNKNOWN' })
  })
})
