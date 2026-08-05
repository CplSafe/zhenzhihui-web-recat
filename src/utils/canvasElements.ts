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

/** 节点可序列化字段白名单：排除 ReactFlow 运行态字段（selected/measured/dragging 等）。 */
interface SerializableNodeData {
  kind?: string
  ratio?: string
  videoMode?: string
  modelVersionId?: number
  assetId?: number
  resultUrl?: string
  prompt?: string
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

/** 将节点序列化为可比较快照（排除 ReactFlow 运行态字段；text 由 textContents 并入，供增量 diff 精确比较）。 */
export function comparableNode(
  node: Node,
  textContents?: Map<string, string> | Record<string, string>,
): ComparableNode {
  const data = (node.data || {}) as SerializableNodeData & Record<string, unknown>
  const serializable: Record<string, unknown> = {}
  const fields: Array<[string, unknown]> = [
    ['kind', data.kind],
    ['ratio', data.ratio],
    ['videoMode', data.videoMode],
    ['modelVersionId', data.modelVersionId],
    ['assetId', data.assetId],
    ['resultUrl', data.resultUrl],
    ['prompt', data.prompt],
  ]
  for (const [key, value] of fields) {
    if (value !== undefined && value !== null) serializable[key] = value
  }
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
  const serializable: Record<string, unknown> = {}
  // 只保留业务字段，避免把 ReactFlow 注入的运行态字段带上云端
  const fields: Array<[string, unknown]> = [
    ['kind', data.kind],
    ['ratio', data.ratio],
    ['videoMode', data.videoMode],
    ['modelVersionId', data.modelVersionId],
    ['assetId', data.assetId],
    ['resultUrl', data.resultUrl],
    ['prompt', data.prompt],
  ]
  for (const [key, value] of fields) {
    if (value !== undefined && value !== null) serializable[key] = value
  }
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
