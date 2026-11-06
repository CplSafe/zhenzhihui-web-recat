/**
 * 无限画布 · 节点分组的纯逻辑层
 *
 * 分组用 data.groupId 标记成员，而不是 React Flow 原生的 parentId。
 * 原因是 parentId / extent 都是节点的顶层字段，不在本项目的持久化白名单里
 * （见 canvasElements.ts 的 PERSISTED_NODE_DATA_FIELDS 与 nodeToMutation），
 * 走原生分组要同时改序列化、增量 diff、撤销快照四处——那是 409 乐观锁合并所在的一层，
 * 风险远超分组本身的收益。groupId 挂在 data 上则完全复用既有机制。
 *
 * 「一起移动」不靠父子容器实现：选中组内任一节点即展开为选中整组，
 * React Flow 现成的多选拖拽就会把它们一起搬走。
 */

/** 参与分组计算的最小节点形状，避免这一层依赖 React Flow 的类型 */
export interface GroupableNode {
  id: string
  position: { x: number; y: number }
  /**
   * React Flow 的实测尺寸。节点真实占多大以它为准——
   * 顶层 width/height 是「用户显式指定的尺寸」，本项目并不写，多数节点上是空的。
   */
  measured?: { width?: number | null; height?: number | null } | null
  /** 本项目给节点尺寸用的是 style.width/height（见 calcNodeSize 的写入点） */
  style?: { width?: number | string | null; height?: number | string | null } | null
  width?: number
  height?: number
  data?: Record<string, unknown> | null
}

/** 一个分组在画布坐标系下的包围盒 */
export interface GroupBounds {
  groupId: string
  /** 分组名；用户没改过时为空串，由展示层决定兜底文案 */
  name: string
  x: number
  y: number
  width: number
  height: number
  memberCount: number
}

/** 分组框相对成员包围盒向外扩出的留白（画布坐标） */
export const GROUP_FRAME_PADDING = 18

/** 节点缺少实测尺寸时的兜底，与画布默认节点尺寸一致 */
const FALLBACK_NODE_SIZE = 250

/**
 * 读节点的真实占位尺寸。
 *
 * 取值顺序与画布其它算尺寸的地方保持一致：measured → style → 顶层 width/height → 兜底。
 * 只看顶层 width/height 会漏掉几乎所有节点——React Flow v12 把实测值放在 measured 上，
 * 顶层那两个字段只在调用方显式指定时才有值，本项目并不写。
 * 漏读的后果是每个成员都按 250 计算，分组框比真实内容小一圈，节点露在框外。
 */
function readNodeSize(node: GroupableNode): { width: number; height: number } {
  const pick = (...candidates: unknown[]): number => {
    for (const candidate of candidates) {
      const value = Number(candidate)
      if (Number.isFinite(value) && value > 0) return value
    }
    return FALLBACK_NODE_SIZE
  }
  return {
    width: pick(node.measured?.width, node.style?.width, node.width),
    height: pick(node.measured?.height, node.style?.height, node.height),
  }
}

