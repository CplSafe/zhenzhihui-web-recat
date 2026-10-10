import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CANVAS_SHORTCUTS,
  canUseCanvasShortcuts,
  formatCanvasShortcut,
  isCanvasShortcutTarget,
  matchesCanvasShortcut,
  resolveCanvasCreationShortcut,
  shortcutFromKeyboardEvent,
} from '@/utils/canvasKeyboard'

afterEach(() => document.body.replaceChildren())

function canvas() {
  const root = document.createElement('div')
  root.tabIndex = -1
  document.body.append(root)
  return root
}

function key(key: string, modifiers: Partial<KeyboardEventInit> = {}) {
  return new KeyboardEvent('keydown', { key, ...modifiers })
}

describe('画布快捷键冲突处理', () => {
  it('连线、副本、添加使用 L、Shift+D、N', () => {
    expect(resolveCanvasCreationShortcut(key('l'))).toBe('connect')
    expect(resolveCanvasCreationShortcut(key('L'))).toBe('connect')
    expect(resolveCanvasCreationShortcut(key('D', { shiftKey: true }))).toBe('duplicate')
    expect(resolveCanvasCreationShortcut(key('n'))).toBe('add')
    expect(resolveCanvasCreationShortcut(key('d'))).toBeNull()
    expect(resolveCanvasCreationShortcut(key('N', { shiftKey: true }))).toBeNull()
  })

  it.each(['d', '+', '-', '0', 'Tab'])('不再接管浏览器或 Tab 的 %s', (name) => {
    expect(resolveCanvasCreationShortcut(key(name))).toBeNull()
  })

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)('保留带 %s 的浏览器组合键', (modifier) => {
    for (const name of ['l', 'd', '+', '-', '0', 'n', 'Tab']) {
      expect(resolveCanvasCreationShortcut(key(name, { [modifier]: true }))).toBeNull()
    }
  })

  it('支持录入、展示并匹配用户自定义组合键', () => {
    expect(shortcutFromKeyboardEvent(key('k', { ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+K')
    expect(matchesCanvasShortcut(key('k', { metaKey: true, shiftKey: true }), 'Mod+Shift+K')).toBe(true)
    expect(shortcutFromKeyboardEvent(key('Escape'))).toBeNull()
    expect(formatCanvasShortcut('Mod+Shift+K')).toContain('Shift + K')
  })

  it('创建动作使用传入的自定义快捷键', () => {
    const shortcuts = { ...DEFAULT_CANVAS_SHORTCUTS, add: 'K' }
    expect(resolveCanvasCreationShortcut(key('n'), shortcuts)).toBeNull()
    expect(resolveCanvasCreationShortcut(key('k'), shortcuts)).toBe('add')
  })

  it('需要实际焦点在画布，且事件目标属于同一画布', () => {
    const root = canvas()
    const node = document.createElement('div')
    root.append(node)
    expect(canUseCanvasShortcuts(root, node)).toBe(false)
    root.focus()
    expect(canUseCanvasShortcuts(root, node)).toBe(true)
    expect(canUseCanvasShortcuts(root, document.body)).toBe(false)
    expect(canUseCanvasShortcuts(null, node)).toBe(false)
    expect(isCanvasShortcutTarget(root, window)).toBe(false)
    root.blur()
    expect(canUseCanvasShortcuts(root, node)).toBe(false)
  })

  it.each(['input', 'textarea', 'select', 'button', 'a', 'video', 'audio'])('在 %s 上保留原生操作', (tag) => {
    const root = canvas()
    const control = document.createElement(tag)
    root.append(control)
    root.focus()
    expect(canUseCanvasShortcuts(root, control)).toBe(false)
    expect(isCanvasShortcutTarget(root, control)).toBe(false)
  })

  it('可编辑、菜单、自定义按钮和忽略区域的子元素也不会接管', () => {
    const root = canvas()
    root.focus()
    for (const attributes of [
      { contenteditable: '' },
      { role: 'menu' },
      { role: 'button' },
      { 'data-canvas-keyboard': 'ignore' },
    ]) {
      const parent = document.createElement('div')
      for (const [name, value] of Object.entries(attributes)) parent.setAttribute(name, value)
      const child = document.createElement('span')
      parent.append(child)
      root.append(parent)
      expect(canUseCanvasShortcuts(root, child)).toBe(false)
    }
    const readonly = document.createElement('div')
    readonly.setAttribute('contenteditable', 'false')
    root.append(readonly)
    expect(canUseCanvasShortcuts(root, readonly)).toBe(true)
  })

  it('画布或全局弹窗打开时停止接管，关闭后允许恢复', () => {
    const root = canvas()
    root.focus()
    expect(canUseCanvasShortcuts(root, root, true)).toBe(false)
    const portal = document.createElement('div')
    portal.setAttribute('aria-modal', 'true')
    document.body.append(portal)
    expect(canUseCanvasShortcuts(root, root)).toBe(false)
    portal.setAttribute('aria-hidden', 'true')
    expect(canUseCanvasShortcuts(root, root)).toBe(true)
    portal.remove()
    const outsideInput = document.createElement('input')
    document.body.append(outsideInput)
    outsideInput.focus()
    expect(canUseCanvasShortcuts(root, root)).toBe(false)
  })

  it.each([
    ['MacIntel', '⌘', 'Option'],
    ['Win32', 'Ctrl', 'Alt'],
    ['Linux x86_64', 'Ctrl', 'Alt'],
  ])('按 %s 展示对应键名', async (platform, mod, alt) => {
    vi.resetModules()
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
    const keys = await import('@/utils/canvasKeyboard')
    expect(keys.CANVAS_MOD).toBe(mod)
    expect(keys.CANVAS_ALT).toBe(alt)
  })
})
