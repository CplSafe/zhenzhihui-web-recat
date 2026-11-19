import { compileVideoEditModelRequest } from '@/api/smartVideo'
import { buildCanvasInputAssets, type CanvasInputAsset } from './canvasGeneration'
import {
  getBackendGenerationModelConfigurationError,
  getBackendGenerationModelOperationCodes,
  getBackendGenerationModelVersionId,
  isBackendGenerationModelEnabled,
  type BackendGenerationModel,
} from './generationModelCatalog'
import { resolveModelInputAssetRole } from './modelInputAssetRole'
import { getModelInputConstraints } from './modelInputConstraints'
import { buildModelRestrictionSummary, getModelConstraintConflicts } from './modelRestrictions'
import { findFirstField, getModelParamFields, getModelParamOptionValues } from './modelSchema'
import { parseDurationSeconds } from './videoDurationValue'

export type CanvasSubjectEditKind = 'image' | 'video'
export type CanvasSubjectEditMode = 'remove' | 'modify' | 'replace'

export const CANVAS_SUBJECT_EDIT_MODE_LABELS: Record<CanvasSubjectEditMode, string> = {
  remove: '主体消除',
  modify: '主体修改',
  replace: '主体替换',
}

export function getCanvasSubjectEditOperation(kind: CanvasSubjectEditKind) {
  return kind === 'video' ? 'video.edit' : 'image.image_to_image'
}

function supportsCanvasSubjectEditModel(kind: CanvasSubjectEditKind, model: BackendGenerationModel) {
  return (
    isBackendGenerationModelEnabled(model) &&
    Boolean(getBackendGenerationModelVersionId(model)) &&
    !getBackendGenerationModelConfigurationError(model) &&
    getBackendGenerationModelOperationCodes(model).includes(getCanvasSubjectEditOperation(kind)) &&
    // 与现有图片节点的蒙版能力判定保持一致。
    (kind === 'video' || model.provider === 'openai')
  )
}

export function getCanvasSubjectEditModels<T extends BackendGenerationModel>(
  kind: CanvasSubjectEditKind,
  models: readonly T[],
): T[] {
  return models.filter((model) => supportsCanvasSubjectEditModel(kind, model))
}

// video.edit 接口最多接受五张静态参考图，未声明上限时沿用接口约定。
const VIDEO_EDIT_MAX_REFERENCE_IMAGES = 5

/** 只读取 video.edit 明确声明的图片角色，不把静态参考图视为视频蒙版。 */
export function getCanvasSubjectVideoReferenceLimit(model: BackendGenerationModel): number {
  if (!supportsCanvasSubjectEditModel('video', model)) return 0
  const constraints = model.input_constraints ?? model.inputConstraints
  if (!constraints || typeof constraints !== 'object') return 0
  const videoConstraints = (constraints as Record<string, unknown>)['video.edit']
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
  const { roles: normalizedRoles, mutuallyExclusiveRoleGroups } = getModelInputConstraints(model, 'video.edit')
  const imageConstraint = normalizedRoles.find((role) => role.role === 'image')
  // 主体编辑最多提供一张旧主体参考和一张新主体参考。
  if (!imageConstraint || imageConstraint.minCount > Math.min(maximum, 2)) return 0
  const allowedTypes = imageConstraint.mimeTypes
  if (allowedTypes.length && !allowedTypes.some((type) => ['image/png', 'image/*', '*/*'].includes(type.toLowerCase())))
    return 0
  const imageGroups = mutuallyExclusiveRoleGroups.filter((group) => group.includes('image'))
  if (
    imageGroups.some((group) => mutuallyExclusiveRoleGroups.some((other) => group !== other && other.includes('video')))
  )
    return 0
  return maximum
}

export function supportsCanvasSubjectVideoReference(model: BackendGenerationModel): boolean {
  return getCanvasSubjectVideoReferenceLimit(model) > 0 && getVideoEditReferenceMinimum(model) <= 1
}

