import { describe, expect, it } from 'vitest'
import {
  filterInputDerivedRatioOptions,
  isInputDerivedRatioValue,
  resolveCanvasModelParamOption,
} from '@/utils/canvasModelParams'

describe('filterInputDerivedRatioOptions', () => {
  it('drops the input-derived ratio when nothing is connected as media', () => {
    expect(filterInputDerivedRatioOptions(['adaptive', '16:9', '9:16'], false)).toEqual(['16:9', '9:16'])
    // 没有素材时提交 adaptive，官方 API 直接 400，所以默认值也要收敛到第一个具体画幅
    expect(resolveCanvasModelParamOption(['16:9', '9:16'], 'adaptive', 'adaptive')).toBe('16:9')
  })

  it('keeps the input-derived ratio once media is connected', () => {
    expect(filterInputDerivedRatioOptions(['adaptive', '16:9'], true)).toEqual(['adaptive', '16:9'])
  })

  it('never empties the dropdown when every option is input-derived', () => {
    expect(filterInputDerivedRatioOptions(['adaptive', 'auto'], false)).toEqual(['adaptive', 'auto'])
  })

  it('passes through empty or missing option lists untouched', () => {
    expect(filterInputDerivedRatioOptions([], false)).toEqual([])
    expect(filterInputDerivedRatioOptions(undefined, false)).toBeUndefined()
  })

  it.each(['adaptive', 'Adaptive', ' auto ', '自适应'])('treats %p as input-derived', (value) => {
    expect(isInputDerivedRatioValue(value)).toBe(true)
  })

  it.each(['16:9', '9:16', '', null, undefined, 1])('treats %p as a concrete ratio', (value) => {
    expect(isInputDerivedRatioValue(value)).toBe(false)
  })
})

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
