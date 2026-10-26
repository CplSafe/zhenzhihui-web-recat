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
    saveCanvasPreferences({
      ...DEFAULT_CANVAS_PREFERENCES,
      wheelMode: 'zoom',
      focusEdgesOnly: true,
      shortcuts: { ...DEFAULT_CANVAS_PREFERENCES.shortcuts, add: 'K' },
    })
    expect(loadCanvasPreferences()).toMatchObject({ wheelMode: 'zoom', focusEdgesOnly: true, shortcuts: { add: 'K' } })
  })

  it('非法值回落默认，未知字段丢弃', () => {
    const prefs = normalizeCanvasPreferences({ wheelMode: 'fly', alignmentGuides: 'yes', extra: 1 })
    expect(prefs.wheelMode).toBe('pan')
    expect(prefs.alignmentGuides).toBe(true)
    expect(prefs.shortcuts).toEqual(DEFAULT_CANVAS_PREFERENCES.shortcuts)
    expect('extra' in prefs).toBe(false)
  })

  it('升级旧默认绑定，同时保留自定义快捷键及其他偏好', () => {
    const prefs = normalizeCanvasPreferences({
      wheelMode: 'zoom',
      shortcuts: { connect: 'L', duplicate: 'Shift+D', add: 'Mod+K' },
    })
    expect(prefs.shortcuts).toMatchObject({ connect: 'Mod+L', duplicate: 'Mod+D', add: 'Mod+K' })
    expect(prefs.wheelMode).toBe('zoom')
    expect(prefs.shortcutsVersion).toBe(3)
  })

  it('升级第二版 Ctrl 绑定到截图规则，并保留用户自定义键', () => {
    const prefs = normalizeCanvasPreferences({
      shortcutsVersion: 2,
      shortcuts: {
        add: 'Mod+N',
        fitView: 'Mod+1',
        resetZoom: 'Mod+0',
        selectTool: 'Mod+Shift+V',
        panTool: 'Mod+H',
        arrange: 'Mod+Alt+F',
        connect: 'Mod+K',
      },
    })
    expect(prefs.shortcuts).toMatchObject({
      add: 'Tab',
      fitView: 'Mod+0',
      resetZoom: 'Mod+1',
      selectTool: 'V',
      panTool: 'H',
      arrange: 'Alt+Shift+F',
      connect: 'Mod+K',
    })
  })

  it('新版本允许显式自定义为旧单键，不会每次加载时覆盖', () => {
    saveCanvasPreferences({
      ...DEFAULT_CANVAS_PREFERENCES,
      shortcuts: { ...DEFAULT_CANVAS_PREFERENCES.shortcuts, connect: 'L' },
    })
    expect(loadCanvasPreferences().shortcuts.connect).toBe('L')
  })

  it('存储里是坏 JSON 时不抛错', () => {
    localStorage.setItem('zzh_canvas_preferences', '{not json')
    expect(loadCanvasPreferences()).toEqual(DEFAULT_CANVAS_PREFERENCES)
  })
})
