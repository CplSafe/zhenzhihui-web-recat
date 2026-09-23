/**
 * 画布个性化偏好（localStorage）。
 *
 * 这些都是「我怎么用画布」的本机习惯，不是画布内容：不进云端、不按画布隔离——
 * 用户把滚轮改成缩放，是对所有画布说的，逐画布记会让他每开一张都得再改一次。
 * 小地图开关先于这份偏好存在（见 canvasSelection 的 MINIMAP_KEY），沿用旧键不迁移。
 */

export type CanvasWheelMode = 'pan' | 'zoom'
export type CanvasPaneMenuTrigger = 'contextmenu' | 'dblclick'

export interface CanvasPreferences {
  /** 滚轮默认动作：平移画布（设计工具习惯）还是缩放（图编辑器习惯） */
  wheelMode: CanvasWheelMode
  /** 空白处弹「添加节点」菜单的手势 */
  paneMenuTrigger: CanvasPaneMenuTrigger
  /** 拖动节点时显示与其它节点的对齐辅助线并吸附 */
  alignmentGuides: boolean
  /** 鼠标悬停连线时高亮它 */
  edgeHoverHighlight: boolean
  /** 只把与选中节点相连的连线画清楚，其余淡化 */
  focusEdgesOnly: boolean
  /** 生成完成后发浏览器通知（切到别的标签页也能收到） */
  notifyOnComplete: boolean
  /** 生成失败也通知 */
  notifyOnFail: boolean
  /** 通知时播放提示音 */
  notifySound: boolean
}

export const DEFAULT_CANVAS_PREFERENCES: CanvasPreferences = {
  wheelMode: 'pan',
  paneMenuTrigger: 'contextmenu',
  alignmentGuides: true,
  edgeHoverHighlight: true,
  focusEdgesOnly: false,
  notifyOnComplete: false,
  notifyOnFail: true,
  notifySound: true,
}

const STORAGE_KEY = 'zzh_canvas_preferences'

const WHEEL_MODES: readonly CanvasWheelMode[] = ['pan', 'zoom']
const MENU_TRIGGERS: readonly CanvasPaneMenuTrigger[] = ['contextmenu', 'dblclick']

/**
 * 把任意输入收敛成合法偏好：未知字段丢弃、类型不对的回落默认值。
 * 存储里可能是旧版本写的、也可能被手改过，宽松读、严格出。
 */
export function normalizeCanvasPreferences(raw: unknown): CanvasPreferences {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bool = (key: keyof CanvasPreferences): boolean =>
    typeof source[key] === 'boolean' ? (source[key] as boolean) : (DEFAULT_CANVAS_PREFERENCES[key] as boolean)
  return {
    wheelMode: WHEEL_MODES.includes(source.wheelMode as CanvasWheelMode)
      ? (source.wheelMode as CanvasWheelMode)
      : DEFAULT_CANVAS_PREFERENCES.wheelMode,
    paneMenuTrigger: MENU_TRIGGERS.includes(source.paneMenuTrigger as CanvasPaneMenuTrigger)
      ? (source.paneMenuTrigger as CanvasPaneMenuTrigger)
      : DEFAULT_CANVAS_PREFERENCES.paneMenuTrigger,
    alignmentGuides: bool('alignmentGuides'),
    edgeHoverHighlight: bool('edgeHoverHighlight'),
    focusEdgesOnly: bool('focusEdgesOnly'),
    notifyOnComplete: bool('notifyOnComplete'),
    notifyOnFail: bool('notifyOnFail'),
    notifySound: bool('notifySound'),
  }
}

export function loadCanvasPreferences(): CanvasPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CANVAS_PREFERENCES }
    return normalizeCanvasPreferences(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_CANVAS_PREFERENCES }
  }
}

export function saveCanvasPreferences(prefs: CanvasPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCanvasPreferences(prefs)))
  } catch {
    // 隐私模式/存储写满时忽略：记不住偏好不影响画布本身可用
  }
}
