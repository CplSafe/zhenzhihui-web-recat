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
  ratio?: string
  resolution?: string
}): CanvasSubjectEditRequest {
  const modelVersionId = getBackendGenerationModelVersionId(model)
  if (!modelVersionId || !supportsCanvasSubjectEditModel(kind, model))
    throw new Error('请选择当前空间支持主体编辑的模型')
  if (!Number.isSafeInteger(sourceAssetId) || sourceAssetId <= 0) throw new Error('原素材尚未就绪')
  const subject = target?.trim()
  const details = description?.trim()
  if (kind === 'video' && !subject) throw new Error('请描述要处理的主体')
  if (
    kind === 'image' &&
    (!Number.isSafeInteger(maskAssetId) || !maskAssetId || maskAssetId <= 0 || maskAssetId === sourceAssetId)
  )
    throw new Error('请先涂抹要处理的区域')
  if (mode === 'modify' && !details) throw new Error('请填写修改说明')
  if (mode === 'replace' && !details) throw new Error('请填写替换说明')

  const scope = kind === 'video' ? `原视频中的「${subject}」` : '蒙版标出的主体'
  const instructions: Record<CanvasSubjectEditMode, string> = {
    remove:
      `消除${scope}，用附近原有场景自然补全被遮挡的区域。` +
      (kind === 'video' ? '同时移除该主体造成的影子和倒影。' : ''),
    modify: `仅修改${scope}，保持其余主体不变。修改要求：${details || ''}`,
    replace: `仅替换${scope}，使替换后的主体与原场景的透视和光照一致。替换要求：${details || ''}`,
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
    const request = compileVideoEditModelRequest(model, {
      prompt: [
        instructions[mode],
        '对完整视频持续处理同一个目标，保持原片镜头运动、构图、时长、其他主体和原有音轨。补出的背景跨帧连续，避免边缘闪烁、拖影和目标重新出现。',
      ].join('\n'),
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
      inputAssets: buildCanvasInputAssets([{ kind, assetId: sourceAssetId }], operationCode),
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
