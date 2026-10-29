import { hasOpenCanvasModal } from './canvasModal'

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
  | 'panHold'
  | 'zoomWheel'
  | 'generate'
  | 'undo'
  | 'redo'
  | 'group'
  | 'ungroup'
  | 'search'
  | 'delete'
  | 'timelinePlay'
  | 'timelineSplit'
  | 'timelineRippleDelete'
  | 'timelineBack'
  | 'timelineForward'
  | 'timelineBackSecond'
  | 'timelineForwardSecond'

export type CanvasShortcutBindings = Record<CanvasShortcutAction, string>

export const DEFAULT_CANVAS_SHORTCUTS: CanvasShortcutBindings = {
  connect: 'Mod+L',
  duplicate: 'Mod+D',
  add: 'Tab',
  selectTool: 'V',
  panTool: 'H',
  arrange: 'Alt+Shift+F',
  zoomIn: 'Mod+=',
  zoomOut: 'Mod+-',
  resetZoom: 'Mod+1',
  fitView: 'Mod+0',
  panHold: 'Space',
  zoomWheel: 'Mod+Wheel',
  generate: 'Mod+Enter',
  undo: 'Mod+Z',
  redo: 'Mod+Shift+Z',
  group: 'Mod+G',
  ungroup: 'Mod+Shift+G',
  search: 'Mod+F',
  delete: 'Delete',
  timelinePlay: 'Space',
  timelineSplit: 'C',
  timelineRippleDelete: 'B',
  timelineBack: 'ArrowLeft',
  timelineForward: 'ArrowRight',
  timelineBackSecond: 'Shift+ArrowLeft',
  timelineForwardSecond: 'Shift+ArrowRight',
}

export const CANVAS_SHORTCUT_LABELS: Record<CanvasShortcutAction, string> = {
  connect: '连接选中的两个节点',
  duplicate: '复制节点和连线',
  add: '添加节点',
  selectTool: '切换到选择工具',
  panTool: '切换到抓手工具',
  arrange: '整理节点',
  zoomIn: '放大画布',
  zoomOut: '缩小画布',
  resetZoom: '回到 100%',
  fitView: '适应视图',
  panHold: '临时平移画布（按住并拖动）',
  zoomWheel: '滚轮缩放画布',
  generate: '生成当前节点',
  undo: '撤销',
  redo: '重做',
  group: '成组',
  ungroup: '解组',
  search: '画布节点搜索',
  delete: '删除节点和连线',
  timelinePlay: '时间线：播放 / 暂停',
  timelineSplit: '时间线：分割',
  timelineRippleDelete: '时间线：波纹删除',
  timelineBack: '时间线：上一帧',
  timelineForward: '时间线：下一帧',
  timelineBackSecond: '时间线：后退 1 秒',
  timelineForwardSecond: '时间线：前进 1 秒',
}

/** 画布和时间线可复用按键，共同操作（撤销、重做、删除）占用两个作用域。 */
export function canvasShortcutScope(action: CanvasShortcutAction): 'canvas' | 'timeline' | 'both' {
  if (['undo', 'redo', 'delete'].includes(action)) return 'both'
  return action.startsWith('timeline') ? 'timeline' : 'canvas'
}

export function canvasShortcutConflicts(a: CanvasShortcutAction, b: CanvasShortcutAction): boolean {
  return (
    canvasShortcutScope(a) === 'both' ||
    canvasShortcutScope(b) === 'both' ||
    canvasShortcutScope(a) === canvasShortcutScope(b)
  )
}

export function canvasWheelActivationKeys(binding: string): string[] {
  return binding === 'Alt+Wheel' ? ['Alt'] : binding === 'Shift+Wheel' ? ['Shift'] : ['Control', 'Meta']
}

