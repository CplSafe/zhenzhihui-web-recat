import { beforeEach, describe, expect, it } from 'vitest'
import { pickRememberedCanvasModel, rememberCanvasModel } from '@/utils/canvasLastModel'

describe('canvasLastModel', () => {
  beforeEach(() => localStorage.clear())

  it('returns 0 when nothing has been remembered', () => {
    expect(pickRememberedCanvasModel('image', 'image.text_to_image', [1, 2])).toBe(0)
  })

  it('prefers the model remembered for the same kind and operation', () => {
    rememberCanvasModel('image', 'image.text_to_image', 2)
    rememberCanvasModel('image', 'image.image_to_image', 3)
    expect(pickRememberedCanvasModel('image', 'image.text_to_image', [1, 2, 3])).toBe(2)
  })

  it('falls back to the last model of the same kind when the operation differs', () => {
    rememberCanvasModel('video', 'video.generate', 7)
    expect(pickRememberedCanvasModel('video', 'video.edit', [5, 7])).toBe(7)
  })

  it('ignores a remembered model that is no longer available', () => {
    rememberCanvasModel('video', 'video.generate', 7)
    expect(pickRememberedCanvasModel('video', 'video.generate', [5, 6])).toBe(0)
  })

  it('keeps kinds separate', () => {
    rememberCanvasModel('image', 'image.text_to_image', 2)
    expect(pickRememberedCanvasModel('video', 'video.generate', [2])).toBe(0)
  })
})
