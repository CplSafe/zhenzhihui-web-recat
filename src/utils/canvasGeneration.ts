export interface CanvasGenerationSourceRef {
  kind?: string
  assetId?: number
  slotIndex?: number
}

export type CanvasVideoMode = 'auto' | 'first-last' | 'full-ref'

export type CanvasConnectionRole = 'prompt' | 'reference_image' | 'first_frame' | 'last_frame' | 'source_video'

/** 连接语义只用于画布展示和持久化；提交时仍映射为后端已支持的 input_assets role。 */
export function inferCanvasConnectionRole(args: {
  targetKind?: string
  sourceKind?: string
  videoMode?: CanvasVideoMode | string
  slotIndex?: number
}): CanvasConnectionRole {
  if (args.sourceKind === 'text') return 'prompt'
  if (args.sourceKind === 'video') return 'source_video'
  if (args.targetKind === 'video' && args.videoMode === 'first-last') {
    return Number(args.slotIndex || 0) === 1 ? 'last_frame' : 'first_frame'
  }
  return 'reference_image'
}

export interface CanvasInputAsset {
  asset_id: number
  role: 'image' | 'reference_image'
}

/** 连线来源中可作为读图输入的最小信息。 */
export interface CanvasPolishImageRef {
  kind?: string
  assetId?: number
  thumbnailUrl?: string
}

/**
 * 从连线来源里挑出可交给 AI 润色的参考图，并保持 url 与 assetId 的下标对应（网关按下标配对）。
 *
 * 只取图片来源：视频来源不能作为读图输入，文本来源的内容已经拼进 prompt。
 * 润色缺图时只能凭空补出主体，产出的长描述会在图生图/图生视频里压过参考图并替换原主体，
 * 因此这里宁可多带、不可漏带。
 */
export function buildPolishImageRefs(refs: CanvasPolishImageRef[] | undefined): {
  images?: string[]
  imageAssetIds?: number[]
} {
  const usable = (refs || []).filter(
    (ref) => ref?.kind === 'image' && (Number(ref.assetId) > 0 || Boolean(String(ref.thumbnailUrl || '').trim())),
  )
  if (!usable.length) return {}

  return {
    images: usable.map((ref) => String(ref.thumbnailUrl || '').trim()),
    imageAssetIds: usable.map((ref) => Math.floor(Number(ref.assetId) || 0)),
  }
}

/** Keep task submission and cost estimation on the same input-assets contract. */
export function buildCanvasInputAssets(
  sourceRefs: CanvasGenerationSourceRef[],
  operationCode: string,
): CanvasInputAsset[] {
  const role = operationCode === 'image.image_to_image' ? 'reference_image' : 'image'

  return (sourceRefs || [])
    .filter((ref) => ref.kind !== 'text' && Number.isSafeInteger(Number(ref.assetId)) && Number(ref.assetId) > 0)
    .map((ref) => ({ asset_id: Number(ref.assetId), role }))
}

/**
 * Video generation accepts four input shapes:
 * text only, one first-frame image, first + last frames, or 1-5 full references.
 */
export function validateCanvasVideoInputs(args: {
  operationCode: string
  videoMode?: CanvasVideoMode
  sourceRefs: CanvasGenerationSourceRef[]
}): string | null {
  if (args.operationCode !== 'video.generate') return null

  const mediaRefs = (args.sourceRefs || []).filter((ref) => ref.kind !== 'text')
  if (mediaRefs.length === 0) return null

  const invalidRefs = mediaRefs.filter(
    (ref) => ref.kind !== 'image' || !Number.isSafeInteger(Number(ref.assetId)) || Number(ref.assetId) <= 0,
  )
  if (invalidRefs.length) return '视频生成仅支持已上传完成的图片作为参考素材，请检查连线后重试'

  if (args.videoMode === 'full-ref' || args.videoMode === 'auto') {
    return mediaRefs.length > 5 ? '自由生成和全能参考模式最多支持 5 张参考图片' : null
  }

  if (mediaRefs.length > 2) return '首尾帧模式最多支持首帧和尾帧两张参考图片'
  const slots = new Set(mediaRefs.map((ref) => Number(ref.slotIndex)))
  if (!slots.has(0)) return '添加一张参考图片时请将其放在首帧位置'
  if (mediaRefs.length === 2 && !slots.has(1)) return '添加两张参考图片时请同时提供首帧和尾帧'
  return null
}
