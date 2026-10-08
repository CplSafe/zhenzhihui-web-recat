import { describe, expect, it } from 'vitest'
import { resolveCanvasShareMediaUrl, resolvePublicCanvasNodeMedia } from '@/utils/canvasShareMedia'

describe('resolveCanvasShareMediaUrl', () => {
  it('prefers anonymous share media over the editor-only asset URL', () => {
    expect(
      resolveCanvasShareMediaUrl({
        public_result_url: 'https://media.example.com/shared/image.png',
        resultUrl: '/api/v1/assets/12/download?workspace_id=3',
      }),
    ).toBe('https://media.example.com/shared/image.png')
  })

  it('keeps existing URLs for older share payloads', () => {
    expect(resolveCanvasShareMediaUrl({ resultUrl: '/image.png' })).toBe('/image.png')
  })

  it('never reuses a browser-session blob URL in a share page', () => {
    expect(resolveCanvasShareMediaUrl({ resultUrl: 'blob:https://example.com/old' })).toBe('')
  })

  it('uses a public poster when available', () => {
    expect(
      resolveCanvasShareMediaUrl({ publicPosterUrl: '/shared/poster.png', posterUrl: '/private/poster.png' }, 'poster'),
    ).toBe('/shared/poster.png')
  })
})

describe('resolvePublicCanvasNodeMedia', () => {
  it('routes node assets through the anonymous share endpoint instead of the login-only download URL', () => {
    expect(
      resolvePublicCanvasNodeMedia('tok/en', {
        assetId: 42,
        posterAssetId: 43,
        resultUrl: '/api/v1/assets/42/download?workspace_id=7',
      }),
    ).toEqual({
      url: '/api/v1/canvas-shares/tok%2Fen/assets/42',
      posterUrl: '/api/v1/canvas-shares/tok%2Fen/assets/43',
    })
  })

  it('leaves nodes without a usable asset id to the existing URL fallback', () => {
    expect(resolvePublicCanvasNodeMedia('t', { resultUrl: 'https://cdn.example.com/a.png' })).toEqual({
      url: '',
      posterUrl: '',
    })
    expect(resolvePublicCanvasNodeMedia('t', { assetId: 0, posterAssetId: 'abc' })).toEqual({ url: '', posterUrl: '' })
    expect(resolvePublicCanvasNodeMedia('', { assetId: 42 })).toEqual({ url: '', posterUrl: '' })
    expect(resolvePublicCanvasNodeMedia('t', undefined)).toEqual({ url: '', posterUrl: '' })
  })

  it('feeds resolveCanvasShareMediaUrl ahead of the editor-only resultUrl', () => {
    const media = resolvePublicCanvasNodeMedia('t', { assetId: 42 })
    const data = { resultUrl: '/api/v1/assets/42/download?workspace_id=7', shareMediaUrl: media.url }
    expect(resolveCanvasShareMediaUrl(data)).toBe('/api/v1/canvas-shares/t/assets/42')
  })
})
