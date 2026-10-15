const platform =
  typeof navigator === 'undefined'
    ? ''
    : (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent
export const CANVAS_IS_MAC = /Mac|iPhone|iPad|iPod/i.test(platform)
export const CANVAS_MOD = CANVAS_IS_MAC ? '⌘' : 'Ctrl'
export const CANVAS_ALT = CANVAS_IS_MAC ? 'Option' : 'Alt'

export type CanvasShortcutAction =
  | 'connect'
  | 'duplicate'
  | 'add'
  | 'selectTool'
  | 'panTool'
  | 'arrange'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'fitView'

export type CanvasShortcutBindings = Record<CanvasShortcutAction, string>

export const DEFAULT_CANVAS_SHORTCUTS: CanvasShortcutBindings = {
  connect: 'L',
  duplicate: 'Shift+D',
  add: 'N',
  selectTool: 'V',
  panTool: 'H',
  arrange: 'Alt+Shift+F',
  zoomIn: 'E',
  zoomOut: 'Q',
  resetZoom: '0',
  fitView: '1',
}

export const CANVAS_SHORTCUT_LABELS: Record<CanvasShortcutAction, string> = {
  connect: '连接选中的两个节点',
  duplicate: '生成副本',
  add: '添加节点',
  selectTool: '切换到选择工具',
  panTool: '切换到抓手工具',
  arrange: '整理节点',
  zoomIn: '放大画布',
  zoomOut: '缩小画布',
  resetZoom: '回到 100%',
  fitView: '适应视图',
}

/** 由浏览器、文本编辑或画布固定操作占用，不允许用户覆盖。 */
export const CANVAS_RESERVED_SHORTCUTS = new Set([
  'Mod+Z',
  'Mod+Shift+Z',
  'Mod+Y',
  'Mod+F',
  'Mod+A',
  'Mod+C',
  'Mod+V',
  'Mod+G',
  'Mod+Shift+G',
  'Mod+Alt+G',
  'Mod+Enter',
  'Delete',
  'Backspace',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift'])
const RESERVED_KEYS = new Set(['Tab', 'Escape'])

export function shortcutFromKeyboardEvent(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): string | null {
  if (MODIFIER_KEYS.has(event.key) || RESERVED_KEYS.has(event.key)) return null
  const rawKey = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Mod')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(rawKey)
  return parts.join('+')
}

export function matchesCanvasShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  binding: string,
): boolean {
  return shortcutFromKeyboardEvent(event) === binding
}

export function formatCanvasShortcut(binding: string): string {
  return binding
    .replace(/^Mod(?=\+|$)/, CANVAS_MOD)
    .replace(/\+/g, ' + ')
    .replace(/Alt/g, CANVAS_ALT)
}

/** 表单、按钮、媒体和弹层保留自己的键盘行为。 */
const CANVAS_KEYBOARD_EXCLUSIONS =
  'input, textarea, select, button, a, video, audio, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="dialog"], [role="menu"], [data-canvas-keyboard="ignore"]'

export function isCanvasShortcutTarget(root: HTMLElement | null, target: EventTarget | null): boolean {
  return Boolean(
    root && target instanceof Element && root.contains(target) && !target.closest(CANVAS_KEYBOARD_EXCLUSIONS),
  )
}

export function canUseCanvasShortcuts(root: HTMLElement | null, target: EventTarget | null, blocked = false): boolean {
  return (
    !blocked &&
    !document.querySelector('[aria-modal="true"]:not([aria-hidden="true"])') &&
    isCanvasShortcutTarget(root, document.activeElement) &&
    isCanvasShortcutTarget(root, target)
  )
}

/** 避开地址栏、收藏和 Tab 焦点导航的默认组合键。 */
export function resolveCanvasCreationShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  bindings: CanvasShortcutBindings = DEFAULT_CANVAS_SHORTCUTS,
): 'connect' | 'duplicate' | 'add' | null {
  if (matchesCanvasShortcut(event, bindings.connect)) return 'connect'
  if (matchesCanvasShortcut(event, bindings.duplicate)) return 'duplicate'
  if (matchesCanvasShortcut(event, bindings.add)) return 'add'
  return null
}
