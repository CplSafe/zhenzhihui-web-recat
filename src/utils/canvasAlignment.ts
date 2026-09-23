/**
 * 拖动节点时的对齐辅助线与吸附。
 *
 * 只比较边和中线：左/中/右、上/中/下各三条，与其它节点的同名线距离在阈值内就吸上去，
 * 并给出一条贯穿两者的辅助线让用户看见「吸到了谁」。阈值按屏幕像素给、由调用方除以缩放，
 * 否则缩小到 20% 时 8px 的吸附范围在画布坐标里就是 40px，节点会被隔老远的邻居拽走。
 *
 * 纯函数，坐标全是画布坐标；不依赖 React Flow。
 */

export interface AlignRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface AlignmentGuide {
  /** 'x' 是竖线（对齐的是横坐标），'y' 是横线 */
  axis: 'x' | 'y'
  /** 线所在的坐标 */
  position: number
  /** 线的起止（另一轴上的范围），只画到参与对齐的节点为止 */
  from: number
  to: number
}

export interface AlignmentResult {
  x: number
  y: number
  guides: AlignmentGuide[]
}

interface Candidate {
  /** 被移动节点上这条线相对其 x/y 的偏移 */
  offset: number
  /** 目标节点上这条线的坐标 */
  target: number
  /** 目标节点在另一轴上的范围，用于画线的起止 */
  spanFrom: number
  spanTo: number
}

function linesOf(rect: AlignRect, axis: 'x' | 'y'): number[] {
  return axis === 'x'
    ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
    : [rect.y, rect.y + rect.height / 2, rect.y + rect.height]
}

function resolveAxis(
  moving: AlignRect,
  others: AlignRect[],
  axis: 'x' | 'y',
  threshold: number,
): { position: number; guide: AlignmentGuide | null } {
  const origin = axis === 'x' ? moving.x : moving.y
  const movingLines = linesOf(moving, axis).map((line) => line - origin)
  let best: Candidate | null = null
  let bestDistance = Infinity

  for (const other of others) {
    if (other.id === moving.id) continue
    const otherLines = linesOf(other, axis)
    const spanFrom = axis === 'x' ? other.y : other.x
    const spanTo = axis === 'x' ? other.y + other.height : other.x + other.width
    for (const offset of movingLines) {
      for (const target of otherLines) {
        const distance = Math.abs(origin + offset - target)
        if (distance > threshold || distance >= bestDistance) continue
        bestDistance = distance
        best = { offset, target, spanFrom, spanTo }
      }
    }
  }

  if (!best) return { position: origin, guide: null }
  const position = best.target - best.offset
  const movingSpanFrom = axis === 'x' ? moving.y : moving.x
  const movingSpanTo = axis === 'x' ? moving.y + moving.height : moving.x + moving.width
  return {
    position,
    guide: {
      axis,
      position: best.target,
      from: Math.min(best.spanFrom, movingSpanFrom),
      to: Math.max(best.spanTo, movingSpanTo),
    },
  }
}

/**
 * 计算吸附后的位置与要画的辅助线。
 * 两轴独立：横向吸到 A 的左边、纵向吸到 B 的中线是常见情况，不要求同一个邻居。
 */
export function computeAlignment(moving: AlignRect, others: AlignRect[], threshold: number): AlignmentResult {
  if (!(threshold > 0) || others.length === 0) return { x: moving.x, y: moving.y, guides: [] }
  const horizontal = resolveAxis(moving, others, 'x', threshold)
  // 纵向用横向吸附后的矩形算，辅助线的起止才会盖住吸附后的位置
  const vertical = resolveAxis({ ...moving, x: horizontal.position }, others, 'y', threshold)
  const guides: AlignmentGuide[] = []
  if (horizontal.guide) guides.push(horizontal.guide)
  if (vertical.guide) guides.push(vertical.guide)
  return { x: horizontal.position, y: vertical.position, guides }
}
