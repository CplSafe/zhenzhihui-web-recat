import { describe, expect, it } from 'vitest'
import {
  buildPersistentAssetUrl,
  sanitizePersistentMediaUrl,
  sanitizePersistentProjectVideoStore,
} from '@/utils/persistentMediaUrl'

describe('persistent media URL sanitization', () => {
  it('builds a credential-free same-origin asset stream reference', () => {
    expect(buildPersistentAssetUrl(501, 21)).toBe('/api/v1/assets/501/download?workspace_id=21')
    expect(buildPersistentAssetUrl(0, 21)).toBe('')
    expect(buildPersistentAssetUrl(501, 0)).toBe('')
  })

  it('replaces an asset-backed provider URL with the same-origin asset reference', () => {
    const providerUrl = 'https://bucket.example.com/result.mp4?X-Amz-Credential=secret&X-Amz-Signature=provider-secret'

    expect(sanitizePersistentMediaUrl(providerUrl, { assetId: 501, workspaceId: 21 })).toBe(
      '/api/v1/assets/501/download?workspace_id=21',
    )
  })

  it('canonicalizes an existing asset route to the requested workspace', () => {
    expect(
      sanitizePersistentMediaUrl('/api/v1/assets/501/download?workspace_id=999&token=stale', {
        assetId: 501,
        workspaceId: 21,
      }),
    ).toBe('/api/v1/assets/501/download?workspace_id=21')
  })

  it('drops signed provider URLs that have no durable asset reference', () => {
    expect(
      sanitizePersistentMediaUrl(
        'https://bucket.example.com/result.mp4?OSSAccessKeyId=secret&Expires=999999&Signature=secret',
      ),
    ).toBe('')
    expect(
      sanitizePersistentMediaUrl(
        'https://bucket.example.com/result.mp4?x-oss-credential=secret&x-oss-signature=secret',
      ),
    ).toBe('')
    expect(sanitizePersistentMediaUrl('/api/v1/assets/8/download?workspace_id=2&access_token=secret')).toBe('')
    expect(sanitizePersistentMediaUrl(`${window.location.origin}/api/v1/assets/8/download?signature=secret`)).toBe('')
  })

  it('preserves same-origin durable routes and unsigned public URLs', () => {
    const sameOrigin = `${window.location.origin}/api/v1/assets/8/download?workspace_id=2`
    expect(sanitizePersistentMediaUrl('/api/v1/assets/8/download?workspace_id=2')).toBe(
      '/api/v1/assets/8/download?workspace_id=2',
    )
    expect(sanitizePersistentMediaUrl(sameOrigin)).toBe(sameOrigin)
    expect(sanitizePersistentMediaUrl('https://cdn.example.com/public/result.mp4')).toBe(
      'https://cdn.example.com/public/result.mp4',
    )
  })

  it.each(['blob:preview', 'data:image/png;base64,secret', '//evil.example/video.mp4', 'https:\\evil.example'])(
    'rejects non-persistent or ambiguous URL: %s',
    (url) => {
      expect(sanitizePersistentMediaUrl(url)).toBe('')
    },
  )

  it('sanitizes project video store records embedded in creative drafts', () => {
    const result = sanitizePersistentProjectVideoStore(
      {
        records: [
          {
            id: 'asset-video',
            videoAssetId: 88,
            videoUrl: 'https://bucket.example/video.mp4?signature=secret',
            coverUrl: 'https://bucket.example/cover.jpg?token=secret',
          },
        ],
        overrides: { 'asset:88': { title: '保留元数据' } },
      },
      21,
    ) as any

    expect(result.records[0]).toMatchObject({
      id: 'asset-video',
      videoAssetId: 88,
      videoUrl: '/api/v1/assets/88/download?workspace_id=21',
      coverUrl: '',
    })
    expect(result.overrides).toEqual({ 'asset:88': { title: '保留元数据' } })
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
