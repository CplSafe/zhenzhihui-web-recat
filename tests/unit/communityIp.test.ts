import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  archiveCommunityWork,
  createCommunityWork,
  getCommunityWork,
  getCommunityWorkManage,
  listCommunityWorks,
  listMyCommunityWorks,
  normalizeCommunityIp,
  normalizeCommunityWork,
  publishCommunityWork,
  updateCommunityWork,
} from '@/api/communityIp'
import { server } from '../mocks/server'

describe('normalizeCommunityIp', () => {
  it('兼容 CreatorSummary（user 嵌套）形态并带出平台与统计', () => {
    const profile = normalizeCommunityIp({
      user: { id: 8, nickname: '小鹿酱', avatar_url: 'https://cdn.example.com/a.png' },
      bio: '专注美食内容',
      follower_count: 102000,
      following_count: 12,
      published_work_count: 34,
      open_demand_count: 2,
      platforms: [{ name: '抖音', followers: 22000 }],
    })
    expect(profile.id).toBe(8)
    expect(profile.name).toBe('小鹿酱')
    expect(profile.followers).toBe(102000)
    expect(profile.publishedWorkCount).toBe(34)
    expect(profile.platforms).toEqual([{ name: '抖音', followers: 22000 }])
  })

  it('平台字段缺失时回退空数组', () => {
    const profile = normalizeCommunityIp({ id: 1, nickname: 'x' })
    expect(profile.platforms).toEqual([])
    expect(profile.category).toBe('暂未设置')
  })

  it('平台映射形态（对象）也能解析', () => {
    const profile = normalizeCommunityIp({ id: 1, nickname: 'x', platforms: { 小红书: 22000 } })
    expect(profile.platforms).toEqual([{ name: '小红书', followers: 22000 }])
  })

  it('请求我的作品、公开详情和管理详情', async () => {
    const paths: string[] = []
    server.use(
      http.get('/api/v1/community/me/works', ({ request }) => {
        paths.push(new URL(request.url).pathname)
        return HttpResponse.json({ code: 0, data: { items: [{ id: 11, title: '我的作品' }], total: 1 } })
      }),
      http.get('/api/v1/community/works/:id', ({ request, params }) => {
        paths.push(new URL(request.url).pathname)
        return HttpResponse.json({ code: 0, data: { id: Number(params.id), title: '公开作品' } })
      }),
      http.get('/api/v1/community/works/:id/manage', ({ request, params }) => {
        paths.push(new URL(request.url).pathname)
        return HttpResponse.json({ code: 0, data: { work: { id: Number(params.id), title: '管理作品' } } })
      }),
    )
    expect((await listMyCommunityWorks()).items[0]?.id).toBe(11)
    expect((await getCommunityWork(12)).title).toBe('公开作品')
    expect((await getCommunityWorkManage(13)).title).toBe('管理作品')
    expect(paths).toEqual([
      '/api/v1/community/me/works',
      '/api/v1/community/works/12',
      '/api/v1/community/works/13/manage',
    ])
  })

  it('创建、更新、发布和下架作品', async () => {
    const calls: Array<{ method: string; path: string; body: any }> = []
    server.use(
      http.all('/api/v1/community/works*', async ({ request }) => {
        const url = new URL(request.url)
        const rawBody = request.headers.get('content-type')?.includes('json') ? await request.text() : ''
        const body = rawBody ? JSON.parse(rawBody) : null
        calls.push({ method: request.method, path: url.pathname, body })
        const status = url.pathname.endsWith('/archive')
          ? 'archived'
          : url.pathname.endsWith('/publish')
            ? 'published'
            : 'draft'
        return HttpResponse.json(
          { code: 0, data: { id: 21, title: '城市夜行', status } },
          { status: request.method === 'POST' && url.pathname === '/api/v1/community/works' ? 201 : 200 },
        )
      }),
    )
    const input = { title: '城市夜行', summary: '短片', category: 'video', assetIds: [7], coverAssetId: 7 }
    await createCommunityWork(input)
    await updateCommunityWork(21, input)
    expect((await publishCommunityWork(21)).status).toBe('published')
    expect((await archiveCommunityWork(21)).status).toBe('archived')
    expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /api/v1/community/works',
      'PUT /api/v1/community/works/21',
      'POST /api/v1/community/works/21/publish',
      'POST /api/v1/community/works/21/archive',
    ])
    expect(calls[0]?.body).toMatchObject({ asset_ids: [7], cover_asset_id: 7, title: '城市夜行' })
  })
})

describe('normalizeCommunityWork / listCommunityWorks', () => {
  it('从 cover_asset 与 assets 中取封面与媒体', () => {
    const work = normalizeCommunityWork({
      id: 3,
      title: '活力运动',
      cover_asset: { url: 'https://cdn.example.com/cover.jpg', type: 'image' },
      assets: [{ url: 'https://cdn.example.com/video.mp4', type: 'video', mime_type: 'video/mp4' }],
    })
    expect(work.coverUrl).toBe('https://cdn.example.com/cover.jpg')
    expect(work.mediaUrl).toBe('https://cdn.example.com/video.mp4')
    expect(work.mediaType).toBe('video')
  })

  it('视频 cover_asset 作为视频预览而不是图片封面', () => {
    const work = normalizeCommunityWork({
      id: 4,
      title: '城市短片',
      cover_asset: { id: 20, url: 'https://cdn.example.com/work.mp4', type: 'video', mime_type: 'video/mp4' },
      assets: [],
    })
    expect(work.coverUrl).toBe('')
    expect(work.mediaUrl).toBe('https://cdn.example.com/work.mp4')
    expect(work.mediaType).toBe('video')
  })

  it('listCommunityWorks 携带 user_id 并过滤无 id 条目', async () => {
    let seen: URLSearchParams | null = null
    server.use(
      http.get('/api/v1/community/works', ({ request }) => {
        seen = new URL(request.url).searchParams
        return HttpResponse.json({ code: 0, data: { items: [{ id: 1, title: 'A' }, { title: '被过滤' }], total: 2 } })
      }),
    )
    const { items, total } = await listCommunityWorks({ userId: 8 })
    expect(seen!.get('user_id')).toBe('8')
    expect(items).toHaveLength(1)
    expect(total).toBe(2)
  })
})
