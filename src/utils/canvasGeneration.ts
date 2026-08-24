export interface CanvasGenerationSourceRef {
  kind?: string
  assetId?: number
  slotIndex?: number
  source?: CanvasAssetSource
  workspaceId?: number
}

export type CanvasAssetSource = 'canvas' | 'upload' | 'materials' | 'generated' | 'real_person' | 'unknown'

export function normalizeCanvasAssetSource(value: unknown): CanvasAssetSource {
  const source = String(value || '')
    .trim()
    .toLowerCase()
  if (source === 'real_person' || source === 'real-person' || source === 'realpeople') return 'real_person'
  if (source === 'materials' || source === 'material' || source === 'library') return 'materials'
  if (source === 'generated' || source === 'ai') return 'generated'
  if (source === 'upload' || source === 'uploaded' || source === 'local') return 'upload'
  if (source === 'canvas') return 'canvas'
  return 'unknown'
}

export function validateCanvasImageInputs(args: {
  operationCode: string
  sourceRefs: CanvasGenerationSourceRef[]
  workspaceId?: number
  /** 当前模型声明的参考图上限；缺省时不在这一层臆测。 */
  maxImageRefs?: number
}): string | null {
  if (args.operationCode !== 'image.image_to_image') return null
  const refs = args.sourceRefs || []
  const mediaRefs = refs.filter((ref) => ref.kind && ref.kind !== 'text')
  if (mediaRefs.some((ref) => ref.kind !== 'image')) {
    return '图生图仅支持图片素材，请移除视频或其他类型节点后重试'
  }
  const imageRefs = refs.filter((ref) => ref.kind === 'image')
  if (!imageRefs.length) return null
  if (Number(args.maxImageRefs) >= 0 && imageRefs.length > Number(args.maxImageRefs)) {
    return `当前模型最多支持 ${Number(args.maxImageRefs)} 张参考图片，请移除多余连线或切换模型`
  }
  if (imageRefs.some((ref) => !Number.isSafeInteger(Number(ref.assetId)) || Number(ref.assetId) <= 0)) {
    return '参考图片尚未上传完成，请稍候或重新选择图片后重试'
  }
  if (
    Number(args.workspaceId) > 0 &&
    imageRefs.some((ref) => Number(ref.workspaceId || 0) > 0 && Number(ref.workspaceId) !== Number(args.workspaceId))
  ) {
    return '参考图片不属于当前工作空间，请重新选择素材后重试'
  }
  return null
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
  if (isCanvasVideoSourceKind(args.sourceKind)) return 'source_video'
  if (args.targetKind === 'video' && args.videoMode === 'first-last') {
    return Number(args.slotIndex || 0) === 1 ? 'last_frame' : 'first_frame'
  }
  return 'reference_image'
}

export interface CanvasInputAsset {
  asset_id: number
  /** 素材角色。图片角色可由模型 schema 声明覆盖，因此不是固定枚举。 */
  role: string
}

/** 「以一条已有视频为输入」时使用的角色，与智能成片的视频生视频保持同一口径。 */
export const CANVAS_SOURCE_VIDEO_ROLE = 'video'

/**
 * 哪些来源算「一条视频」。
 * timeline 是多段合成后的结果，本身就是一条可继续加工的视频素材，与 video 同等对待。
 */
export function isCanvasVideoSourceKind(kind: string | undefined): boolean {
  return kind === 'video' || kind === 'timeline'
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

/**
 * Keep task submission and cost estimation on the same input-assets contract.
 *
 * 视频来源单独用 role:'video' 下发（视频生视频）：套上 image 角色后端会按参考图去读，
 * 轻则拒绝，重则当成静态参考图，生成结果完全不是「在这条视频上改」。
 *
 * @param selfVideoAssetId 目标节点自己已有的视频（在原片基础上改时作为源视频一并下发）
 * @param declaredImageRole 模型 schema 声明的素材角色（见 resolveModelInputAssetRole）；
 *   缺省时沿用历史的 image / reference_image。写死角色会在模型声明了非 image 角色时被后端拒绝，
 *   智能成片一直是按 schema 下发的，画布不跟上就会出现「同一模型这边行那边不行」。
 */
export function buildCanvasInputAssets(
  sourceRefs: CanvasGenerationSourceRef[],
  operationCode: string,
  selfVideoAssetId = 0,
  declaredImageRole = '',
): CanvasInputAsset[] {
  const imageRole =
    String(declaredImageRole || '').trim() || (operationCode === 'image.image_to_image' ? 'reference_image' : 'image')
  const seen = new Set<number>()
  const assets: CanvasInputAsset[] = []

  const push = (assetId: unknown, role: CanvasInputAsset['role']) => {
    const id = Number(assetId)
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) return
    seen.add(id)
    assets.push({ asset_id: id, role })
  }

  for (const ref of sourceRefs || []) {
    if (ref.kind === 'text') continue
    push(ref.assetId, isCanvasVideoSourceKind(ref.kind) ? CANVAS_SOURCE_VIDEO_ROLE : imageRole)
  }
  // 节点自身的视频排在最后：它是「被改的那条」，前面的连线素材才是参考
  push(selfVideoAssetId, CANVAS_SOURCE_VIDEO_ROLE)
  return assets
}

