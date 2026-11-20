import { buildCanvasInputAssets, type CanvasInputAsset } from './canvasGeneration'
import {
  compileCanvasSubjectVideoRequest,
  getCanvasSubjectVideoOperation,
  getCanvasSubjectVideoSourceReferenceMode as getProviderVideoSourceReferenceMode,
} from './canvasSubjectVideoEdit'
import {
  getBackendGenerationModelConfigurationError,
  getBackendGenerationModelOperationCodes,
  getBackendGenerationModelVersionId,
  isBackendGenerationModelEnabled,
  type BackendGenerationModel,
} from './generationModelCatalog'
import { resolveModelInputAssetRole } from './modelInputAssetRole'
import {
  getModelInputConstraints,
  getModelReferenceImageRole,
  type ModelInputRoleConstraint,
} from './modelInputConstraints'
import { findFirstField, getModelParamFields, getModelParamOptionValues } from './modelSchema'
import { parseDurationSeconds } from './videoDurationValue'

export type CanvasSubjectEditKind = 'image' | 'video'
export type CanvasSubjectEditMode = 'remove' | 'modify' | 'replace'

export const CANVAS_SUBJECT_EDIT_MODE_LABELS: Record<CanvasSubjectEditMode, string> = {
  remove: '主体消除',
  modify: '主体修改',
  replace: '主体替换',
}

const IMAGE_EDIT_OPERATION = 'image.image_to_image'
// 暂停这些型号的主体编辑入口。任务恢复和其他工具仍使用原模型配置。
const SUBJECT_EDIT_HIDDEN_MODEL_IDENTITIES = new Set([
  'happyhorse-1.0-video-edit',
  'doubao-seedance-2-0',
  'doubao-seedance-2-0-260128',
  'qwen-image-2.0',
  'qwen-image-2.0-2026-03-03',
  'gemini-2.5-flash-image',
  'gpt-image-2',
])
const SUBJECT_EDIT_HIDDEN_MODELS_BY_MODE = {
  remove: new Set(['doubao-seedance-2-0-mini', 'doubao-seedance-2-0-mini-260615']),
  modify: new Set(['gpt-image-2.5-flare']),
  replace: new Set(['doubao-seedance-2-5', 'doubao-seedance-2-5-260628']),
} satisfies Record<CanvasSubjectEditMode, ReadonlySet<string>>
const GOOGLE_IMAGE_EDIT_MODELS = new Set([
  'gemini-2.5-flash-image',
  'gemini-3-pro-image',
  'gemini-3.1-flash-image',
  'gemini-nano-banana-2.1',
])
const SEEDREAM_INTERACTIVE_EDIT_MODELS = new Set([
  'doubao-seedream-5-0-flash',
  'doubao-seedream-5-0-flash-260915',
  'doubao-seedream-5-0-pro',
  'doubao-seedream-5-0-pro-260628',
])

function getSubjectModelIdentities(model: BackendGenerationModel): string[] {
  return [model.model_code, model.modelCode, model.model, model.version].map((item) =>
    String(item ?? '')
      .trim()
      .toLowerCase(),
  )
}

function getImageEditStrategy(model: BackendGenerationModel): 'mask' | 'bbox' | 'description' | null {
  if (!getBackendGenerationModelOperationCodes(model).includes(IMAGE_EDIT_OPERATION)) return null
  const identities = getSubjectModelIdentities(model)
  if (model.provider === 'openai') return 'mask'
  if (model.provider === 'google' && identities.some((id) => GOOGLE_IMAGE_EDIT_MODELS.has(id))) return 'description'
  if (model.provider === 'volcengine' && identities.some((id) => SEEDREAM_INTERACTIVE_EDIT_MODELS.has(id)))
    return 'bbox'
  if (model.provider === 'bailian' && identities.some((id) => /^qwen-image-2\.0(?:-2026-03-03)?$/.test(id)))
    return 'description'
  return null
}

export function needsCanvasSubjectImageMask(model: BackendGenerationModel) {
  return getImageEditStrategy(model) === 'mask'
}

function canUseSubjectModel(model: BackendGenerationModel) {
  return Boolean(
    isBackendGenerationModelEnabled(model) &&
    getBackendGenerationModelVersionId(model) &&
    !getBackendGenerationModelConfigurationError(model),
  )
}

