/** 分组作为整体、独立工作流分区、双向重心排序、孤立素材网格。 */
export interface LayoutNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  groupId?: string
}
export interface LayoutEdge {
  source: string
  target: string
}
export interface LayoutOptions {
  hGap?: number
  vGap?: number
}
type Position = { x: number; y: number }
type Block = LayoutNode & { members: Map<string, Position> }
const compare = (a: LayoutNode, b: LayoutNode) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id)

function layoutFlow(nodes: LayoutNode[], edges: LayoutEdge[], hGap: number, vGap: number): Map<string, Position> {
  const incoming = new Map(nodes.map((n) => [n.id, new Set<string>()]))
  const outgoing = new Map(nodes.map((n) => [n.id, new Set<string>()]))
  for (const e of edges) {
    if (e.source === e.target || !incoming.has(e.source) || !incoming.has(e.target)) continue
    incoming.get(e.target)!.add(e.source)
    outgoing.get(e.source)!.add(e.target)
  }
  const ranks = new Map<string, number>()
  const visiting = new Set<string>()
  const rankOf = (id: string): number => {
    if (ranks.has(id)) return ranks.get(id)!
    if (visiting.has(id)) return 0
    visiting.add(id)
    let rank = 0
    for (const parent of incoming.get(id)!) rank = Math.max(rank, rankOf(parent) + 1)
    visiting.delete(id)
    ranks.set(id, rank)
    return rank
  }
  const columns: LayoutNode[][] = []
  // 环的断边顺序固定，不能受上一次整理后的位置影响，否则重复整理会左右翻转。
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) (columns[rankOf(node.id)] ??= []).push(node)
  const ordered = columns.filter(Boolean)
  const positions = new Map<string, Position>()
  let x = 0
  for (const column of ordered) {
    let y = 0
    column.sort(compare)
    for (const node of column) {
      positions.set(node.id, { x, y })
      y += node.height + vGap
    }
    x += Math.max(...column.map((n) => n.width)) + hGap
  }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const center = (id: string) => positions.get(id)!.y + byId.get(id)!.height / 2
  // 双向扫描：邻居中心决定顺序，按真实高度排开，再纠正碰撞引起的整列偏移。
  for (let pass = 0; pass < 6; pass++) {
    const forward = pass % 2 === 0
    for (const column of forward ? ordered : [...ordered].reverse()) {
      const desired = new Map<string, number>()
      for (const node of column) {
        const neighbors = [...(forward ? incoming : outgoing).get(node.id)!]
        desired.set(
          node.id,
          neighbors.length ? neighbors.reduce((s, id) => s + center(id), 0) / neighbors.length : center(node.id),
        )
      }
      column.sort((a, b) => desired.get(a.id)! - desired.get(b.id)! || compare(a, b))
      let bottom = -Infinity
      for (const node of column) {
        const p = positions.get(node.id)!
        p.y = Math.max(desired.get(node.id)! - node.height / 2, bottom)
        bottom = p.y + node.height + vGap
      }
      const offset = column.reduce((s, n) => s + desired.get(n.id)! - center(n.id), 0) / column.length
      for (const node of column) positions.get(node.id)!.y += offset
    }
  }
  const minY = Math.min(...Array.from(positions.values(), (p) => p.y))
  for (const p of positions.values()) p.y -= minY
  return positions
}

