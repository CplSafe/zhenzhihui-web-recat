import { describe, expect, it } from 'vitest'
import { resolveCanvasModelParamOption } from '@/utils/canvasModelParams'

describe('resolveCanvasModelParamOption', () => {
  it('migrates a legacy case variant to the canonical schema option', () => {
    expect(resolveCanvasModelParamOption(['480p', '720p', '1080p'], '1080P', '720p')).toBe('1080p')
  })

  it('keeps numeric schema option types when restoring string values', () => {
    expect(resolveCanvasModelParamOption([4, 5, 10], '5', 5)).toBe(5)
  })

  it('falls back to the schema default when the restored value is unsupported', () => {
    expect(resolveCanvasModelParamOption(['480p', '720p'], '4K', '720p')).toBe('720p')
  })

  it('falls back to the first option when the schema default is unsupported', () => {
    expect(resolveCanvasModelParamOption(['16:9', '9:16'], '3:2', '1:1')).toBe('16:9')
  })

  it('leaves free-form values unchanged when the field has no options', () => {
    expect(resolveCanvasModelParamOption(undefined, '自由文本', '')).toBe('自由文本')
  })
})
