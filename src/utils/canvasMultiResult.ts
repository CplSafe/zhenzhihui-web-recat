/**
 * 一次生成多张图（模型 schema 的「生成数量」> 1）时，把多出来的结果落成画布上的独立节点。
 *
 * 节点只有一个 resultUrl / assetId：原节点放第 1 张，第 2..N 张各建一个兄弟节点，
 * 复制原节点的输入连线（同一批参考、同一条提示词生成的，血缘要看得出来），
 * 并按网格紧挨原节点摆好，避开画布上已有的节点——用户不用手动整理。
 *
 * 纯函数，不读写全局状态，由 CanvasView 在任务完成时调用。
 */

export interface CanvasRect {
  x: number
  y: number
  width: number
  height: number
}

/** 节点之间留的间距；节点上方有一行标题，纵向要比横向多留一点。 */
export const MULTI_RESULT_GAP_X = 40
export const MULTI_RESULT_GAP_Y = 56
/** 一行最多摆几张：再宽就容易铺出视口，竖着往下长更好浏览。 */
export const MULTI_RESULT_MAX_COLUMNS = 3
/** 找空位时最多向下挪多少行，防止极端画布上死循环。 */
const MAX_SHIFT_ROWS = 60

const overlaps = (a: CanvasRect, b: CanvasRect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

/**
 * 为 count 个与 source 同尺寸的结果节点排出位置。
 *
 * 网格（最多 3 列）整体放在原节点右侧、顶边对齐；那里被占就整块向下挪一行再试；
 * 右侧一直放不下时改放原节点正下方，同样向下找空位。障碍物按「网格整体」判断，
 * 保证 N 张图始终排成一个整齐的块，而不是被已有节点冲散。
 */
export function planMultiResultPositions(
  source: CanvasRect,
  count: number,
  obstacles: readonly CanvasRect[],
): Array<{ x: number; y: number }> {
  if (!(count > 0)) return []
  const columns = Math.min(count, MULTI_RESULT_MAX_COLUMNS)
  const rows = Math.ceil(count / columns)
  const stepX = source.width + MULTI_RESULT_GAP_X
  const stepY = source.height + MULTI_RESULT_GAP_Y
  const blockWidth = columns * stepX - MULTI_RESULT_GAP_X
  const blockHeight = rows * stepY - MULTI_RESULT_GAP_Y

  const anchors = [
    { x: source.x + stepX, y: source.y },
    { x: source.x, y: source.y + stepY },
  ]
  // 留一圈间距再判碰撞，块和已有节点不会贴在一起
  const padded = obstacles.map((rect) => ({
    x: rect.x - MULTI_RESULT_GAP_X / 2,
    y: rect.y - MULTI_RESULT_GAP_Y / 2,
    width: rect.width + MULTI_RESULT_GAP_X,
    height: rect.height + MULTI_RESULT_GAP_Y,
  }))

  let origin = anchors[0]
  search: for (const anchor of anchors) {
    for (let shift = 0; shift <= MAX_SHIFT_ROWS; shift += 1) {
      const candidate = { x: anchor.x, y: anchor.y + shift * stepY }
      const block = { ...candidate, width: blockWidth, height: blockHeight }
      if (!padded.some((rect) => overlaps(block, rect))) {
        origin = candidate
        break search
      }
    }
  }

  return Array.from({ length: count }, (_, index) => ({
    x: origin.x + (index % columns) * stepX,
    y: origin.y + Math.floor(index / columns) * stepY,
  }))
}