function getVideoEditReferenceMinimum(model: BackendGenerationModel) {
  return getModelInputConstraints(model, 'video.edit').roles.find((role) => role.role === 'image')?.minCount || 0
}

export interface CanvasSubjectVideoSelection {
  /** 原视频当前帧的时间戳，单位为秒。 */
  time: number
  /** 起点以画面左上角为原点，宽高和起点均为 0 到 1 的相对值。 */
  bounds: { x: number; y: number; width: number; height: number }
  referenceAssetId?: number
}

function describeVideoSelection(selection: CanvasSubjectVideoSelection, duration: number) {
  const time = selection?.time
  const bounds = selection?.bounds
  if (!Number.isFinite(time) || time < 0 || time > duration) throw new Error('所选画面时刻已超出原视频')
  if (!bounds) throw new Error('请重新框选视频中的主体')
  const { x, y, width, height } = bounds
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1 + Number.EPSILON ||
    y + height > 1 + Number.EPSILON
  )
    throw new Error('请重新框选视频中的主体')

  const percent = (value: number) => `${Number((value * 100).toFixed(1))}%`
  return `选区参考：原视频第 ${Number(time.toFixed(3))} 秒，选区从画面左边起 ${percent(x)}、从上边起 ${percent(y)}，宽 ${percent(width)}、高 ${percent(height)}。以这处选区定位该帧的主体。`
}

