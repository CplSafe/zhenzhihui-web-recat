/**
 * 从节点侧边的「加号」拖出连线后，松手处落在哪个节点上。
 *
 * 连接点本体被压成 0×0（见 CanvasView.css 的 .react-flow__handle），React Flow 自身只在
 * 指针贴近连接点（connectionRadius）时才会认目标；松手落在节点卡片正中间时它给不出目标。
 * 但用户的直觉是「拖到那个节点上就连上」，所以这里补一层落点判定：
 *
 *   ① 落在某个节点卡片内部 → 连到它（从哪一侧进由源节点位置决定，取更短的那条走线）；
 *   ② 落在某个节点左右连接点附近（卡片外 handleOffset 处的方框）→ 连到该侧连接点；
 *   ③ 都没命中 → 返回 null，调用方在松手处弹「添加下一步」菜单。
 *
 * 全部用屏幕坐标（getBoundingClientRect 与鼠标 clientX/clientY 同一坐标系），
 * 所以连接点的偏移量和判定半径要按当前缩放换算。纯函数，便于直接测几何分支——
 * jsdom 里跑不了真实指针拖拽。
 */

/** 连线接到目标节点的哪一侧。 */
export type CanvasConnectDropSide = 'left' | 'right'

/** 参与落点判定的节点卡片（屏幕坐标，与 getBoundingClientRect 一致）。 */
export interface CanvasNodeScreenRect {
  nodeId: string
  left: number
  right: number
  top: number
  bottom: number
}

/** 命中的目标节点及其接入侧。 */
export interface CanvasConnectDropTarget {
  nodeId: string
  side: CanvasConnectDropSide
}

export interface ResolveCanvasConnectDropArgs {
  /** 松手处的屏幕坐标。 */
  point: { x: number; y: number }
  /** 拖线起点所在节点，永远不作为自己的目标。 */
  sourceId: string
  /**
   * 源节点中心的屏幕横坐标，用于决定落在卡片内部时从左还是右接入：
   * 源在目标左边就从左侧进，反之从右侧进，连线不必绕过整张卡片。
   * 读不到时退化为按落点相对卡片中心判断。
   */
  sourceCenterX?: number
  /** 候选节点卡片，按渲染顺序（靠后的在上层）。 */
  rects: readonly CanvasNodeScreenRect[]
  /** 当前画布缩放，用于把下面两个 CSS 像素量换算到屏幕像素。 */
  zoom: number
  /** 连接点中心相对卡片边缘的外移距离（CSS px，与 .canvas-handle-mover 的 margin 对应）。 */
  handleOffset?: number
  /** 连接点判定方框的半边长（CSS px）。 */
  handleRadius?: number
}

const DEFAULT_HANDLE_OFFSET = 30
const DEFAULT_HANDLE_RADIUS = 65

/** 松手处命中的连线目标；没命中返回 null。 */
export function resolveCanvasConnectDropTarget(args: ResolveCanvasConnectDropArgs): CanvasConnectDropTarget | null {
  const { x, y } = args.point || { x: Number.NaN, y: Number.NaN }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null

  const zoom = Number.isFinite(args.zoom) && Number(args.zoom) > 0 ? Number(args.zoom) : 1
  const offset = (args.handleOffset ?? DEFAULT_HANDLE_OFFSET) * zoom
  const radius = (args.handleRadius ?? DEFAULT_HANDLE_RADIUS) * zoom
  const candidates = (args.rects || []).filter((rect) => rect && rect.nodeId && rect.nodeId !== args.sourceId)

  // ① 卡片内部优先：重叠时取最后渲染的那个（它盖在上面，也就是用户看到并瞄准的那个）
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const rect = candidates[index]
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue
    const centerX = (rect.left + rect.right) / 2
    const from = Number.isFinite(args.sourceCenterX) ? Number(args.sourceCenterX) : x
    return { nodeId: rect.nodeId, side: from <= centerX ? 'left' : 'right' }
  }

  // ② 连接点附近：瞄的是具体某一侧的加号，就按那一侧接入
  for (const rect of candidates) {
    const centerY = (rect.top + rect.bottom) / 2
    if (Math.abs(y - centerY) >= radius) continue
    if (Math.abs(x - (rect.right + offset)) < radius) return { nodeId: rect.nodeId, side: 'right' }
    if (Math.abs(x - (rect.left - offset)) < radius) return { nodeId: rect.nodeId, side: 'left' }
  }

  return null
}