export function getCanvasSubjectEditModels<T extends BackendGenerationModel>(
  kind: CanvasSubjectEditKind,
  models: readonly T[],
  mode?: CanvasSubjectEditMode,
): T[] {
  const hiddenForMode = mode ? SUBJECT_EDIT_HIDDEN_MODELS_BY_MODE[mode] : undefined
  return models.filter(
    (model) =>
      canUseSubjectModel(model) &&
      (!model.capability || model.capability === kind) &&
      !getSubjectModelIdentities(model).some(
        (id) => SUBJECT_EDIT_HIDDEN_MODEL_IDENTITIES.has(id) || hiddenForMode?.has(id),
      ) &&
      (kind === 'image' ? getImageEditStrategy(model) : getCanvasSubjectVideoOperation(model)),
  )
}

// video.edit 接口最多接受五张静态参考图，未声明上限时沿用接口约定。
const VIDEO_EDIT_MAX_REFERENCE_IMAGES = 5

function permitsStillImage(role: ModelInputRoleConstraint, formats: readonly string[]) {
  return (
    !role.mimeTypes.length || role.mimeTypes.some((type) => ['image/*', '*/*', ...formats].includes(type.toLowerCase()))
  )
}

const TARGET_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function videoReferenceInputs(model: BackendGenerationModel) {
  const operation = getCanvasSubjectVideoOperation(model)
  return getModelInputConstraints(model, operation ?? 'video.edit')
}

/** 仅在源视频和静态参考能够一同提交时开放参考图。 */
export function getCanvasSubjectVideoReferenceLimit(model: BackendGenerationModel): number {
  const operation = getCanvasSubjectVideoOperation(model)
  if (!operation || !canUseSubjectModel(model)) return 0
  const constraints = model.input_constraints ?? model.inputConstraints
  if (!constraints || typeof constraints !== 'object') return 0
  const videoConstraints = (constraints as Record<string, unknown>)[operation]
  if (!videoConstraints || typeof videoConstraints !== 'object') return 0
  const roles = (videoConstraints as Record<string, unknown>).roles
  if (!Array.isArray(roles)) return 0
  const imageRole = roles.find((role): role is Record<string, unknown> =>
    Boolean(role && typeof role === 'object' && role.role === 'image'),
  )
  if (!imageRole) return 0
  const limit = imageRole.max_count !== undefined ? imageRole.max_count : imageRole.maxCount
  if (
    limit !== undefined &&
    ((typeof limit !== 'number' && typeof limit !== 'string') ||
      !Number.isSafeInteger(Number(limit)) ||
      Number(limit) < 1)
  )
    return 0
  const maximum =
    limit === undefined ? VIDEO_EDIT_MAX_REFERENCE_IMAGES : Math.min(Number(limit), VIDEO_EDIT_MAX_REFERENCE_IMAGES)
  const { roles: normalizedRoles, mutuallyExclusiveRoleGroups } = videoReferenceInputs(model)
  const imageConstraint = normalizedRoles.find((role) => role.role === 'image')
  // 主体编辑最多提供一张旧主体参考和一张新主体参考。
  if (!imageConstraint || imageConstraint.minCount > Math.min(maximum, 2)) return 0
  if (!permitsStillImage(imageConstraint, TARGET_IMAGE_MIME_TYPES)) return 0
  const imageGroups = mutuallyExclusiveRoleGroups.filter((group) => group.includes('image'))
  if (
    imageGroups.some((group) => mutuallyExclusiveRoleGroups.some((other) => group !== other && other.includes('video')))
  )
    return 0
  return maximum
}

export function getCanvasSubjectVideoSourceReferenceMode(model: BackendGenerationModel): 'cutout' | 'none' {
  const role = videoReferenceInputs(model).roles.find((entry) => entry.role === 'image')
  return role &&
    permitsStillImage(role, ['image/png']) &&
    getCanvasSubjectVideoReferenceLimit(model) > 0 &&
    getProviderVideoSourceReferenceMode(model) === 'cutout'
    ? 'cutout'
    : 'none'
}

export function supportsCanvasSubjectVideoReference(model: BackendGenerationModel): boolean {
  return getCanvasSubjectVideoSourceReferenceMode(model) === 'cutout' && getVideoEditReferenceMinimum(model) <= 1
}

function getVideoEditReferenceMinimum(model: BackendGenerationModel) {
  return videoReferenceInputs(model).roles.find((role) => role.role === 'image')?.minCount || 0
}

