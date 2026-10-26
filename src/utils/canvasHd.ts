import type { Edge, Node } from '@xyflow/react'
import type { HdItem, HdKind, HdQuote, HdSource, HdTarget, HdTask } from '@/api/canvasHd'
import { assetStreamUrl } from './assetUrl'
import { findFreeNodePosition } from './canvasNodePlacement'

export const HD_STATUS_LABELS = {
  queued: '排队中',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}
export const isHdActive = (task: HdTask) => task.status === 'queued' || task.status === 'processing'

export function hdSources(nodes: Node[]): HdSource[] {
  return nodes.flatMap((node) => {
    const data = node.data
    const kind: HdKind | undefined =
      data.kind === 'image' ? 'image' : data.kind === 'video' || data.kind === 'timeline' ? 'video' : undefined
    if (!kind) return []
    return [
      {
        node_id: node.id,
        asset_id: Number(data.assetId) || 0,
        kind,
        name: String(data.title || (kind === 'image' ? '图片' : '视频')),
      },
    ]
  })
}
/** 服务端必须为每个输入返回一条结果；缺项/重复项不能静默下单。 */
export function validateHdPreflight(sources: HdSource[], items: HdItem[]): HdItem[] {
  if (!Array.isArray(items) || items.length !== sources.length) throw new Error('高清处理校验结果不完整，请重新选择')
  return sources.map((source) => {
    const matches = items.filter(
      (item) => item.node_id === source.node_id && item.asset_id === source.asset_id && item.kind === source.kind,
    )
    if (matches.length !== 1 || !Array.isArray(matches[0].resolutions) || !Array.isArray(matches[0].frame_rates))
      throw new Error('高清处理校验结果不完整，请重新选择')
    return { ...matches[0], ...source }
  })
}
/** 服务端返回的有序档位交集，默认第一项即所有源件共同支持的最低可提升档。 */
export function hdTargets(items: HdItem[]) {
  const eligible = items.filter((item) => item.eligible)
  return {
    resolutions: eligible.length
      ? eligible[0].resolutions.filter((value) => eligible.every((item) => item.resolutions.includes(value)))
      : [],
    frameRates: eligible.length
      ? eligible[0].frame_rates.filter(
          (value) => value !== 30 && eligible.every((item) => item.frame_rates.includes(value)),
        )
      : [],
  }
}
export function validateHdQuote(quote: HdQuote, items: HdItem[], target: HdTarget): boolean {
  if (!quote || !quote.quote_id || !(Date.parse(quote.expires_at) > Date.now()) || !items.length) return false
  const options = hdTargets(items)
  if (
    !options.resolutions.includes(target.resolution) ||
    (target.fps !== 0 && !options.frameRates.includes(target.fps))
  )
    return false
  if (
    !Number.isFinite(quote.balance) ||
    quote.balance < 0 ||
    !Number.isFinite(quote.total_credits) ||
    quote.total_credits < 0 ||
    !Array.isArray(quote.items) ||
    quote.items.length !== items.length
  )
    return false
  if (
    !items.every(
      (item) =>
        quote.items.filter(
          (row) =>
            row.node_id === item.node_id &&
            row.asset_id === item.asset_id &&
            Number.isFinite(row.credits) &&
            row.credits >= 0,
        ).length === 1,
    )
  )
    return false
  return Math.abs(quote.items.reduce((sum, item) => sum + item.credits, 0) - quote.total_credits) < 0.000001
}

/** 固定 ID + 去重确保重复轮询不会重复建节点。只追加新产物，不改源件/剪辑引用。 */
export function materializeHdResults(
  nodes: Node[],
  edges: Edge[],
  tasks: HdTask[],
  workspaceId: number,
  canvasId: number,
  delivered: ReadonlySet<string> = new Set(),
) {
  const nextNodes = [...nodes]
  const nextEdges = [...edges]
  let changed = false
  for (const task of tasks) {
    if (
      task.workspace_id !== workspaceId ||
      task.canvas_id !== canvasId ||
      (!task.id.startsWith('submission-') && task.status !== 'completed') ||
      task.result?.canvas_delivery === 'removed' ||
      delivered.has(task.id) ||
      (task.status === 'completed' && (!Number.isSafeInteger(task.result?.asset_id) || task.result.asset_id <= 0))
    )
      continue
    const id = `hd-result-${task.id}`
    const existing = nextNodes.findIndex((node) => node.id === id)
    const resultData = {
      taskStatus: task.status === 'completed' ? 'succeeded' : task.status,
      taskId: task.task_id || 0,
      taskError: task.status === 'failed' ? task.error || '超分失败，请重新选择原图重试' : '',
      ...(task.result
        ? {
            title: task.result.name,
            assetId: task.result.asset_id,
            ...(task.source.kind === 'image'
              ? {
                  imageOrigin: {
                    assetId: task.result.asset_id,
                    kind: 'upscale' as const,
                    ...(task.image_info ? { info: task.image_info } : {}),
                  },
                }
              : {}),
            assetWorkspaceId: workspaceId,
            resultUrl: assetStreamUrl(task.result.asset_id, workspaceId),
          }
        : {}),
    }
    if (existing >= 0) {
      const node = nextNodes[existing]
      if (
        Object.entries(resultData).some(([key, value]) =>
          key === 'imageOrigin' ? JSON.stringify(node.data[key]) !== JSON.stringify(value) : node.data[key] !== value,
        )
      ) {
        nextNodes[existing] = { ...node, data: { ...node.data, ...resultData } }
        changed = true
      }
      continue
    }
    const source = nextNodes.find((node) => node.id === task.source.node_id)
    if (!source) continue
    const width = Number(source.style?.width) || 320
    const height = Number(source.style?.height) || 260
    const position = findFreeNodePosition({
      anchor: { x: source.position.x, y: source.position.y + height + 80 },
      size: { width, height },
      occupied: nextNodes.map((node) => ({
        x: node.position.x,
        y: node.position.y,
        width: Number(node.style?.width) || 320,
        height: Number(node.style?.height) || 260,
      })),
    })
    nextNodes.push({
      id,
      type: task.source.kind,
      position,
      style: { width, height },
      data: {
        kind: task.source.kind,
        title: `${task.source.name}超分`,
        ...resultData,
        ratio:
          task.result?.width > 0 && task.result?.height > 0
            ? `${task.result.width}:${task.result.height}`
            : source.data.ratio,
        hd: {
          taskId: task.id,
          sourceNodeId: source.id,
          sourceAssetId: task.source.asset_id,
          sourceSpec: task.source_spec,
          spec: task.result?.spec,
          reviewPolicy: task.result?.review_policy,
        },
      },
    })
    const edgeId = `hd-lineage-${task.id}`
    if (!nextEdges.some((edge) => edge.id === edgeId))
      nextEdges.push({
        id: edgeId,
        source: source.id,
        target: id,
        type: 'default',
        style: { stroke: '#35a66f', strokeDasharray: '6 4' },
        data: { provenance: true, hdLineage: true },
        selectable: true,
      })
  }
  return {
    nodes: nextNodes,
    edges: nextEdges,
    changed: changed || nextNodes.length !== nodes.length || nextEdges.length !== edges.length,
  }
}
