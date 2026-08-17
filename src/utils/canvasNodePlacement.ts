/**
 * 新建画布节点的落点选择：从期望位置出发，找一个不与已有节点重叠的空位。
 *
 * 为什么需要它：新节点默认选中，而 React Flow 会把选中节点抬到 z-index:1000。
 * 一旦新节点落在已有节点上，被抬起来的那个（可能是旧节点，取决于谁选中）会把另一个
 * 整片盖住——刚建出来的节点连播放、精修、合成都点不到，看起来就是「新功能是坏的」。
 * 与其去调 z-index（那是 React Flow 的既定行为，改了会影响拖拽手感），
 * 不如从源头上不要让它们重叠。
 */

/** 参与占位判定的矩形；坐标为画布坐标系下的左上角。 */
export interface NodePlacementRect {
  x: number
  y: number
  width: number
  height: number
}

/** 相邻节点之间保留的视觉留白（px，画布坐标）。 */
const DEFAULT_GAP = 24
/** 每次向外试探的步长；取一个略大于常见节点宽度的值，避免一格一格挪太多轮。 */
const DEFAULT_STEP = 120
/** 最多向外扩几圈；超过就退回错开落点，不再无限找。 */
const DEFAULT_MAX_RINGS = 12

/** 两个矩形（按 gap 外扩后）是否相交。 */
function overlaps(a: NodePlacementRect, b: NodePlacementRect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
  )
}

/** 候选点是否与任何已有节点冲突。 */
function isFree(candidate: NodePlacementRect, occupied: readonly NodePlacementRect[], gap: number): boolean {
  return !occupied.some((rect) => overlaps(candidate, rect, gap))
}

/**
 * 以 anchor 为期望左上角，按方形螺旋向外找第一个空位。
 *
 * 螺旋而不是「一路向右」：向右单向排开会让画布越用越宽，最后横向拖不到头；
 * 螺旋能把新节点摊在四周，视觉重心仍留在原处。
 */
export function findFreeNodePosition(args: {
  anchor: { x: number; y: number }
  size: { width: number; height: number }
  occupied: readonly NodePlacementRect[]
  gap?: number
  step?: number
  maxRings?: number
}): { x: number; y: number } {
  const gap = args.gap ?? DEFAULT_GAP
  const step = args.step ?? DEFAULT_STEP
  const maxRings = args.maxRings ?? DEFAULT_MAX_RINGS
  const width = Math.max(1, Number(args.size.width) || 1)
  const height = Math.max(1, Number(args.size.height) || 1)
  const anchorX = Number(args.anchor.x) || 0
  const anchorY = Number(args.anchor.y) || 0
  const occupied = (args.occupied || []).filter(
    (rect) => rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.width > 0 && rect.height > 0,
  )

  if (isFree({ x: anchorX, y: anchorY, width, height }, occupied, gap)) {
    return { x: anchorX, y: anchorY }
  }

  for (let ring = 1; ring <= maxRings; ring += 1) {
    // 每圈按「右 → 下 → 左 → 上」取该圈边界上的候选点，先近后远
    for (let offset = -ring; offset <= ring; offset += 1) {
      const candidates = [
        { x: anchorX + ring * step, y: anchorY + offset * step },
        { x: anchorX + offset * step, y: anchorY + ring * step },
        { x: anchorX - ring * step, y: anchorY + offset * step },
        { x: anchorX + offset * step, y: anchorY - ring * step },
      ]
      for (const candidate of candidates) {
        if (isFree({ ...candidate, width, height }, occupied, gap)) return candidate
      }
    }
  }

  // 实在找不到（画布被铺满）：按已有节点数沿对角线错开，至少不要精确重叠
  const cascade = (occupied.length % 8) * 32
  return { x: anchorX + cascade, y: anchorY + cascade }
}
