/**
 * 画布元素 ↔ nodes/edges 序列化映射
 *
 * 将 ReactFlow 的 nodes/edges 映射为 /api/v1/canvases 的元素 mutation（upsert/delete），
 * 以及把云端元素 payload 还原为 nodes/edges。
 *
 * 元素结构（对齐 Swagger httpapi.canvasElementMutationRequest）：
 *   { element_id, kind, op: 'upsert'|'delete', payload }
 * - 节点：kind='node'，element_id=node.id，payload 含 type/position/data/style
 * - 连线：kind='edge'，element_id=edge.id，payload 含 source/target/handles/data
 * - 文本内容：随 node payload 一并持久化（text 节点在渲染期写入 window.__canvasTextContents）
 *
 * 与 localStorage 草稿（canvasDraft.ts）字段结构保持一致，保证两种存储可互相迁移。
 */
import type { Node, Edge } from '@xyflow/react'
import type { CanvasElementMutation } from '@/api/canvasApi'
import {
  inferCanvasConnectionRole,
  normalizeCanvasAssetSource,
  type CanvasAssetSource,
  type CanvasConnectionRole,
} from '@/utils/canvasGeneration'
import type { SmartRealPersonReference } from '@/utils/smartRealPerson'
import type { TimelineState } from '@/utils/timelineClips'

/** 节点可序列化字段白名单：排除 ReactFlow 运行态字段（selected/measured/dragging 等）。 */
interface SerializableNodeData {
  kind?: string
  /**
   * 用户手动命名的节点名；未改名时不写该字段，标题回退到「类型名 + 内容摘要」。
   *
   * 存空缺而不是存默认名：默认名是随内容变化的派生值（改了提示词、换了素材，
   * 摘要就该跟着变），一旦把它固化成字段就再也跟不上内容了。
   */
  title?: string
  ratio?: string
  videoMode?: string
  modelVersionId?: number
  assetId?: number
  assetSource?: CanvasAssetSource
  assetWorkspaceId?: number
  resultUrl?: string
  prompt?: string
  /** 节点选定的 operation_code（生成时写入，刷新后可直接复用） */
  operationCode?: string
  /** 节点 params_schema 参数（生成时写入，刷新后回显/复用） */
  params?: Record<string, unknown>
  /** 最近一次生成任务 ID（在途/已完成均可，用于刷新后续轮询） */
  taskId?: number
  /** 最近一次任务状态 */
  taskStatus?: string
  /** 最近一次任务进度（0-100，后端未提供时可为空） */
  taskProgress?: number
  /** 最近一次任务失败原因 */
  taskError?: string
  taskStartedAt?: string
  /** 最近一次任务更新时间 */
  taskUpdatedAt?: string
  /** 该节点素材来自真人素材库时的身份引用（含认证与授权信息），用于生成前回查与身份约束注入 */
  realPerson?: SmartRealPersonReference
  /** 剪辑时间线节点的片段表（顺序/裁剪/静音），是该节点唯一的业务内容 */
  timeline?: TimelineState
  /**
   * 所属分组的 id；未分组时不写该字段。
   *
   * 分组刻意做在 data 上而不是 React Flow 原生的 parentId：后者是节点顶层字段，
   * 要走这条路得同时改 nodeToMutation / elementToNode / comparableNode / 撤销快照，
   * 而那正是 409 乐观锁合并所在的一层。挂在 data 上则复用这里已有的全部机制。
   */
  groupId?: string
  /** 分组名；与 groupId 一样冗余存在每个成员上（画布只按节点持久化，没有分组实体） */
  groupName?: string
}

/**
 * 需要持久化的节点 data 字段，云端 mutation / 增量 diff / 本地草稿共用同一份。
 *
 * 曾经三处各写一份硬编码字段表，新增字段漏掉任意一处就会静默丢数据——
 * realPerson 和 timeline 都踩过。下面的 exhaustive 断言让漏字段在 tsc 阶段就报错。
 */
