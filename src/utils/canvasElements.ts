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
import { inferCanvasConnectionRole, type CanvasConnectionRole } from '@/utils/canvasGeneration'
import type { SmartRealPersonReference } from '@/utils/smartRealPerson'

/** 节点可序列化字段白名单：排除 ReactFlow 运行态字段（selected/measured/dragging 等）。 */
interface SerializableNodeData {
  kind?: string
  ratio?: string
  videoMode?: string
  modelVersionId?: number
  assetId?: number
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
  assetId?: number
  role?: CanvasConnectionRole
  /** 该素材是否通过文本等中间节点向上追溯得到。 */
  inherited?: boolean
  /** 来源节点素材取自真人素材库时的身份引用；下游生成据此注入身份约束并置顶该图。 */
  realPerson?: SmartRealPersonReference
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
        ...(assetId > 0 ? { assetId } : {}),
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
    ['operationCode', data.operationCode],
    ['params', data.params],
    ['taskId', data.taskId],
    ['taskStatus', data.taskStatus],
    ['taskProgress', data.taskProgress],
    ['taskError', data.taskError],
    ['taskStartedAt', data.taskStartedAt],
    ['taskUpdatedAt', data.taskUpdatedAt],
    // 真人素材的身份引用：刷新后仍要能回查授权并继续注入身份约束，必须持久化。
    ['realPerson', data.realPerson],
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
    ['operationCode', data.operationCode],
    ['params', data.params],
    ['taskId', data.taskId],
    ['taskStatus', data.taskStatus],
    ['taskProgress', data.taskProgress],
    ['taskError', data.taskError],
    ['taskStartedAt', data.taskStartedAt],
    ['taskUpdatedAt', data.taskUpdatedAt],
    // 真人素材的身份引用：刷新后仍要能回查授权并继续注入身份约束，必须持久化。
    ['realPerson', data.realPerson],
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