export function matchesCanvasAction(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  action: CanvasShortcutAction,
  bindings: CanvasShortcutBindings,
): boolean {
  if (matchesCanvasShortcut(event, bindings[action])) return true
  const alias =
    action === 'redo' && bindings.redo === DEFAULT_CANVAS_SHORTCUTS.redo
      ? 'Mod+Y'
      : action === 'delete' && bindings.delete === 'Delete'
        ? 'Backspace'
        : ''
  return Boolean(
    alias &&
    !Object.entries(bindings).some(
      ([other, key]) =>
        other !== action && canvasShortcutConflicts(action, other as CanvasShortcutAction) && key === alias,
    ) &&
    matchesCanvasShortcut(event, alias),
  )
}

export function resolveTimelineShortcutStep(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  bindings: CanvasShortcutBindings,
): number | null {
  if (matchesCanvasAction(event, 'timelineBack', bindings)) return -1 / 25
  if (matchesCanvasAction(event, 'timelineForward', bindings)) return 1 / 25
  if (matchesCanvasAction(event, 'timelineBackSecond', bindings)) return -1
  if (matchesCanvasAction(event, 'timelineForwardSecond', bindings)) return 1
  return null
}

export function canvasShortcutDisplayKeys(action: CanvasShortcutAction, bindings: CanvasShortcutBindings): string[] {
  const keys = [formatCanvasShortcut(bindings[action])]
  if (action === 'connect' && hasLegacySingleConnect(bindings)) keys.unshift('L')
  return keys
}

function hasLegacySingleConnect(bindings: CanvasShortcutBindings): boolean {
  return (
    bindings.connect === 'Mod+L' &&
    !Object.entries(bindings).some(
      ([action, key]) =>
        action !== 'connect' && canvasShortcutConflicts('connect', action as CanvasShortcutAction) && key === 'L',
    )
  )
}

/** 由浏览器、文本编辑或画布固定操作占用，不允许用户覆盖。 */
export const CANVAS_RESERVED_SHORTCUTS = new Set([
  'Mod+A',
  'Mod+C',
  'Mod+V',
  'Alt+G',
  'Alt+Shift+G',
  'Mod+Alt+G',
  'ArrowUp',
  'ArrowDown',
])

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift'])
const RESERVED_KEYS = new Set(['Escape'])

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

/** 在画布快捷键作用域内接管浏览器的加减缩放，兼容主键盘和小键盘。 */
export function resolveCanvasZoomShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  bindings: CanvasShortcutBindings = DEFAULT_CANVAS_SHORTCUTS,
): 'in' | 'out' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  if ((event.key === '+' || event.key === '=') && bindings.zoomIn === DEFAULT_CANVAS_SHORTCUTS.zoomIn) return 'in'
  if (event.key === '-' && bindings.zoomOut === DEFAULT_CANVAS_SHORTCUTS.zoomOut) return 'out'
  return null
}

export function formatCanvasShortcut(binding: string): string {
  return binding
    .replace(/^Mod(?=\+|$)/, CANVAS_MOD)
    .replace(/\+/g, ' + ')
    .replace(/Alt/g, CANVAS_ALT)
    .replace(/Space/g, '空格')
    .replace(/Wheel/g, '滚轮')
    .replace(/ArrowLeft/g, '←')
    .replace(/ArrowRight/g, '→')
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
    !hasOpenCanvasModal() &&
    isCanvasShortcutTarget(root, document.activeElement) &&
    isCanvasShortcutTarget(root, target)
  )
}

/** 创建命令按当前绑定匹配；调用方仅在画布快捷键作用域内接管。 */
export function resolveCanvasCreationShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  bindings: CanvasShortcutBindings = DEFAULT_CANVAS_SHORTCUTS,
): 'connect' | 'duplicate' | 'add' | null {
  if (hasLegacySingleConnect(bindings) && matchesCanvasShortcut(event, 'L')) return 'connect'
  if (matchesCanvasShortcut(event, bindings.connect)) return 'connect'
  if (matchesCanvasShortcut(event, bindings.duplicate)) return 'duplicate'
  if (matchesCanvasShortcut(event, bindings.add)) return 'add'
  return null
}
