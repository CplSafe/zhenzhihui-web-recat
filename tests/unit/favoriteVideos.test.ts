import { beforeEach, describe, expect, it } from 'vitest'
import {
  favoriteVideoAssetIdOf,
  loadFavorites,
  setFavoriteVideoUserScope,
  toggleFavorite,
  type FavoriteVideo,
} from '@/utils/favoriteVideos'

function favorite(overrides: Partial<FavoriteVideo> = {}): FavoriteVideo {
  return {
    key: 'a42',
    title: '测试视频',
    videoUrl: 'https://cdn.example.test/expired.mp4',
    thumbnailUrl: '',
    ratio: '16:9',
    ts: 1,
    ...overrides,
  }
}

describe('favoriteVideos stable asset identity', () => {
  beforeEach(() => {
    setFavoriteVideoUserScope('user-a')
  })

  it('persists videoAssetId even when an old caller only provides the asset key', () => {
    expect(toggleFavorite(21, favorite())).toBe(true)

    const stored = JSON.parse(window.localStorage.getItem('zzh_favorite_videos_v2_uuser-a_ws21') || '[]')
    expect(stored).toEqual([expect.objectContaining({ key: 'a42', videoAssetId: 42 })])
  })

  it('derives videoAssetId from legacy stored data while preserving URL-only favorites', () => {
    window.localStorage.setItem(
      'zzh_favorite_videos_v2_uuser-a_ws21',
      JSON.stringify([favorite({ key: 'a77' }), favorite({ key: 'uhttps://example.test/video.mp4' })]),
    )

    const [assetFavorite, urlFavorite] = loadFavorites(21)
    expect(assetFavorite.videoAssetId).toBe(77)
    expect(favoriteVideoAssetIdOf(assetFavorite)).toBe(77)
    expect(urlFavorite.videoAssetId).toBeUndefined()
    expect(favoriteVideoAssetIdOf(urlFavorite)).toBe(0)
  })

  it('isolates favorites by user and workspace', () => {
    expect(toggleFavorite(21, favorite({ title: '用户 A 收藏' }))).toBe(true)

    setFavoriteVideoUserScope('user-b')
    expect(loadFavorites(21)).toEqual([])
    expect(toggleFavorite(21, favorite({ key: 'a43', title: '用户 B 收藏' }))).toBe(true)

    setFavoriteVideoUserScope('user-a')
    expect(loadFavorites(21)).toEqual([expect.objectContaining({ key: 'a42', title: '用户 A 收藏' })])
    expect(loadFavorites(22)).toEqual([])
  })

  it('does not expose an ownerless workspace-only favorite to an authenticated account', () => {
    window.localStorage.setItem('zzh_favorite_videos_21', JSON.stringify([favorite({ title: '归属不明' })]))

    expect(loadFavorites(21)).toEqual([])
    expect(window.localStorage.getItem('zzh_favorite_videos_21')).not.toBeNull()

    setFavoriteVideoUserScope('')
    expect(loadFavorites(21)).toEqual([expect.objectContaining({ title: '归属不明' })])
    expect(window.localStorage.getItem('zzh_favorite_videos_21')).toBeNull()
    expect(window.localStorage.getItem('zzh_favorite_videos_v2_uanon_ws21')).not.toBeNull()
  })

  it('prefers an explicit valid asset ID and rejects malformed keys', () => {
    expect(favoriteVideoAssetIdOf(favorite({ key: 'a12', videoAssetId: 99 }))).toBe(99)
    expect(favoriteVideoAssetIdOf(favorite({ key: 'a0' }))).toBe(0)
    expect(favoriteVideoAssetIdOf(favorite({ key: 'asset-12' }))).toBe(0)
  })

  it('never persists provider signatures and replaces asset-backed URLs with the stable app endpoint', () => {
    const signedUrl = 'https://storage.example.test/video.mp4?X-Amz-Credential=secret&X-Amz-Signature=signature'
    const signedCover = 'https://storage.example.test/cover.jpg?token=secret'

    expect(toggleFavorite(21, favorite({ videoUrl: signedUrl, thumbnailUrl: signedCover }))).toBe(true)

    const raw = window.localStorage.getItem('zzh_favorite_videos_v2_uuser-a_ws21') || ''
    expect(raw).not.toContain('secret')
    expect(raw).not.toContain('signature')
    expect(loadFavorites(21)).toEqual([
      expect.objectContaining({
        key: 'a42',
        videoAssetId: 42,
        videoUrl: '/api/v1/assets/42/download?workspace_id=21',
        thumbnailUrl: '',
      }),
    ])
  })

  it('drops signed URL-only favorites because they have no durable media identity', () => {
    const signedUrl = 'https://storage.example.test/video.mp4?token=secret'

    expect(toggleFavorite(21, favorite({ key: `u${signedUrl}`, videoUrl: signedUrl }))).toBe(false)
    expect(loadFavorites(21)).toEqual([])
  })
})