export function supportsCanvasSubjectTargetReference(kind: CanvasSubjectEditKind, model: BackendGenerationModel) {
  if (!canUseSubjectModel(model)) return false
  if (kind === 'video') {
    const limit = getCanvasSubjectVideoReferenceLimit(model)
    return (
      limit > 0 &&
      (getVideoEditReferenceMinimum(model) <= 1 || getCanvasSubjectVideoSourceReferenceMode(model) === 'cutout')
    )
  }
  if (!getImageEditStrategy(model)) return false
  const imageRole = getModelReferenceImageRole(model, IMAGE_EDIT_OPERATION)
  const { roles } = getModelInputConstraints(model, IMAGE_EDIT_OPERATION)
  const role = roles.find((entry) => entry.role === imageRole)
  return Boolean(role && role.maxCount >= 2 && role.minCount <= 2 && permitsStillImage(role, TARGET_IMAGE_MIME_TYPES))
}

export type CanvasSubjectSelectionBounds = { x: number; y: number; width: number; height: number }

export interface CanvasSubjectVideoSelection {
  /** 原视频当前帧的时间戳，单位为秒。 */
  time: number
  /** 起点以画面左上角为原点，宽高和起点均为 0 到 1 的相对值。 */
  bounds: CanvasSubjectSelectionBounds
  referenceAssetId?: number
}

function validSelection(bounds?: CanvasSubjectSelectionBounds): bounds is CanvasSubjectSelectionBounds {
  if (!bounds) return false
  const { x, y, width, height } = bounds
  return (
    [x, y, width, height].every(Number.isFinite) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 + 1e-8 &&
    y + height <= 1 + 1e-8
  )
}

function describeSelectionBounds({ x, y, width, height }: CanvasSubjectSelectionBounds) {
  const percent = (value: number) => `${Number((value * 100).toFixed(1))}%`
  return `选区从画面左边起 ${percent(x)}、从上边起 ${percent(y)}，宽 ${percent(width)}、高 ${percent(height)}`
}

function describeVideoSelection({ time, bounds }: CanvasSubjectVideoSelection, duration: number) {
  if (!Number.isFinite(time) || time < 0 || time > duration) throw new Error('所选画面时刻已超出原视频')
  if (!validSelection(bounds)) throw new Error('请重新框选视频中的主体')
  return `选区参考：原视频第 ${Number(time.toFixed(3))} 秒，${describeSelectionBounds(bounds)}。以这处选区定位该帧的主体。`
}

function describeImageSelection(bounds: CanvasSubjectSelectionBounds, strategy: 'bbox' | 'description') {
  if (strategy === 'description') return `原图的${describeSelectionBounds(bounds)}区域内的主体`
  const scale = (coordinate: number) => Math.min(999, Math.max(0, Math.round(coordinate * 999)))
  const left = Math.min(scale(bounds.x), 998)
  const top = Math.min(scale(bounds.y), 998)
  const right = Math.max(left + 1, scale(bounds.x + bounds.width))
  const bottom = Math.max(top + 1, scale(bounds.y + bounds.height))
  return `图 1 <bbox>${left} ${top} ${right} ${bottom}</bbox> 区域内的主体`
}

export interface CanvasSubjectEditRequest {
  kind: CanvasSubjectEditKind
  subjectEdit: true
  requiresSeedanceModeration?: true
  modelVersionId: number
  operationCode: typeof IMAGE_EDIT_OPERATION | 'video.edit' | 'video.generate'
  prompt: string
  params: Record<string, unknown>
  inputAssets: CanvasInputAsset[]
}

/** 视频主体尚未选定时，只用真实原片与现有参考计算预估积分。 */
export function buildCanvasSubjectVideoEstimateRequest({
  mode,
  model,
  sourceAssetId,
  targetReferenceAssetId,
  duration,
  ratio,
}: {
  mode: CanvasSubjectEditMode
  model: BackendGenerationModel
  sourceAssetId: number
  targetReferenceAssetId?: number
  duration: number
  ratio?: string
}): Pick<CanvasSubjectEditRequest, 'modelVersionId' | 'operationCode' | 'prompt' | 'params' | 'inputAssets'> {
  const modelVersionId = getBackendGenerationModelVersionId(model)
  const operationCode = getCanvasSubjectVideoOperation(model)
  if (!modelVersionId || !operationCode) throw new Error('请选择当前空间支持主体编辑的模型')
  if (!Number.isSafeInteger(sourceAssetId) || sourceAssetId <= 0) throw new Error('原素材尚未就绪')
  const inputAssets = buildCanvasInputAssets([{ kind: 'video', assetId: sourceAssetId }], operationCode)
  if (targetReferenceAssetId !== undefined) inputAssets.push({ asset_id: targetReferenceAssetId, role: 'image' })
  const request = compileCanvasSubjectVideoRequest(model, {
    prompt: `对提供的视频进行${CANVAS_SUBJECT_EDIT_MODE_LABELS[mode]}，保持原片时长和音轨。`,
    duration,
    ratio,
    targetReferenceIndex: targetReferenceAssetId === undefined ? undefined : 1,
  })
  return { modelVersionId, operationCode, inputAssets, ...request }
}