export const PERSISTED_NODE_DATA_FIELDS = [
  'kind',
  'title',
  'ratio',
  'videoMode',
  'modelVersionId',
  'assetId',
  'assetSource',
  'assetWorkspaceId',
  'resultUrl',
  'prompt',
  'operationCode',
  'params',
  'taskId',
  'taskStatus',
  'taskProgress',
  'taskError',
  'taskStartedAt',
  'taskUpdatedAt',
  'realPerson',
  'timeline',
  'groupId',
  'groupName',
] as const satisfies readonly (keyof SerializableNodeData)[]

/**
 * 编译期穷尽性检查：SerializableNodeData 新增字段而没进上面的数组时，这里立刻报错。
 * 运行时没有任何开销，纯类型断言。
 */
type MissingPersistedField = Exclude<keyof SerializableNodeData, (typeof PERSISTED_NODE_DATA_FIELDS)[number]>
const _assertAllNodeDataFieldsPersisted: MissingPersistedField extends never ? true : never = true
void _assertAllNodeDataFieldsPersisted

/** 按白名单挑出可持久化字段，丢弃 undefined/null 与 ReactFlow 运行态字段。 */
export function pickPersistedNodeData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of PERSISTED_NODE_DATA_FIELDS) {
    const value = data[key]
    if (value !== undefined && value !== null) out[key] = value
  }
  return out
}

/** 与 textContents 无关的节点可比较快照（含 id，供增量 diff 比较，排除 ReactFlow 运行态字段）。 */
export interface ComparableNode {
  id: string
  type?: string
  position?: { x: number; y: number }
  data?: Record<string, unknown>
  style?: Record<string, unknown>
}

/** 与 textContents 无关的连线可比较快照（含 id，供增量 diff 比较）。 */
export interface ComparableEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  data?: Record<string, unknown>
}

export interface CanvasGraphSourceRef {
  kind: string
  sourceId: string
  edgeId: string
  slotIndex: number
  thumbnailUrl?: string
  /**
   * 视频来源的封面帧地址。
   * 视频的 thumbnailUrl 是 mp4 地址，塞进 <img> 只会得到一个碎图图标，
   * 因此单独带上封面；没有封面时由展示层自行取首帧兜底。
   */
  posterUrl?: string
  assetId?: number
  source?: CanvasAssetSource
  workspaceId?: number
  role?: CanvasConnectionRole
  /** 该素材是否通过文本等中间节点向上追溯得到。 */
  inherited?: boolean
  /** 来源节点素材取自真人素材库时的身份引用；下游生成据此注入身份约束并置顶该图。 */
  realPerson?: SmartRealPersonReference
}

/**
 * 血缘边：只表示「这个节点是从那个节点产出的」，不参与任何生成输入。
 *
 * 画布上的边默认都是「上游素材喂给下游生成」。截帧图与源视频的关系正好相反——
 * 图是视频的产物，不是视频的输入；而且 allowedSourceKinds 里 image 根本不接受 video 来源，
 * 手动也连不出这条线。所以它必须带标记，让收集参考链路、统计数量上限的地方一律跳过。
 * 标记写在 edge.data 里，随画布元素一起持久化，刷新后仍然是血缘边。
 */
export function isCanvasProvenanceEdge(edge: { data?: Record<string, unknown> | null } | null | undefined): boolean {
  return Boolean(edge?.data?.provenance)
}

/**
 * 收集目标节点的完整参考链路。
 *
 * 直接文本来源会被保留用于拼接提示词；文本节点上游的图片/视频素材也会继续
 * 传递给下游生成任务。这样「参考图 -> 文本 -> 图片」不会在文本节点处丢失参考图。
 * 遍历包含循环保护，并按素材 ID 去重，避免异常连线导致重复提交。
 */