/** 纯函数：保留包围盒左上角，仅计算新位置，不改变内容、连线和分组。 */
export function computeLayeredLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {},
): Map<string, Position> {
  const result = new Map<string, Position>()
  if (!nodes.length) return result
  const hGap = Math.max(0, options.hGap ?? 100)
  const vGap = Math.max(0, options.vGap ?? 60)
  const sectionGap = Math.max(120, hGap, vGap * 2)
  const ids = new Set(nodes.map((n) => n.id))
  const validEdges = edges.filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target))
  const groups = new Map<string, LayoutNode[]>()
  const blocks: Block[] = []
  const blockByNode = new Map<string, string>()
  for (const node of nodes) {
    const key = node.groupId ? `group:${node.groupId}` : `node:${node.id}`
    const group = groups.get(key) || []
    group.push(node)
    groups.set(key, group)
    blockByNode.set(node.id, key)
  }
  for (const [id, members] of groups) {
    // 先整理组内；去掉标记避免再次折叠同一组。
    const local =
      members.length > 1
        ? computeLayeredLayout(
            members.map((n) => ({ ...n, groupId: undefined })),
            validEdges,
            options,
          )
        : new Map([[members[0].id, { x: members[0].x, y: members[0].y }]])
    const minX = Math.min(...Array.from(local.values(), (p) => p.x))
    const minY = Math.min(...Array.from(local.values(), (p) => p.y))
    const padding = members[0].groupId ? 24 : 0
    const positions = new Map<string, Position>()
    let width = 0
    let height = 0
    for (const node of members) {
      const p = local.get(node.id)!
      const offset = { x: p.x - minX + padding, y: p.y - minY + padding }
      positions.set(node.id, offset)
      width = Math.max(width, offset.x + node.width + padding)
      height = Math.max(height, offset.y + node.height + padding)
    }
    blocks.push({
      id,
      groupId: members[0].groupId,
      x: Math.min(...members.map((n) => n.x)),
      y: Math.min(...members.map((n) => n.y)),
      width,
      height,
      members: positions,
    })
  }
  const blockEdges = validEdges
    .map((e) => ({ source: blockByNode.get(e.source)!, target: blockByNode.get(e.target)! }))
    .filter((e) => e.source !== e.target)
  const neighbors = new Map(blocks.map((b) => [b.id, new Set<string>()]))
  for (const e of blockEdges) {
    neighbors.get(e.source)!.add(e.target)
    neighbors.get(e.target)!.add(e.source)
  }
  const lookup = new Map(blocks.map((b) => [b.id, b]))
  const visited = new Set<string>()
  const sections: { nodes: Block[]; positions: Map<string, Position>; width: number; height: number }[] = []
  const isolated: Block[] = []
  for (const block of [...blocks].sort(compare)) {
    if (visited.has(block.id)) continue
    if (!neighbors.get(block.id)!.size && !block.groupId && block.members.size === 1) {
      isolated.push(block)
      continue
    }
    const queue = [block.id]
    visited.add(block.id)
    const members: Block[] = []
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]
      members.push(lookup.get(id)!)
      for (const next of neighbors.get(id)!) {
        if (visited.has(next)) continue
        visited.add(next)
        queue.push(next)
      }
    }
    const positions = layoutFlow(members, blockEdges, hGap, vGap)
    sections.push({
      nodes: members,
      positions,
      width: Math.max(...members.map((n) => positions.get(n.id)!.x + n.width)),
      height: Math.max(...members.map((n) => positions.get(n.id)!.y + n.height)),
    })
  }
  const originX = Math.min(...nodes.map((n) => n.x))
  const originY = Math.min(...nodes.map((n) => n.y))
  const place = (block: Block, x: number, y: number) => {
    for (const [id, p] of block.members) result.set(id, { x: originX + x + p.x, y: originY + y + p.y })
  }
  const area = sections.reduce((s, b) => s + (b.width + sectionGap) * (b.height + sectionGap), 0)
  const targetWidth = Math.max(0, ...sections.map((b) => b.width), Math.sqrt(area * 1.6))
  let x = 0
  let y = 0
  let rowHeight = 0
  let usedWidth = 0
  for (const section of sections) {
    if (x > 0 && x + section.width > targetWidth) {
      x = 0
      y += rowHeight + sectionGap
      rowHeight = 0
    }
    for (const block of section.nodes) {
      const p = section.positions.get(block.id)!
      place(block, x + p.x, y + p.y)
    }
    usedWidth = Math.max(usedWidth, x + section.width)
    x += section.width + sectionGap
    rowHeight = Math.max(rowHeight, section.height)
  }
  // 未连线素材在流程下方按实际尺寸换行。
  const gridWidth = Math.max(
    usedWidth,
    Math.sqrt(isolated.reduce((s, n) => s + (n.width + hGap) * (n.height + vGap), 0) * 1.6),
  )
  x = 0
  y = sections.length ? y + rowHeight + sectionGap : 0
  rowHeight = 0
  for (const block of isolated) {
    if (x > 0 && x + block.width > gridWidth) {
      x = 0
      y += rowHeight + vGap
      rowHeight = 0
    }
    place(block, x, y)
    x += block.width + hGap
    rowHeight = Math.max(rowHeight, block.height)
  }
  // 分组边距只参与避让，不让重复整理把整张画布逐次推远。
  const shiftX = Math.min(...Array.from(result.values(), (p) => p.x)) - originX
  const shiftY = Math.min(...Array.from(result.values(), (p) => p.y)) - originY
  for (const p of result.values()) {
    p.x = Math.round(p.x - shiftX)
    p.y = Math.round(p.y - shiftY)
  }
  return result
}