/** 估价和下单使用同一份原素材、蒙版、操作和模型参数。 */
export function buildCanvasSubjectEditRequest({
  kind,
  mode,
  model,
  sourceAssetId,
  maskAssetId,
  target,
  description,
  sourceVideoDurationSec,
  videoSelection,
  imageSelection,
  targetReferenceAssetId,
  replacementAssetId,
  ratio,
  resolution,
}: {
  kind: CanvasSubjectEditKind
  mode: CanvasSubjectEditMode
  model: BackendGenerationModel
  sourceAssetId: number
  maskAssetId?: number
  target?: string
  description?: string
  sourceVideoDurationSec?: number
  videoSelection?: CanvasSubjectVideoSelection
  imageSelection?: CanvasSubjectSelectionBounds
  targetReferenceAssetId?: number
  replacementAssetId?: number
  ratio?: string
  resolution?: string
}): CanvasSubjectEditRequest {
  const modelVersionId = getBackendGenerationModelVersionId(model)
  const imageStrategy = kind === 'image' ? getImageEditStrategy(model) : null
  const operationCode = kind === 'video' ? getCanvasSubjectVideoOperation(model) : imageStrategy && IMAGE_EDIT_OPERATION
  if (
    !modelVersionId ||
    !operationCode ||
    !canUseSubjectModel(model) ||
    (model.capability && model.capability !== kind)
  )
    throw new Error('请选择当前空间支持主体编辑的模型')
  if (!Number.isSafeInteger(sourceAssetId) || sourceAssetId <= 0) throw new Error('原素材尚未就绪')
  const subject = target?.trim() || (videoSelection ? '标记帧选区内的主体' : '')
  const details = description?.trim()
  if (kind === 'video' && !subject) throw new Error('请选择或描述要处理的主体')
  if (
    imageStrategy === 'mask' &&
    (!Number.isSafeInteger(maskAssetId) || !maskAssetId || maskAssetId <= 0 || maskAssetId === sourceAssetId)
  )
    throw new Error('请先涂抹要处理的区域')
  if (mode === 'modify' && !details) throw new Error('请填写修改说明')
  if (replacementAssetId !== undefined && (kind !== 'video' || mode !== 'replace'))
    throw new Error('替换参考图仅用于视频主体替换')
  const targetImageId = targetReferenceAssetId ?? replacementAssetId
  if (targetImageId !== undefined) {
    if (mode === 'remove') throw new Error('主体消除无需添加目标参考图')
    if (
      !Number.isSafeInteger(targetImageId) ||
      targetImageId <= 0 ||
      targetImageId === sourceAssetId ||
      targetImageId === maskAssetId
    ) {
      throw new Error(replacementAssetId !== undefined ? '替换参考图无效，请重新选择' : '目标参考图无效，请重新选择')
    }
    if (!supportsCanvasSubjectTargetReference(kind, model)) throw new Error('当前模型不支持附带目标参考图')
  }
  if (mode === 'replace' && !details && targetImageId === undefined) throw new Error('请填写替换说明')

  let scope = `原视频中的「${subject}」`
  if (imageStrategy === 'mask') scope = '蒙版标出的主体'
  else if (imageStrategy) {
    if (!validSelection(imageSelection)) throw new Error('请先涂抹或框选要处理的主体')
    scope = describeImageSelection(imageSelection, imageStrategy)
    if (subject) scope += `「${subject}」`
  }
  const instructions: Record<CanvasSubjectEditMode, string> = {
    remove:
      `消除${scope}，用附近原有场景自然补全被遮挡的区域。` +
      (kind === 'video' ? '同时移除该主体造成的影子和倒影。' : ''),
    modify: `仅修改${scope}，保持其余主体不变。修改要求：${details || ''}`,
    replace: `仅替换${scope}，使替换后的主体与原场景的透视和光照一致。` + (details ? `替换要求：${details}` : ''),
  }
  if (kind === 'video') {
    const duration = parseDurationSeconds(sourceVideoDurationSec)
    if (duration === null) throw new Error('无法读取原视频时长，请重新加载视频后重试')
    const selectionPrompt = videoSelection === undefined ? '' : describeVideoSelection(videoSelection, duration)
    const inputAssets = buildCanvasInputAssets([{ kind, assetId: sourceAssetId }], operationCode)
    const referenceId = videoSelection?.referenceAssetId
    if (referenceId !== undefined) {
      if (!Number.isSafeInteger(referenceId) || referenceId <= 0 || referenceId === sourceAssetId)
        throw new Error('视频主体参考图无效，请重新框选')
      if (getCanvasSubjectVideoSourceReferenceMode(model) !== 'cutout')
        throw new Error('当前模型不支持附带视频主体抠图')
      inputAssets.push({ asset_id: referenceId, role: 'image' })
    }
    if (targetImageId !== undefined) {
      if (targetImageId === referenceId) throw new Error('目标参考图不能与原主体参考图相同')
      inputAssets.push({ asset_id: targetImageId, role: 'image' })
    }
    const referenceCount = inputAssets.length - 1
    if (referenceCount > 0) {
      const limit = getCanvasSubjectVideoReferenceLimit(model)
      if (!limit) throw new Error('当前模型不支持附带视频主体参考图')
      if (referenceCount > limit) throw new Error(`当前模型最多支持 ${limit} 张视频主体参考图`)
    }
    const minimum = getVideoEditReferenceMinimum(model)
    if (referenceCount < minimum) throw new Error(`当前模型至少需要 ${minimum} 张视频主体参考图`)
    const targetImagePrompt =
      targetImageId === undefined
        ? ''
        : mode === 'replace'
          ? `第${referenceCount}张参考图是要换入的新主体，以这张图为准替换旧主体。`
          : `第${referenceCount}张参考图仅用于指定修改后的外观，根据修改要求编辑原主体。`
    const request = compileCanvasSubjectVideoRequest(model, {
      prompt: [
        instructions[mode],
        selectionPrompt,
        referenceId === undefined
          ? ''
          : targetImageId === undefined
            ? '参考图片仅用于辨认选中的主体。'
            : '第1张参考图是原视频中选中的旧主体，仅用于定位。',
        targetImagePrompt,
        '对完整视频持续处理同一个目标，保持原片镜头运动、构图、时长、其他主体和原有音轨。',
        mode === 'remove'
          ? '补出的背景跨帧连续，避免边缘闪烁、拖影和目标重新出现。'
          : '保持修改后的主体跨帧一致，避免边缘闪烁和拖影。',
      ]
        .filter(Boolean)
        .join('\n'),
      ratio,
      resolution,
      duration,
      targetReferenceIndex: targetImageId === undefined ? undefined : referenceCount,
    })
    return {
      kind,
      subjectEdit: true,
      ...(operationCode === 'video.generate' && model.provider === 'volcengine'
        ? { requiresSeedanceModeration: true as const }
        : {}),
      modelVersionId,
      operationCode,
      prompt: request.prompt,
      params: request.params,
      inputAssets,
    }
  }

  const fields = getModelParamFields(model)
  const params = Object.fromEntries(
    fields.filter((field) => field.default !== undefined).map((field) => [field.name, field.default]),
  )
  const countField = findFirstField(fields, ['count', 'n', 'num_images', 'batch_size'])
  if (countField) {
    const options = getModelParamOptionValues(countField)
    const single = options.find((value) => Number(value) === 1)
    if (options.length && single === undefined) throw new Error('当前模型不支持单张结果，请选择其他模型')
    params[countField.name] = single ?? 1
  }
  const imageRole = resolveModelInputAssetRole(model, operationCode)
  const inputAssets = buildCanvasInputAssets([{ kind, assetId: sourceAssetId }], operationCode, 0, imageRole)
  if (targetImageId !== undefined) inputAssets.push({ asset_id: targetImageId, role: imageRole })
  if (imageStrategy === 'mask') {
    params.mask_asset_id = maskAssetId
    inputAssets.push({ asset_id: maskAssetId, role: 'mask' })
  }
  const referenceInstruction =
    targetImageId === undefined
      ? ''
      : mode === 'replace'
        ? '第2张图是要换入的新主体参考，只编辑第1张原图。'
        : '第2张图是修改后的外观参考，根据修改要求编辑第1张原图的选中主体。'
  return {
    kind,
    subjectEdit: true,
    modelVersionId,
    operationCode,
    prompt: [
      instructions[mode],
      referenceInstruction,
      imageStrategy === 'mask'
        ? '保持原图尺寸与构图，蒙版外的画面原样保留。'
        : '保持原图尺寸与构图，保留选区外的其他内容。',
    ]
      .filter(Boolean)
      .join(' '),
    params,
    inputAssets,
  }
}
