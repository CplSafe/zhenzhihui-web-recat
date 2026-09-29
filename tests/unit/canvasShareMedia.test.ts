import { describe, expect, it } from 'vitest'
import { resolveCanvasShareMediaUrl } from '@/utils/canvasShareMedia'

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