/** 读节点的分组标记；未分组返回空串 */
export function getNodeGroupId(node: GroupableNode | null | undefined): string {
  const raw = (node?.data as Record<string, unknown> | undefined)?.groupId
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * 读分组名。
 *
 * 名字与 groupId 一样冗余存在每个成员的 data 上，而不是另立一张分组表：
 * 画布的持久化是「按节点逐个 upsert」的，独立的分组实体没有承载它的地方，
 * 而冗余存储让改名和删成员都只是普通的节点更新，走既有的增量同步即可。
 */
export function getNodeGroupName(node: GroupableNode | null | undefined): string {
  const raw = (node?.data as Record<string, unknown> | undefined)?.groupName
  return typeof raw === 'string' ? raw.trim() : ''
}

/** 分组在界面上的显示名：用户没起名时退回带序号的默认名 */
export function formatGroupLabel(name: string, memberCount: number): string {
  return name || `分组（${memberCount}）`
}

/**
 * 生成分组 id。
 *
 * 与节点 id 同样的防冲突思路（时间戳 + 序号 + 随机串）：同一毫秒内连续打组不会撞号。
 */
let groupIdSequence = 0
export function createGroupId(): string {
  groupIdSequence = (groupIdSequence + 1) % 1000
  return `group-${Date.now()}-${groupIdSequence}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 把选中的节点展开为「这些节点所属分组的全部成员」。
 *
 * 这是分组能一起移动的关键：点中组内一个节点就选中整组，
 * 拖拽随即由 React Flow 的多选逻辑接管，不需要自己算位移。
 * 未分组的节点原样保留。
 */
export function expandSelectionToGroups(nodes: readonly GroupableNode[], selectedIds: readonly string[]): string[] {
  if (!selectedIds.length) return []
  const wanted = new Set(selectedIds)
  const groupIds = new Set<string>()
  for (const node of nodes) {
    if (!wanted.has(node.id)) continue
    const groupId = getNodeGroupId(node)
    if (groupId) groupIds.add(groupId)
  }
  if (!groupIds.size) return [...selectedIds]

  const expanded = new Set(selectedIds)
  for (const node of nodes) {
    if (groupIds.has(getNodeGroupId(node))) expanded.add(node.id)
  }
  return [...expanded]
}

/**
 * 选中的这批节点是否已经构成一个完整分组。
 *
 * 用于决定批量条上该给「打组」还是「解组」：只有当选中的正好是某个分组的全部成员时
 * 才是「解组」，否则都按「打组」处理（把它们重新归到一个新组里）。
 */
export function isCompleteGroupSelection(nodes: readonly GroupableNode[], selectedIds: readonly string[]): boolean {
  if (selectedIds.length < 2) return false
  const wanted = new Set(selectedIds)
  const selected = nodes.filter((node) => wanted.has(node.id))
  if (selected.length !== wanted.size) return false

  const groupId = getNodeGroupId(selected[0])
  if (!groupId) return false
  if (selected.some((node) => getNodeGroupId(node) !== groupId)) return false
  // 组里还有没被选中的成员 → 这是「部分选中」，不能当解组处理
  return nodes.filter((node) => getNodeGroupId(node) === groupId).length === selected.length
}

/** 每个分组的包围盒，供画分组框使用；成员少于 2 个的分组不出框 */
export function getGroupBounds(nodes: readonly GroupableNode[]): GroupBounds[] {
  const byGroup = new Map<string, GroupableNode[]>()
  for (const node of nodes) {
    const groupId = getNodeGroupId(node)
    if (!groupId) continue
    const list = byGroup.get(groupId)
    if (list) list.push(node)
    else byGroup.set(groupId, [node])
  }

  const out: GroupBounds[] = []
  for (const [groupId, members] of byGroup) {
    // 单个成员的「分组」没有意义：可能是别的成员被删光了，这时不该再画一个框
    if (members.length < 2) continue
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const member of members) {
      const { width, height } = readNodeSize(member)
      minX = Math.min(minX, member.position.x)
      minY = Math.min(minY, member.position.y)
      maxX = Math.max(maxX, member.position.x + width)
      maxY = Math.max(maxY, member.position.y + height)
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) continue
    // 名字取第一个有值的成员：改名会写到全部成员上，成员间不一致只可能是
    // 增量同步中途的瞬时状态，这时取到哪个都不影响最终一致
    const name = members.map(getNodeGroupName).find(Boolean) || ''
    out.push({
      groupId,
      name,
      x: minX - GROUP_FRAME_PADDING,
      y: minY - GROUP_FRAME_PADDING,
      width: maxX - minX + GROUP_FRAME_PADDING * 2,
      height: maxY - minY + GROUP_FRAME_PADDING * 2,
      memberCount: members.length,
    })
  }
  // 按 groupId 排序，保证渲染顺序稳定，避免每次重排导致的无谓重绘
  return out.sort((left, right) => left.groupId.localeCompare(right.groupId))
}
