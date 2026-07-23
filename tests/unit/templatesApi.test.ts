import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listCreativeProjects: vi.fn() }))

vi.mock('@/api/business', () => ({ listCreativeProjects: mocks.listCreativeProjects }))

import { listBackendTemplates, listTemplates } from '@/api/templates'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('backend template catalog', () => {
  beforeEach(() => {
    mocks.listCreativeProjects.mockReset()
    vi.unstubAllGlobals()
  })

  it('uses the public catalog endpoint with JSON and cookie credentials', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listBackendTemplates()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/templates', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  })

  it.each([
    ['network failure', () => Promise.reject(new Error('offline'))],
    ['HTTP failure', () => Promise.resolve(new Response('', { status: 503 }))],
    ['invalid JSON', () => Promise.resolve(new Response('{', { status: 200 }))],
  ])('fails closed on %s', async (_name, responseFactory) => {
    vi.stubGlobal('fetch', vi.fn(responseFactory))
    await expect(listBackendTemplates()).resolves.toEqual([])
  })

  it('normalizes ratios and strips unsafe server-provided media URLs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: 1,
              title: '竖屏案例',
              thumbnail_url: 'javascript:alert(1)',
              video_url: 'https://cdn.example.com/vertical.mp4',
              ratio: '9:16',
              style: '写实',
              created_at: '2026-07-21T00:00:00Z',
            },
            {
              id: 2,
              title: '横屏案例',
              thumbnail_url: '/covers/2.jpg',
              video_url: '/videos/2.mp4',
              width: 1920,
              height: 1080,
            },
            { id: 3, title: '危险视频', video_url: 'data:video/mp4;base64,AAAA' },
            { id: 4, title: '无视频', video_url: '' },
          ],
        }),
      ),
    )

    const result = await listBackendTemplates()

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      id: 1,
      title: '竖屏案例',
      thumbnailUrl: '',
      videoUrl: 'https://cdn.example.com/vertical.mp4',
      ratio: '9 / 16',
      style: '写实',
    })
    expect(result[1]).toMatchObject({
      thumbnailUrl: '/covers/2.jpg',
      videoUrl: '/videos/2.mp4',
      ratio: '1920 / 1080',
    })
  })

  it('accepts the documented raw-array response shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse([{ id: 5, title: '案例', video_url: '/videos/5.mp4' }])),
    )
    await expect(listBackendTemplates()).resolves.toEqual([
      expect.objectContaining({ id: 5, title: '案例', videoUrl: '/videos/5.mp4' }),
    ])
  })
})

describe('project-backed templates', () => {
  beforeEach(() => {
    mocks.listCreativeProjects.mockReset()
  })

  it('forwards pagination, expands every distinct video and refreshes asset URLs by tenant', async () => {
    mocks.listCreativeProjects.mockResolvedValue([
      {
        id: 10,
        title: '项目一',
        video_url: 'https://cdn.example.com/top.mp4',
        cover_url: '/covers/top.jpg',
        width: 1920,
        height: 1080,
      },
      {
        project_id: 11,
        project_name: '项目二',
        draft_json: JSON.stringify({
          smart: {
            entryMeta: {
              ratio: '4:5',
              style: '国风',
              images: ['https://expired.example.com/cover.jpg'],
              imageAssetIds: [31],
            },
            videoVersions: [
              { assetId: 41 },
              { assetId: 42, url: 'https://expired.example.com/video.mp4' },
              { assetId: 41, url: 'https://duplicate.example.com/video.mp4' },
            ],
          },
        }),
      },
      {
        id: 12,
        title: '无安全视频',
        draft_json: JSON.stringify({ smart: { videoVersions: [{ url: 'javascript:alert(1)' }] } }),
      },
    ])

    const result = await listTemplates({ workspaceId: 7, offset: 20, limit: 10 })

    expect(mocks.listCreativeProjects).toHaveBeenCalledWith({ workspaceId: 7, offset: 20, limit: 10 })
    expect(result.total).toBe(3)
    expect(result.items[0]).toMatchObject({
      id: 10,
      title: '项目一',
      videoUrl: 'https://cdn.example.com/top.mp4',
      thumbnailUrl: '/covers/top.jpg',
      ratio: '16 / 9',
    })
    expect(result.items.slice(1)).toEqual([
      expect.objectContaining({
        id: 11,
        videoAssetId: 41,
        videoUrl: '/api/v1/assets/41/download?workspace_id=7',
        thumbnailAssetId: 31,
        thumbnailUrl: '/api/v1/assets/31/download?workspace_id=7',
        ratio: '4 / 5',
        style: '国风',
      }),
      expect.objectContaining({
        id: 11,
        videoAssetId: 42,
        videoUrl: '/api/v1/assets/42/download?workspace_id=7',
      }),
    ])
  })

  it('keeps safe signed URLs when no workspace is selected and applies default pagination', async () => {
    mocks.listCreativeProjects.mockResolvedValue([
      {
        id: 8,
        draft: {
          selectedRatio: '16/9',
          selectedStyles: ['动漫'],
          videoHistoryList: [{ url: 'https://cdn.example.com/history.mp4', asset_id: 99 }],
        },
      },
    ])

    const result = await listTemplates()

    expect(mocks.listCreativeProjects).toHaveBeenCalledWith({ workspaceId: undefined, offset: 0, limit: 50 })
    expect(result.items[0]).toMatchObject({
      id: 8,
      videoAssetId: 99,
      videoUrl: 'https://cdn.example.com/history.mp4',
      ratio: '16 / 9',
      style: '动漫',
    })
  })

  it('does not expose an unsafe project cover as a video poster', async () => {
    mocks.listCreativeProjects.mockResolvedValue([
      {
        id: 9,
        video_url: '/videos/9.mp4',
        cover_url: 'data:image/svg+xml,<svg onload=alert(1)>',
      },
    ])

    const result = await listTemplates({ workspaceId: 7 })

    expect(result.items[0]).toMatchObject({ videoUrl: '/videos/9.mp4', thumbnailUrl: '' })
  })

  it('treats a malformed backend collection as empty', async () => {
    mocks.listCreativeProjects.mockResolvedValue({ items: [{ id: 1 }] })
    await expect(listTemplates({ workspaceId: 7 })).resolves.toEqual({ items: [], total: 0 })
  })
})
