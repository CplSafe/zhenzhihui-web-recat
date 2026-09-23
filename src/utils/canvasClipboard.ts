/**
 * 画布节点的复制 / 粘贴（Ctrl+C / Ctrl+V）。
 *
 * 剪贴板只活在内存里：节点数据带着 assetId、提示词、参数，塞进系统剪贴板既没意义
 * （别的应用读不懂）也会把 dataURL 封面之类的大块东西拷出去。系统粘贴事件仍留给
 * 「从外面粘图片文件」那条路（见 CanvasView 的 paste 监听），两者按剪贴板里有没有文件区分。
 *
 * 复制的是「配置 + 内容」，不是「正在跑的任务」：与生成副本同一口径，剥掉运行态字段，
 * 否则粘出来的节点会和原节点共用 taskId、一起轮询、把结果互相回写。
 * 被复制节点之间的连线一并带走——复制一条「图 → 视频」流程理应粘出一条流程，而不是两个孤点。
 * 纯函数；id 生成与连线 id 规则由调用方注入。
 */

export interface ClipboardNodeSnapshot {
  id: string
  type?: string
  kind: string
  /** 相对于这批节点包围盒左上角的位置 */
  dx: number
  dy: number
  data: Record<string, unknown>
  style?: Record<string, unknown>
  /** 文本节点正文（不在 data 里，单独存） */
  text?: string
}

export interface ClipboardEdgeSnapshot {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  data?: Record<string, unknown>
}

export interface CanvasClipboardPayload {
  nodes: ClipboardNodeSnapshot[]
  edges: ClipboardEdgeSnapshot[]
  /** 包围盒尺寸：粘贴落点要用它把这批节点居中到指针上 */
  width: number
  height: number
}

interface SourceNode {
  id: string
  type?: string
  position: { x: number; y: number }
  data?: Record<string, unknown>
  style?: Record<string, unknown>
  measured?: { width?: number; height?: number }
}

interface SourceEdge {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  data?: Record<string, unknown>
}

function sizeOf(node: SourceNode): { width: number; height: number } {
  const style = node.style || {}
  return {
    width: Number(style.width) || node.measured?.width || 250,
    height: Number(style.height) || node.measured?.height || 250,
  }
}

/** 把选中的节点（含它们之间的连线）打包成剪贴板内容；没有可复制的节点时返回 null */
export function copyCanvasNodes(options: {
  nodes: SourceNode[]
  edges: SourceEdge[]
  selectedIds: Iterable<string>
  /** 运行态字段名：不进剪贴板 */
  runtimeKeys: Set<string>
  /** 读文本节点正文 */
  readText?: (nodeId: string) => string | undefined
}): CanvasClipboardPayload | null {
  const wanted = new Set(options.selectedIds)
  const picked = options.nodes.filter((node) => wanted.has(node.id))
  if (!picked.length) return null

  const minX = Math.min(...picked.map((node) => node.position.x))
  const minY = Math.min(...picked.map((node) => node.position.y))
  const maxX = Math.max(...picked.map((node) => node.position.x + sizeOf(node).width))
  const maxY = Math.max(...picked.map((node) => node.position.y + sizeOf(node).height))

  const nodes: ClipboardNodeSnapshot[] = picked.map((node) => {
    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node.data || {})) {
      if (!options.runtimeKeys.has(key)) data[key] = value
    }
    // 分组是「这些节点属于画布上的某个组」，粘出来的副本不该自动混进原来的组里
    delete data.groupId
    delete data.groupName
    const text = options.readText?.(node.id)
    return {
      id: node.id,
      type: node.type,
      kind: String(data.kind || node.type || 'text'),
      dx: node.position.x - minX,
      dy: node.position.y - minY,
      data,
      style: node.style ? { ...node.style } : undefined,
      ...(typeof text === 'string' && text ? { text } : {}),
    }
  })

  const edges: ClipboardEdgeSnapshot[] = options.edges
    .filter((edge) => wanted.has(edge.source) && wanted.has(edge.target))
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      data: edge.data ? { ...edge.data } : undefined,
    }))

  return { nodes, edges, width: maxX - minX, height: maxY - minY }
}

export interface MaterializedClipboard {
  nodes: Array<{
    id: string
    type?: string
    position: { x: number; y: number }
    data: Record<string, unknown>
    style?: Record<string, unknown>
    selected: boolean
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle: string | null
    targetHandle: string | null
    data?: Record<string, unknown>
  }>
  /** 新节点 id → 文本正文 */
  textContents: Record<string, string>
}

/**
 * 把剪贴板内容落成可直接塞进画布的节点与连线。
 * `origin` 是这批节点包围盒左上角要落到的画布坐标；handle id 里带着旧节点 id，要一并换成新的。
 */
export function materializeCanvasClipboard(
  payload: CanvasClipboardPayload,
  options: {
    origin: { x: number; y: number }
    createNodeId: (kind: string) => string
    buildEdgeId: (source: string, target: string, slotIndex: number | string) => string
  },
): MaterializedClipboard {
  const idMap = new Map<string, string>()
  for (const node of payload.nodes) idMap.set(node.id, options.createNodeId(node.kind))

  const textContents: Record<string, string> = {}
  const nodes = payload.nodes.map((node) => {
    const id = idMap.get(node.id)!
    if (node.text) textContents[id] = node.text
    return {
      id,
      type: node.type,
      position: { x: options.origin.x + node.dx, y: options.origin.y + node.dy },
      data: { ...node.data },
      style: node.style ? { ...node.style } : undefined,
      selected: true,
    }
  })

  const swapHandle = (handle: string | null | undefined, oldId: string, newId: string): string | null =>
    typeof handle === 'string' && handle ? handle.split(oldId).join(newId) : null

  const edges = payload.edges.map((edge) => {
    const source = idMap.get(edge.source)!
    const target = idMap.get(edge.target)!
    const slotIndex = Number(edge.data?.slotIndex ?? 0) || 0
    return {
      id: options.buildEdgeId(source, target, slotIndex),
      source,
      target,
      sourceHandle: swapHandle(edge.sourceHandle, edge.source, source),
      targetHandle: swapHandle(edge.targetHandle, edge.target, target),
      data: edge.data ? { ...edge.data } : undefined,
    }
  })

  return { nodes, edges, textContents }
}