export interface CanvasSubjectEditRequest {
  kind: CanvasSubjectEditKind
  subjectEdit: true
  modelVersionId: number
  operationCode: ReturnType<typeof getCanvasSubjectEditOperation>
  prompt: string
  params: Record<string, unknown>
  inputAssets: CanvasInputAsset[]
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
  replacementAssetId?: number
  ratio?: string
  resolution?: string
}): CanvasSubjectEditRequest {
  const modelVersionId = getBackendGenerationModelVersionId(model)
  if (!modelVersionId || !supportsCanvasSubjectEditModel(kind, model))
    throw new Error('请选择当前空间支持主体编辑的模型')
  if (!Number.isSafeInteger(sourceAssetId) || sourceAssetId <= 0) throw new Error('原素材尚未就绪')
  const subject = target?.trim() || (videoSelection ? '标记帧选区内的主体' : '')
  const details = description?.trim()
  if (kind === 'video' && !subject) throw new Error('请选择或描述要处理的主体')
  if (
    kind === 'image' &&
    (!Number.isSafeInteger(maskAssetId) || !maskAssetId || maskAssetId <= 0 || maskAssetId === sourceAssetId)
  )
    throw new Error('请先涂抹要处理的区域')
  if (mode === 'modify' && !details) throw new Error('请填写修改说明')
  if (replacementAssetId !== undefined) {
    if (kind !== 'video' || mode !== 'replace') throw new Error('替换参考图仅用于视频主体替换')
    if (!Number.isSafeInteger(replacementAssetId) || replacementAssetId <= 0 || replacementAssetId === sourceAssetId)
      throw new Error('替换参考图无效，请重新选择')
  }
  if (mode === 'replace' && !details && replacementAssetId === undefined) throw new Error('请填写替换说明')

  const scope = kind === 'video' ? `原视频中的「${subject}」` : '蒙版标出的主体'
  const instructions: Record<CanvasSubjectEditMode, string> = {
    remove:
      `消除${scope}，用附近原有场景自然补全被遮挡的区域。` +
      (kind === 'video' ? '同时移除该主体造成的影子和倒影。' : ''),
    modify: `仅修改${scope}，保持其余主体不变。修改要求：${details || ''}`,
    replace: `仅替换${scope}，使替换后的主体与原场景的透视和光照一致。` + (details ? `替换要求：${details}` : ''),
  }
  const operationCode = getCanvasSubjectEditOperation(kind)
  const fields = getModelParamFields(model)
  if (kind === 'video') {
    const duration = parseDurationSeconds(sourceVideoDurationSec)
    if (duration === null) throw new Error('无法读取原视频时长，请重新加载视频后重试')
    const sourceDuration = findFirstField(fields, ['source_video_duration', 'sourceVideoDuration'])
    if (sourceDuration) {
      const minimum = Number(sourceDuration.min ?? sourceDuration.minimum ?? 0)
      const maximum = Number(sourceDuration.max ?? sourceDuration.maximum ?? Infinity)
      const options = getModelParamOptionValues(sourceDuration)
        .map(parseDurationSeconds)
        .filter((value): value is number => value !== null)
      if (duration < minimum || duration > maximum || (options.length > 0 && !options.includes(duration)))
        throw new Error('当前模型不支持这段原视频的完整时长，请选择其他模型或先在画布中裁切')
    }
    if (findFirstField(fields, ['duration', 'seconds'])) {
      const constraints = buildModelRestrictionSummary(model).constraints
      const conflict = getModelConstraintConflicts(constraints, { durationSec: duration })[0]
      if (conflict) throw new Error(`${conflict}，请选择其他模型或先在画布中裁切`)
    }
    const selectionPrompt = videoSelection === undefined ? '' : describeVideoSelection(videoSelection, duration)
    const inputAssets = buildCanvasInputAssets([{ kind, assetId: sourceAssetId }], operationCode)
    const referenceId = videoSelection?.referenceAssetId
    if (referenceId !== undefined) {
      if (!Number.isSafeInteger(referenceId) || referenceId <= 0 || referenceId === sourceAssetId)
        throw new Error('视频主体参考图无效，请重新框选')
      inputAssets.push({ asset_id: referenceId, role: 'image' })
    }
    if (replacementAssetId !== undefined) {
      if (replacementAssetId === referenceId) throw new Error('替换参考图不能与原主体参考图相同')
      inputAssets.push({ asset_id: replacementAssetId, role: 'image' })
    }
    const referenceCount = inputAssets.length - 1
    if (referenceCount > 0) {
      const limit = getCanvasSubjectVideoReferenceLimit(model)
      if (!limit) throw new Error('当前模型不支持附带视频主体参考图')
      if (referenceCount > limit) throw new Error(`当前模型最多支持 ${limit} 张视频主体参考图`)
    }
    const minimum = getVideoEditReferenceMinimum(model)
    if (referenceCount < minimum) throw new Error(`当前模型至少需要 ${minimum} 张视频主体参考图`)
    const request = compileVideoEditModelRequest(model, {
      prompt: [
        instructions[mode],
        selectionPrompt,
        referenceId === undefined
          ? ''
          : replacementAssetId === undefined
            ? '参考图片仅用于辨认选中的主体。'
            : '第1张参考图是原视频中选中的旧主体，仅用于定位。',
        replacementAssetId === undefined ? '' : `第${referenceCount}张参考图是要换入的新主体，以这张图为准替换旧主体。`,
        '对完整视频持续处理同一个目标，保持原片镜头运动、构图、时长、其他主体和原有音轨。补出的背景跨帧连续，避免边缘闪烁、拖影和目标重新出现。',
      ]
        .filter(Boolean)
        .join('\n'),
      ratio,
      resolution,
      durationSec: duration,
      sourceVideoDurationSec: duration,
    })
    return {
      kind,
      subjectEdit: true,
      modelVersionId,
      operationCode,
      prompt: request.prompt,
      params: request.params,
      inputAssets,
    }
  }

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
  params.mask_asset_id = maskAssetId
  const inputAssets = buildCanvasInputAssets(
    [{ kind, assetId: sourceAssetId }],
    operationCode,
    0,
    resolveModelInputAssetRole(model, operationCode),
  )
  inputAssets.push({ asset_id: maskAssetId, role: 'mask' })
  return {
    kind,
    subjectEdit: true,
    modelVersionId,
    operationCode,
    prompt: `${instructions[mode]} 保持原图尺寸与构图，蒙版外的画面原样保留。`,
    params,
    inputAssets,
  }
}
