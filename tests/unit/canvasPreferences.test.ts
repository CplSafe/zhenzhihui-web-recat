import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CANVAS_PREFERENCES,
  loadCanvasPreferences,
  normalizeCanvasPreferences,
  saveCanvasPreferences,
} from '@/utils/canvasPreferences'

describe('canvasPreferences', () => {
  beforeEach(() => localStorage.clear())

  it('没有记录时给默认值', () => {
    expect(loadCanvasPreferences()).toEqual(DEFAULT_CANVAS_PREFERENCES)
  })

  it('保存后能原样读回', () => {
    saveCanvasPreferences({ ...DEFAULT_CANVAS_PREFERENCES, wheelMode: 'zoom', focusEdgesOnly: true })
    expect(loadCanvasPreferences()).toMatchObject({ wheelMode: 'zoom', focusEdgesOnly: true })
  })

  it('非法值回落默认，未知字段丢弃', () => {
    const prefs = normalizeCanvasPreferences({ wheelMode: 'fly', alignmentGuides: 'yes', extra: 1 })
    expect(prefs.wheelMode).toBe('pan')
    expect(prefs.alignmentGuides).toBe(true)
    expect('extra' in prefs).toBe(false)
  })

  it('存储里是坏 JSON 时不抛错', () => {
    localStorage.setItem('zzh_canvas_preferences', '{not json')
    expect(loadCanvasPreferences()).toEqual(DEFAULT_CANVAS_PREFERENCES)
  })
})
