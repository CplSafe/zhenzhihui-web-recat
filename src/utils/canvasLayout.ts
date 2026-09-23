/**
 * 一键整理布局：把一批节点按连线方向排成从左到右的分层。
 *
 * 画布上的图是「来源 → 生成」的有向图，天然分层：没有上游的排第一列，
 * 每个节点放在它所有上游之后的那一列（最长路径层号）。同一列内按原来的纵向顺序摆，
 * 用户手工排出的上下关系尽量保留。孤立节点（没有任何连线）放到最后一列，
 * 免得散在各列之间把结构搅乱。
 *
 * 不引入 dagre/elk：画布只有几种节点、边也只有一个方向，几十行就够；
 * 省下的是一个几十 KB 的依赖和 check:bundle 的预算。
 * 纯函数，只算位置不碰状态；有环时把回边忽略，不会死循环。
 */

export interface LayoutNode {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutEdge {
  source: string
  target: string
}

export interface LayoutOptions {
  /** 列间距（px，画布坐标） */
  hGap?: number
  /** 同列节点的上下间距 */
  vGap?: number
}

const DEFAULT_H_GAP = 100
const DEFAULT_V_GAP = 60

/**
 * 计算每个节点的新位置；整体左上角对齐到这批节点原本的包围盒左上角，
 * 整理是「就地排整齐」，不是把东西搬到别处。
 */
export function computeLayeredLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>()
  if (!nodes.length) return result
  const hGap = options.hGap ?? DEFAULT_H_GAP
  const vGap = options.vGap ?? DEFAULT_V_GAP

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const node of nodes) {
    incoming.set(node.id, [])
    outgoing.set(node.id, [])
  }
  for (const edge of edges) {
    // 只认两端都在这批节点里的连线：整理选中的一部分时，外面的连线不该拖着它们走
    if (!byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target) continue
    outgoing.get(edge.source)!.push(edge.target)
    incoming.get(edge.target)!.push(edge.source)
  }

  // 层号 = 到它的最长路径长度。DFS 记忆化；栈上再次碰到（环）按 0 处理，等于忽略这条回边。
  const rank = new Map<string, number>()
  const onStack = new Set<string>()
  const rankOf = (id: string): number => {
    const cached = rank.get(id)
    if (cached !== undefined) return cached
    if (onStack.has(id)) return 0
    onStack.add(id)
    let value = 0
    for (const parent of incoming.get(id) || []) value = Math.max(value, rankOf(parent) + 1)
    onStack.delete(id)
    rank.set(id, value)
    return value
  }

  const connected = nodes.filter((node) => incoming.get(node.id)!.length || outgoing.get(node.id)!.length)
  const isolated = nodes.filter((node) => !incoming.get(node.id)!.length && !outgoing.get(node.id)!.length)
  connected.forEach((node) => rankOf(node.id))

  const columns: LayoutNode[][] = []
  for (const node of connected) {
    const column = rank.get(node.id) || 0
    while (columns.length <= column) columns.push([])
    columns[column].push(node)
  }
  if (isolated.length) columns.push(isolated)

  const originX = Math.min(...nodes.map((node) => node.x))
  const originY = Math.min(...nodes.map((node) => node.y))
  let columnX = originX
  for (const column of columns) {
    if (!column.length) continue
    // 同列按原纵向顺序，纵向相同再按横向，保证结果稳定可预期
    column.sort((a, b) => a.y - b.y || a.x - b.x)
    let rowY = originY
    let columnWidth = 0
    for (const node of column) {
      result.set(node.id, { x: columnX, y: rowY })
      rowY += node.height + vGap
      columnWidth = Math.max(columnWidth, node.width)
    }
    columnX += columnWidth + hGap
  }
  return result
}