export function collectCanvasSourceRefs(
  targetNodeId: string,
  nodes: Array<Pick<Node, 'id' | 'type' | 'data'>>,
  edges: Array<Pick<Edge, 'id' | 'source' | 'target' | 'data'>>,
): CanvasGraphSourceRef[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const incomingByTarget = new Map<string, Array<Pick<Edge, 'id' | 'source' | 'target' | 'data'>>>()
  for (const edge of edges) {
    const incoming = incomingByTarget.get(edge.target) || []
    incoming.push(edge)
    incomingByTarget.set(edge.target, incoming)
  }
  for (const incoming of incomingByTarget.values()) {
    incoming.sort((a, b) => Number(a.data?.slotIndex || 0) - Number(b.data?.slotIndex || 0))
  }

  const refs: CanvasGraphSourceRef[] = []
  const seenEdges = new Set<string>()
  const seenAssets = new Set<number>()
  const visiting = new Set<string>()

  const visit = (nodeId: string, inherited: boolean) => {
    if (visiting.has(nodeId)) return
    visiting.add(nodeId)
    for (const edge of incomingByTarget.get(nodeId) || []) {
      if (seenEdges.has(edge.id)) continue
      seenEdges.add(edge.id)
      // 血缘边只记录「谁来自谁」，不是生成输入：截帧图连回源视频只为看清出处，
      // 顺着它把整条视频当成图片节点的 input_assets 发出去，模型只会报错
      if (isCanvasProvenanceEdge(edge)) continue
      const source = nodeById.get(edge.source)
      if (!source) continue
      const target = nodeById.get(nodeId)
      const data = (source.data || {}) as Record<string, unknown>
      const kind = String(data.kind || source.type || 'text')
      const targetData = (target?.data || {}) as Record<string, unknown>
      const slotIndex = Number(edge.data?.slotIndex || 0)
      const assetId = Number(data.assetId || 0)
      const ref: CanvasGraphSourceRef = {
        kind,
        sourceId: source.id,
        edgeId: edge.id,
        slotIndex,
        role: String(
          edge.data?.role ||
            inferCanvasConnectionRole({
              targetKind: String(targetData.kind || target?.type || 'text'),
              sourceKind: kind,
              videoMode: String(targetData.videoMode || ''),
              slotIndex,
            }),
        ) as CanvasConnectionRole,
        ...(data.resultUrl ? { thumbnailUrl: String(data.resultUrl) } : {}),
        ...(data.poster ? { posterUrl: String(data.poster) } : {}),
        ...(assetId > 0 ? { assetId } : {}),
        ...(data.assetSource || data.source || data.realPerson
          ? {
              source: normalizeCanvasAssetSource(
                data.assetSource || data.source || (data.realPerson ? 'real_person' : 'canvas'),
              ),
            }
          : {}),
        ...(Number(data.assetWorkspaceId || data.workspaceId) > 0
          ? { workspaceId: Number(data.assetWorkspaceId || data.workspaceId) }
          : {}),
        ...(inherited ? { inherited: true } : {}),
        // 真人身份必须随素材一路传到下游生成节点，经文本节点继承时同样不能丢。
        ...(data.realPerson ? { realPerson: data.realPerson as SmartRealPersonReference } : {}),
      }

      if (kind === 'text') {
        // 只有直接文本参与当前提示词拼接；其上游素材继续向下游透传。
        if (!inherited) refs.push(ref)
        visit(source.id, true)
      } else if (assetId <= 0 || !seenAssets.has(assetId)) {
        refs.push(ref)
        if (assetId > 0) seenAssets.add(assetId)
      }
    }
    visiting.delete(nodeId)
  }

  visit(targetNodeId, false)
  return refs
}

