import type { Node } from '@xyflow/react'
import { calcNodeSize } from '@/utils/canvasNodeSize'
import { assetStreamUrl } from '@/utils/assetUrl'

/** 当前这一批的耐久素材 ID；历史批次留在 resultHistory，不混入当前组图。 */
export function canvasImageResultIds(data: Record<string, unknown>): number[] {
  const raw = Array.isArray(data.imageResultAssetIds) ? data.imageResultAssetIds : []
  const ids = [...new Set(raw.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
  // 从素材库替换图片后，旧组图不能覆盖新素材。
  return ids.includes(Number(data.assetId)) ? ids : []
}

export function canvasImageResultSize(data: Record<string, unknown>) {
  const single = calcNodeSize(String(data.ratio || '1:1'), 250)
  const ids = canvasImageResultIds(data)
  if (!data.imageResultsExpanded || ids.length < 2) return single
  const rows = Math.ceil(ids.length / 2)
  return { width: single.width * 2 + 12, height: single.height * rows + 12 * (rows - 1) }
}

export function updateCanvasImageResultNode(node: Node, patch: Record<string, unknown>): Node {
  const data = { ...node.data, ...patch }
  return { ...node, data, style: { ...node.style, ...canvasImageResultSize(data) } }
}

/** 主图是节点本身的 assetId，既是折叠封面，也是下游引用和默认下载的素材。 */
export function selectCanvasImageResult(node: Node, assetId: number, workspaceId: number): Node {
  if (!canvasImageResultIds(node.data).includes(assetId)) return node
  return updateCanvasImageResultNode(node, { assetId, resultUrl: assetStreamUrl(assetId, workspaceId) })
}

/** 保留原节点及它的下游连线，其余结果变成独立节点；调用者统一记录撤销。 */
export function splitCanvasImageResults(node: Node, workspaceId: number, makeId: () => string): Node[] {
  const ids = canvasImageResultIds(node.data)
  if (ids.length < 2) return [node]
  const primary = Number(node.data.assetId)
  const ordered = [primary, ...ids.filter((id) => id !== primary)]
  const size = calcNodeSize(String(node.data.ratio || '1:1'), 250)
  return ordered.map((assetId, index) => ({
    ...node,
    id: index === 0 ? node.id : makeId(),
    selected: index === 0,
    measured: undefined,
    position: {
      x: node.position.x + (index % 2) * (size.width + 40),
      y: node.position.y + Math.floor(index / 2) * (size.height + 70),
    },
    data: {
      ...node.data,
      assetId,
      resultUrl: assetStreamUrl(assetId, workspaceId),
      imageResultAssetIds: [],
      imageResultsExpanded: false,
    },
    style: { ...node.style, ...size },
  }))
}
