/**
 * 画布列表封面：从画布元素里挑出「最后生成的那张图 / 那条视频」。
 *
 * 后端 /canvases 列表不返回封面字段，因此封面由前端从元素推导。
 * 元素按 revision 顺序返回，所以「数组里最后一个可用媒体节点」就是最近产出的那个。
 */
import type { CanvasElementMutation } from '@/api/canvasApi'
import { assetStreamUrl } from './assetUrl'

export interface CanvasCover {
  kind: 'image' | 'video'
  /** 同源流式地址：不会过期，可直接用作 img/video 的 src。 */
  url: string
}

/** 只认这两类节点作为封面；文本节点没有可展示的画面。 */
const COVER_KINDS = new Set(['image', 'video'])

/**
 * 选出封面。
 *
 * 优先使用 assetId 重建同源流式地址：节点里存的 resultUrl 可能是会过期的签名地址，
 * 也可能是刷新后即失效的 blob:，都不能作为列表封面长期使用。
 * 没有 assetId 时才退回 resultUrl，且必须是 http(s) 地址。
 */
export function pickCanvasCover(
  elements: readonly CanvasElementMutation[] | undefined,
  workspaceId: number,
): CanvasCover | null {
  if (!elements?.length) return null

  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index]
    // op=delete 是墓碑，节点已被删除，不能拿来做封面
    if (!element || element.kind !== 'node' || element.op === 'delete') continue

    const payload = (element.payload || {}) as Record<string, unknown>
    const data = (payload.data || {}) as Record<string, unknown>
    const kind = String(data.kind || payload.type || '')
    if (!COVER_KINDS.has(kind)) continue

    const assetId = Number(data.assetId || 0)
    if (Number.isSafeInteger(assetId) && assetId > 0) {
      const url = assetStreamUrl(assetId, workspaceId)
      if (url) return { kind: kind as CanvasCover['kind'], url }
    }

    const resultUrl = String(data.resultUrl || '').trim()
    if (/^https?:\/\//i.test(resultUrl)) return { kind: kind as CanvasCover['kind'], url: resultUrl }
  }

  return null
}
