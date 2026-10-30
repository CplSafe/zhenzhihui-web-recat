import { describe, expect, it } from 'vitest'
import { getCanvasSelectionAddUnsupportedSources, isCanvasSelectionAddAllowed } from '@/utils/canvasSelectionAdd'

describe('canvas selection add source matrix', () => {
  it('allows the verified video multi-select targets and keeps unsupported scripts disabled', () => {
    expect(isCanvasSelectionAddAllowed('audio', ['video', 'video'])).toBe(true)
    expect(isCanvasSelectionAddAllowed('video', ['image', 'video'])).toBe(true)
    expect(isCanvasSelectionAddAllowed('script', ['text', 'text'])).toBe(false)
  })

  it('rejects text for audio and audio for video generation', () => {
    expect(isCanvasSelectionAddAllowed('audio', ['text', 'text'])).toBe(false)
    expect(isCanvasSelectionAddAllowed('video', ['audio', 'audio'])).toBe(false)
  })

  it('requires every source to be supported and keeps images out of video-only timelines', () => {
    expect(isCanvasSelectionAddAllowed('video', ['image', 'audio'])).toBe(false)
    expect(isCanvasSelectionAddAllowed('timeline', ['image', 'video'])).toBe(false)
    expect(getCanvasSelectionAddUnsupportedSources('timeline', ['image', 'video'])).toEqual(['image'])
  })
})
