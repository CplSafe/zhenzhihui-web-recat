import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAssets: vi.fn(),
  listCreativeProjects: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  extractAssetPage: (payload: any) => {
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : []
    return {
      items,
      limit: Number(payload?.limit ?? items.length),
      offset: Number(payload?.offset ?? 0),
      total: Number(payload?.total ?? items.length),
    }
  },
  listAssets: mocks.listAssets,
  listCreativeProjects: mocks.listCreativeProjects,
}))

import {
  listAllAssets,
  listAllCreativeProjects,
  listAssetPage,
  PaginationScopeChangedError,
} from '@/utils/businessPagination'

describe('business pagination', () => {
  beforeEach(() => {
    mocks.listAssets.mockReset()
    mocks.listCreativeProjects.mockReset()
  })

  it('loads all project pages and de-duplicates overlapping results', async () => {
    mocks.listCreativeProjects
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([{ id: 2 }, { id: 3 }])
      .mockResolvedValueOnce([{ id: 2 }, { id: 3 }])

    await expect(listAllCreativeProjects({ workspaceId: 21, pageSize: 2 })).resolves.toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ])
    expect(mocks.listCreativeProjects.mock.calls).toEqual([
      [{ workspaceId: 21, offset: 0, limit: 2 }],
      [{ workspaceId: 21, offset: 2, limit: 2 }],
      [{ workspaceId: 21, offset: 4, limit: 2 }],
    ])
  })

  it('uses asset metadata to load through total without a fixed item cap', async () => {
    mocks.listAssets
      .mockResolvedValueOnce({ items: [{ id: 10 }, { id: 11 }], limit: 2, offset: 0, total: 3 })
      .mockResolvedValueOnce({ items: [{ id: 12 }], limit: 2, offset: 2, total: 3 })

    await expect(listAllAssets({ workspaceId: 21, type: 'video', status: 'active', pageSize: 2 })).resolves.toEqual([
      { id: 10 },
      { id: 11 },
      { id: 12 },
    ])
    expect(mocks.listAssets.mock.calls).toEqual([
      [
        {
          workspaceId: 21,
          type: 'video',
          status: 'active',
          source: '',
          offset: 0,
          limit: 2,
        },
      ],
      [
        {
          workspaceId: 21,
          type: 'video',
          status: 'active',
          source: '',
          offset: 2,
          limit: 2,
        },
      ],
    ])
  })

  it('loads one asset page and exposes continuation metadata without fetching the next page', async () => {
    mocks.listAssets.mockResolvedValueOnce({
      items: [{ id: 10 }, { id: 11 }],
      limit: 2,
      offset: 0,
      total: 5,
    })

    await expect(listAssetPage({ workspaceId: 21, pageSize: 2 })).resolves.toEqual({
      items: [{ id: 10 }, { id: 11 }],
      limit: 2,
      offset: 0,
      nextOffset: 2,
      total: 5,
      totalKnown: true,
      hasMore: true,
    })
    expect(mocks.listAssets).toHaveBeenCalledTimes(1)
  })

  it('keeps paging a legacy asset response without total until an empty page', async () => {
    mocks.listAssets
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([{ id: 11 }])
      .mockResolvedValueOnce([])

    await expect(listAllAssets({ workspaceId: 21, pageSize: 100 })).resolves.toEqual([{ id: 10 }, { id: 11 }])
    expect(mocks.listAssets).toHaveBeenCalledTimes(3)
  })

  it('rejects stale results when the caller workspace scope changes mid-request', async () => {
    let current = true
    mocks.listCreativeProjects.mockImplementation(async () => {
      current = false
      return [{ id: 1 }]
    })

    await expect(listAllCreativeProjects({ workspaceId: 21, isCurrent: () => current })).rejects.toBeInstanceOf(
      PaginationScopeChangedError,
    )
  })

  it('does not call the backend without a valid workspace', async () => {
    await expect(listAllCreativeProjects({ workspaceId: 0 })).resolves.toEqual([])
    await expect(listAllAssets({ workspaceId: 0 })).resolves.toEqual([])
    expect(mocks.listCreativeProjects).not.toHaveBeenCalled()
    expect(mocks.listAssets).not.toHaveBeenCalled()
  })
})
