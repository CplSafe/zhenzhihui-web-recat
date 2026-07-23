import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { listBanners } from '@/api/banners'
import { server } from '../mocks/server'

describe('banners API', () => {
  it('encodes the slug, preserves server order, and normalizes safe banner fields', async () => {
    let requestedSlug = ''
    server.use(
      http.get('/api/v1/banners', ({ request }) => {
        requestedSlug = new URL(request.url).searchParams.get('slug') || ''
        return HttpResponse.json({
          data: [
            {
              id: '2',
              title: ' 第二张 ',
              description: ' 描述 ',
              media_url: '/banner-2.webp',
              media_type: 'VIDEO',
              link_url: 'https://example.com/detail',
              position: '20',
            },
            {
              id: 1,
              image_url: 'https://cdn.example.com/banner-1.webp',
              link_url: '/templates',
              position: 1,
            },
          ],
        })
      }),
    )

    await expect(listBanners('home / 推荐')).resolves.toEqual([
      {
        id: 2,
        title: '第二张',
        description: '描述',
        mediaUrl: '/banner-2.webp',
        mediaType: 'video',
        linkUrl: 'https://example.com/detail',
        position: 20,
      },
      {
        id: 1,
        title: '',
        description: '',
        mediaUrl: 'https://cdn.example.com/banner-1.webp',
        mediaType: 'image',
        linkUrl: '/templates',
        position: 1,
      },
    ])
    expect(requestedSlug).toBe('home / 推荐')
  })

  it('filters disabled or unsafe media and clears unsafe navigation URLs', async () => {
    server.use(
      http.get('/api/v1/banners', () =>
        HttpResponse.json([
          { id: 1, image_url: '/safe.webp', link_url: 'javascript:alert(1)' },
          { id: 2, image_url: 'blob:null/safe-preview', link_url: '//evil.example/path' },
          { id: 3, image_url: 'data:image/png;base64,unsafe' },
          { id: 4, image_url: '/disabled.webp', enabled: false },
        ]),
      ),
    )

    const banners = await listBanners()
    expect(banners).toHaveLength(2)
    expect(banners.map((banner) => banner.linkUrl)).toEqual(['', ''])
  })

  it('rejects browser-normalized external paths, invalid absolute URLs, userinfo and controls', async () => {
    server.use(
      http.get('/api/v1/banners', () =>
        HttpResponse.json([
          { id: 1, image_url: '/safe-1.webp', link_url: '/\\evil.example/path' },
          { id: 2, image_url: '/\\evil.example/banner.webp', link_url: '/templates' },
          { id: 3, image_url: 'https://', link_url: '/templates' },
          { id: 4, image_url: 'https://user:secret@cdn.example/banner.webp', link_url: '/templates' },
          { id: 5, image_url: 'https://cdn.example/safe-5.webp', link_url: 'https://user@example/detail' },
          { id: 6, image_url: '/safe-6.webp', link_url: '/detail\u0000suffix' },
        ]),
      ),
    )

    const banners = await listBanners('home')
    expect(banners.map(({ id, mediaUrl, linkUrl }) => ({ id, mediaUrl, linkUrl }))).toEqual([
      { id: 1, mediaUrl: '/safe-1.webp', linkUrl: '' },
      { id: 5, mediaUrl: 'https://cdn.example/safe-5.webp', linkUrl: '' },
      { id: 6, mediaUrl: '/safe-6.webp', linkUrl: '' },
    ])
  })

  it.each([
    ['HTTP failure', () => new HttpResponse(null, { status: 503 })],
    ['invalid JSON', () => new HttpResponse('not-json', { headers: { 'Content-Type': 'application/json' } })],
  ])('fails closed on %s', async (_name, responseFactory) => {
    server.use(http.get('/api/v1/banners', responseFactory))
    await expect(listBanners('home')).resolves.toEqual([])
  })

  it('fails closed when fetch rejects', async () => {
    server.use(http.get('/api/v1/banners', () => HttpResponse.error()))
    await expect(listBanners()).resolves.toEqual([])
  })
})
