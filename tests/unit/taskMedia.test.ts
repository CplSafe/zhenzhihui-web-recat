import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAssets: vi.fn(),
  getAssetDownloadUrl: vi.fn(),
  extractTaskMediaUrls: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  listAssets: mocks.listAssets,
  getAssetDownloadUrl: mocks.getAssetDownloadUrl,
  extractTaskMediaUrls: mocks.extractTaskMediaUrls,
  extractAssetPage: (payload: any) => ({
    items: Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [],
    total: Number(payload?.total || 0),
    offset: Number(payload?.offset || 0),
    limit: Number(payload?.limit || 0),
  }),
}))

import {
  extractVideoOutputAssetId,
  findAssetIdByTaskId,
  resolveGeneratedMediaUrls,
  resolveTaskVideoResult,
} from '@/utils/taskMedia'

describe('video output asset selection', () => {
  it('selects the explicitly typed video when an image output appears first', () => {
    expect(
      extractVideoOutputAssetId({
        outputs: [
          { asset_id: 101, media_type: 'image', url: 'https://cdn.example/preview.png' },
          { asset_id: 202, mime_type: 'video/mp4', url: 'https://cdn.example/final.mp4' },
        ],
      }),
    ).toBe(202)
  })

  it('supports explicit video type, role, and URL extension hints', () => {
    expect(extractVideoOutputAssetId({ outputs: [{ asset_id: 301, type: 'video' }] })).toBe(301)
    expect(extractVideoOutputAssetId({ outputs: [{ asset_id: 302, role: 'generated_video' }] })).toBe(302)
    expect(
      extractVideoOutputAssetId({ outputs: [{ asset_id: 303, url: 'https://cdn.example/result.webm?sig=1' }] }),
    ).toBe(303)
  })

  it('falls back to the only asset output when legacy output has no type information', () => {
    expect(extractVideoOutputAssetId({ outputs: [{ asset_id: '401' }] })).toBe(401)
  })

  it('does not guess when multiple asset outputs have no type information', () => {
    expect(extractVideoOutputAssetId({ outputs: [{ asset_id: 501 }, { asset_id: 502 }] })).toBe(0)
  })

  it('does not treat a single explicitly typed image as a video', () => {
    expect(extractVideoOutputAssetId({ outputs: [{ asset_id: 601, type: 'image' }] })).toBe(0)
  })
})

describe('task media durable asset resolution', () => {
  beforeEach(() => {
    mocks.listAssets.mockReset()
    mocks.getAssetDownloadUrl.mockReset()
    mocks.extractTaskMediaUrls.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves the explicitly typed video asset instead of an earlier image asset', async () => {
    mocks.getAssetDownloadUrl.mockImplementation(async ({ assetId }) => `/api/v1/assets/${assetId}/download`)

    await expect(
      resolveTaskVideoResult(
        21,
        {
          id: 777,
          outputs: [
            { asset_id: 101, type: 'image' },
            { asset_id: 202, type: 'video' },
          ],
        },
        777,
      ),
    ).resolves.toEqual({
      assetId: 202,
      url: '/api/v1/assets/202/download',
    })

    expect(mocks.getAssetDownloadUrl).toHaveBeenCalledOnce()
    expect(mocks.getAssetDownloadUrl).toHaveBeenCalledWith({ workspaceId: 21, assetId: 202 })
    expect(mocks.listAssets).not.toHaveBeenCalled()
  })

  it('paginates beyond the first 100 assets and prefers the stable asset URL over a provider URL', async () => {
    mocks.listAssets
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, task_id: index + 1 })),
        total: 101,
        offset: 0,
        limit: 100,
      })
      .mockResolvedValueOnce({
        items: [{ id: 501, task_id: '777' }],
        total: 101,
        offset: 100,
        limit: 100,
      })
    mocks.getAssetDownloadUrl.mockResolvedValue('/api/v1/assets/501/download?workspace_id=21')
    mocks.extractTaskMediaUrls.mockReturnValue(['https://provider.example/result.mp4?signature=temporary'])

    await expect(
      resolveGeneratedMediaUrls({
        workspaceId: 21,
        task: { id: 777 },
        type: 'video',
      }),
    ).resolves.toEqual(['/api/v1/assets/501/download?workspace_id=21'])

    expect(mocks.listAssets).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ workspaceId: 21, type: 'video', limit: 100, offset: 0 }),
    )
    expect(mocks.listAssets).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ workspaceId: 21, type: 'video', limit: 100, offset: 100 }),
    )
    expect(mocks.extractTaskMediaUrls).not.toHaveBeenCalled()
  })

  it('retries when a completed task asset has not reached the asset list yet', async () => {
    vi.useFakeTimers()
    mocks.listAssets.mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 100 }).mockResolvedValueOnce({
      items: [{ id: 902, task_id: 888 }],
      total: 1,
      offset: 0,
      limit: 100,
    })

    const result = findAssetIdByTaskId(21, 888, 'video')
    await vi.advanceTimersByTimeAsync(400)

    await expect(result).resolves.toBe(902)
    expect(mocks.listAssets).toHaveBeenCalledTimes(2)
  })

  it('continues after a full legacy array page that has no explicit total', async () => {
    mocks.listAssets
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => ({ id: index + 1, task_id: index + 1 })))
      .mockResolvedValueOnce([{ id: 903, task_id: 999 }])

    await expect(findAssetIdByTaskId(21, 999, 'video')).resolves.toBe(903)
    expect(mocks.listAssets).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ workspaceId: 21, type: 'video', limit: 100, offset: 100 }),
    )
  })

  it('continues after a short legacy array page when no total declares the end', async () => {
    mocks.listAssets
      .mockResolvedValueOnce([
        { id: 1, task_id: 1 },
        { id: 2, task_id: 2 },
      ])
      .mockResolvedValueOnce([{ id: 904, task_id: 1_001 }])

    await expect(findAssetIdByTaskId(21, 1_001, 'video')).resolves.toBe(904)
    expect(mocks.listAssets).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ workspaceId: 21, type: 'video', limit: 100, offset: 2 }),
    )
  })

  it('stops a legacy array scan when the backend ignores offset and repeats a page', async () => {
    const repeatedPage = [
      { id: 1, task_id: 1 },
      { id: 2, task_id: 2 },
    ]
    mocks.listAssets.mockResolvedValue(repeatedPage)
    mocks.extractTaskMediaUrls.mockReturnValue(['https://provider.example/result.mp4'])

    await expect(
      resolveGeneratedMediaUrls({
        workspaceId: 21,
        task: { id: 1_002 },
        type: 'video',
      }),
    ).resolves.toEqual(['https://provider.example/result.mp4'])

    expect(mocks.listAssets).toHaveBeenCalledTimes(2)
    expect(mocks.listAssets).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ workspaceId: 21, type: 'video', limit: 100, offset: 2 }),
    )
  })
})
