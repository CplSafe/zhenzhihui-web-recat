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

import {
  changeCanvasMembers,
  createCanvas,
  duplicateCanvas,
  fetchAllCanvasElements,
  listCanvases,
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
          { id: 3, title: 'A', user_id: 8 },
          { id: 4, title: 'B' },
        ],
      },
    })

    await expect(listCanvases({ workspaceId: 7 })).resolves.toEqual([
      { id: 3, title: 'A', userId: 8 },
      { id: 4, title: 'B' },
    ])
  })
})