/**
 * 生成连线稳定 id：e-{source}-{target}-{slotIndex}。
 *
 * 不能依赖 React Flow addEdge 自动生成 id：默认格式
 * `xy-edge__{source}{sourceHandle}-{target}{targetHandle}` 会把源/目标 node id
 * 连同 handle 后缀（{nodeId}-right-source / {nodeId}-left-target）各拼接两次，
 * 实测可达 140+ bytes，超过后端 element_id 128 bytes 上限导致保存失败。
 * 本函数生成的 id 长度约 60 bytes，且对同一 (source, target, slotIndex) 唯一，
 * 与 handlePickRefNode / handleMenuSelect 的既有生成逻辑保持一致。
 */
export function buildEdgeId(sourceId: string, targetId: string, slotIndex: number | string): string {
  return `e-${sourceId}-${targetId}-${slotIndex}`
}

/**
 * 判断新增 source → target 是否会形成依赖环。
 *
 * 收集引用时虽然有 visiting 保护，但那只能避免递归卡死；业务上若允许环存在，某些输入会被
 * 静默丢弃，用户看到的连线与实际提交就不一致。连接前从 target 沿现有出边查到 source 即为成环。
 */
export function wouldCreateCanvasCycle(
  sourceId: string,
  targetId: string,
  edges: Array<Pick<Edge, 'source' | 'target'>>,
): boolean {
  if (!sourceId || !targetId || sourceId === targetId) return true
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    const targets = outgoing.get(edge.source) || []
    targets.push(edge.target)
    outgoing.set(edge.source, targets)
  }
  const pending = [targetId]
  const visited = new Set<string>()
  while (pending.length) {
    const nodeId = pending.pop() as string
    if (nodeId === sourceId) return true
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    pending.push(...(outgoing.get(nodeId) || []))
  }
  return false
}

/** 将节点序列化为可比较快照（排除 ReactFlow 运行态字段；text 由 textContents 并入，供增量 diff 精确比较）。 */
export function comparableNode(
  node: Node,
  textContents?: Map<string, string> | Record<string, string>,
): ComparableNode {
  const data = (node.data || {}) as SerializableNodeData & Record<string, unknown>
  const serializable = pickPersistedNodeData(data)
  // text 内容从 textContents 并入快照（文本编辑不经过 nodes/edges，需显式带上才能正确 diff）
  const textValue = textContents instanceof Map ? textContents.get(node.id) : textContents?.[node.id]
  if (typeof textValue === 'string' && textValue !== '') serializable.text = textValue
  const out: ComparableNode = {
    id: node.id,
    type: node.type || (typeof data.kind === 'string' ? data.kind : 'text'),
    position: node.position || { x: 0, y: 0 },
    data: serializable,
  }
  if (node.style) out.style = node.style as Record<string, unknown>
  return out
}

/** 将连线序列化为可比较快照（排除 ReactFlow 运行态字段）。 */
export function comparableEdge(edge: Edge): ComparableEdge {
  const out: ComparableEdge = { id: edge.id, source: edge.source, target: edge.target }
  if (edge.sourceHandle) out.sourceHandle = edge.sourceHandle
  if (edge.targetHandle) out.targetHandle = edge.targetHandle
  if (edge.data) out.data = edge.data as Record<string, unknown>
  return out
}

/** 将单个节点序列化为 upsert mutation payload。 */
export function nodeToMutation(
  node: Node,
  textContents?: Map<string, string> | Record<string, string>,
): CanvasElementMutation {
  const data = (node.data || {}) as SerializableNodeData & Record<string, unknown>
  // 只保留业务字段，避免把 ReactFlow 注入的运行态字段带上云端
  const serializable = pickPersistedNodeData(data)
  // 文本节点：把全局文本 Map 中的内容并入节点 data（文本编辑不经过 nodes/edges，需显式带上）
  const textValue = textContents instanceof Map ? textContents.get(node.id) : textContents?.[node.id]
  if (textValue !== undefined && textValue !== null && String(textValue) !== '') {
    serializable.text = String(textValue)
  }
  return {
    element_id: node.id,
    kind: 'node',
    op: 'upsert',
    payload: {
      // 后端校验要求 payload 必含 id（与 element_id 同值），否则返回 CANVAS_INVALID_INPUT
      id: node.id,
      type: node.type || (typeof data.kind === 'string' ? data.kind : 'text'),
      position: node.position || { x: 0, y: 0 },
      data: serializable,
      ...(node.style ? { style: node.style } : {}),
    },
  }
}