/**
 * Video generation accepts five input shapes:
 * text only, one first-frame image, first + last frames, 1-5 full references,
 * or an existing video as the source clip (video-to-video).
 *
 * 带源视频的那一种走 video.edit，因此两个 operation 都要走这里校验：
 * 只认 video.generate 会让「视频生视频」完全绕过素材落库与数量检查。
 */
export function validateCanvasVideoInputs(args: {
  operationCode: string
  videoMode?: CanvasVideoMode
  sourceRefs: CanvasGenerationSourceRef[]
  /** 当前模型声明的参考图上限；未声明时沿用画布默认的 5 张。 */
  maxImageRefs?: number
}): string | null {
  const isGenerate = args.operationCode === 'video.generate'
  const isEdit = args.operationCode === 'video.edit'
  if (!isGenerate && !isEdit) return null

  const mediaRefs = (args.sourceRefs || []).filter((ref) => ref.kind !== 'text')
  if (mediaRefs.length === 0) return null

  const hasUsableAsset = (ref: CanvasGenerationSourceRef) =>
    Number.isSafeInteger(Number(ref.assetId)) && Number(ref.assetId) > 0

  // 素材必须已落库：本地还没上传完的连线没有 assetId，提交上去就是一个拿不到输入的付费任务
  if (mediaRefs.some((ref) => !hasUsableAsset(ref))) {
    return '参考素材尚未上传完成，请稍候或重新选择素材后重试'
  }
  // 图片和视频之外的来源不能作为视频输入
  if (mediaRefs.some((ref) => ref.kind !== 'image' && !isCanvasVideoSourceKind(ref.kind))) {
    return '视频生成仅支持图片或视频作为参考素材，请检查连线后重试'
  }

  // 视频来源即「视频生视频」：把连进来的那条视频作为源片重新生成。
  // 一次只能有一条源视频，多条无法判断以哪条为准；此时图片继续作为参考素材同时下发。
  const videoRefs = mediaRefs.filter((ref) => isCanvasVideoSourceKind(ref.kind))
  if (videoRefs.length > 1) return '视频生视频一次只能连接一条源视频，请去掉多余的视频连线'

  const imageRefs = mediaRefs.filter((ref) => ref.kind === 'image')
  const maxImageRefs = Number.isFinite(Number(args.maxImageRefs)) ? Math.max(0, Number(args.maxImageRefs)) : 5
  // 带源视频时，首尾帧的槽位规则不再适用：画面时序由源视频决定，图片只是风格/主体参考
  if (videoRefs.length === 1 || isEdit) {
    return imageRefs.length > maxImageRefs ? `视频生视频最多再附带 ${maxImageRefs} 张参考图片` : null
  }

  if (args.videoMode === 'full-ref' || args.videoMode === 'auto') {
    return imageRefs.length > maxImageRefs ? `当前模型最多支持 ${maxImageRefs} 张参考图片` : null
  }

  if (imageRefs.length > 2) return '首尾帧模式最多支持首帧和尾帧两张参考图片'
  const slots = new Set(imageRefs.map((ref) => Number(ref.slotIndex)))
  if (!slots.has(0)) return '添加一张参考图片时请将其放在首帧位置'
  if (imageRefs.length === 2 && !slots.has(1)) return '添加两张参考图片时请同时提供首帧和尾帧'
  return null
}
