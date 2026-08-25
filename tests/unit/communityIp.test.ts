import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { listCommunityWorks, normalizeCommunityIp, normalizeCommunityWork } from '@/api/communityIp'
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