/** 将单个连线序列化为 upsert mutation payload。 */
export function edgeToMutation(edge: Edge): CanvasElementMutation {
  return {
    element_id: edge.id,
    kind: 'edge',
    op: 'upsert',
    payload: {
      // 后端校验要求 payload 必含 id（与 element_id 同值），否则返回 CANVAS_INVALID_INPUT
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      ...(edge.data ? { data: edge.data } : {}),
    },
  }
}

/** 由完整画布状态生成「全量 upsert」mutations（新画布首存 / 全量重拉后重放用）。 */
export function buildFullUpsertMutations(
  nodes: Node[],
  edges: Edge[],
  textContents?: Map<string, string> | Record<string, string>,
): CanvasElementMutation[] {
  return [...nodes.map((n) => nodeToMutation(n, textContents)), ...edges.map(edgeToMutation)]
}

/** 节点删除 mutation（服务端生成 tombstone）。 */
export function nodeDeleteMutation(nodeId: string): CanvasElementMutation {
  return { element_id: nodeId, kind: 'node', op: 'delete', payload: {} }
}

/** 连线删除 mutation（服务端生成 tombstone）。 */
export function edgeDeleteMutation(edgeId: string): CanvasElementMutation {
  return { element_id: edgeId, kind: 'edge', op: 'delete', payload: {} }
}

/** 由云端元素还原为节点（过滤删除 tombstone 与非法/占位元素）。 */
export function elementToNode(element: CanvasElementMutation): Node | null {
  // 首次全量加载（after_revision=0）返回的活元素不带 op 字段；op=delete 为 tombstone 需跳过
  if (element.kind !== 'node' || element.op === 'delete') return null
  const payload = (element.payload || {}) as Record<string, unknown>
  const data = (payload.data || {}) as SerializableNodeData & Record<string, unknown>
  const kind = String(data.kind || 'text')
  const id = String(element.element_id || '')
  if (!id) return null
  const nodeData = { ...data } as Record<string, unknown>
  // 云端持久化的文本内容还原到节点 data（渲染期由 CanvasDefaultNode 写入全局 Map）
  return {
    id,
    type: String(payload.type || kind),
    position: (payload.position as { x: number; y: number }) || { x: 0, y: 0 },
    data: nodeData as Record<string, unknown>,
    ...(payload.style ? { style: payload.style as Record<string, unknown> } : {}),
  }
}

/** 由云端元素还原为连线（过滤删除 tombstone 与非法/占位元素）。 */
export function elementToEdge(element: CanvasElementMutation): Edge | null {
  // 首次全量加载（after_revision=0）返回的活元素不带 op 字段；op=delete 为 tombstone 需跳过
  if (element.kind !== 'edge' || element.op === 'delete') return null
  const payload = (element.payload || {}) as Record<string, unknown>
  const id = String(element.element_id || '')
  const source = String(payload.source || '')
  const target = String(payload.target || '')
  if (!id || !source || !target) return null
  return {
    id,
    source,
    target,
    ...(payload.sourceHandle ? { sourceHandle: payload.sourceHandle as string } : {}),
    ...(payload.targetHandle ? { targetHandle: payload.targetHandle as string } : {}),
    ...(payload.data ? { data: payload.data as Record<string, unknown> } : {}),
  }
}

/** 从元素列表还原 nodes/edges（忽略 tombstone 与未知类型）。 */
export function elementsToGraph(elements: CanvasElementMutation[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  for (const element of elements || []) {
    if (element.kind === 'node') {
      const node = elementToNode(element)
      if (node) nodes.push(node)
    } else if (element.kind === 'edge') {
      const edge = elementToEdge(element)
      if (edge) edges.push(edge)
    }
  }
  return { nodes, edges }
}

/**
 * 把服务端的增量 mutation 应用到当前图。
 *
 * 与 elementsToGraph（全量恢复）不同，本函数保留未出现在本次增量里的本地元素；
 * 删除节点时同时清理其关联边，避免协作同步后留下悬空连线。
 */
export function applyCanvasElementMutations(
  current: { nodes: Node[]; edges: Edge[] },
  mutations: CanvasElementMutation[],
): { nodes: Node[]; edges: Edge[] } {
  const nodes = new Map(current.nodes.map((node) => [node.id, node]))
  const edges = new Map(current.edges.map((edge) => [edge.id, edge]))

  for (const mutation of mutations || []) {
    const id = String(mutation.element_id || '')
    if (!id) continue
    if (mutation.kind === 'node') {
      if (mutation.op === 'delete') {
        nodes.delete(id)
        for (const [edgeId, edge] of edges) {
          if (edge.source === id || edge.target === id) edges.delete(edgeId)
        }
      } else {
        const node = elementToNode(mutation)
        if (node) nodes.set(id, node)
      }
    } else if (mutation.kind === 'edge') {
      if (mutation.op === 'delete') edges.delete(id)
      else {
        const edge = elementToEdge(mutation)
        if (edge) edges.set(id, edge)
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

/**
 * 计算上一次已同步状态 → 当前状态的增量 mutations（对齐 5.6「只提交变化元素」）。
 *
 * - 新增/变更的节点、连线 → `upsert`（text 内容由 textContents 并入节点快照一并比较）
 * - 已消失（被删除）的节点、连线 → `delete`
 *
 * 注意：传入的 prevSynced 快照必须已经含文本（由 comparableNode(node, textContents) 生成），
 * 否则文本变化会被漏判/误判。
 */
export function diffCanvasMutations(
  prevSynced: { nodes: ComparableNode[]; edges: ComparableEdge[] },
  current: { nodes: Node[]; edges: Edge[] },
  textContents?: Map<string, string> | Record<string, string>,
): CanvasElementMutation[] {
  const mutations: CanvasElementMutation[] = []
  const prevNodes = new Map(prevSynced.nodes.map((n) => [n.id, n]))
  const prevEdges = new Map(prevSynced.edges.map((e) => [e.id, e]))
  const textMap = textContents instanceof Map ? textContents : new Map(Object.entries(textContents || {}))

  // 节点 diff：新增/变更（结构或文本）→ upsert；消失 → delete
  const seenNodeIds = new Set<string>()
  for (const node of current.nodes) {
    seenNodeIds.add(node.id)
    const prev = prevNodes.get(node.id)
    const curr = comparableNode(node, textMap)
    if (!prev || JSON.stringify(prev) !== JSON.stringify(curr)) {
      mutations.push(nodeToMutation(node, textMap))
    }
  }
  for (const prev of prevSynced.nodes) {
    if (!seenNodeIds.has(prev.id)) {
      mutations.push(nodeDeleteMutation(prev.id))
    }
  }

  // 连线 diff：新增/变更 → upsert；消失 → delete
  const seenEdgeIds = new Set<string>()
  for (const edge of current.edges) {
    seenEdgeIds.add(edge.id)
    const prev = prevEdges.get(edge.id)
    const curr = comparableEdge(edge)
    if (!prev || JSON.stringify(prev) !== JSON.stringify(curr)) {
      mutations.push(edgeToMutation(edge))
    }
  }
  for (const prev of prevSynced.edges) {
    if (!seenEdgeIds.has(prev.id)) {
      mutations.push(edgeDeleteMutation(prev.id))
    }
  }

  return mutations
}
