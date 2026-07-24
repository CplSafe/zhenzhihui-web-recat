import {
  getBackendGenerationModelConfigurationError,
  getBackendGenerationModelOperationCodes,
  getBackendGenerationModelVersionId,
  hasBackendGenerationModelOperationDeclaration,
  isBackendGenerationModelEnabled,
  normalizeGenerationModelVersionId,
  type BackendGenerationModel,
  type GenerationOperationCode,
} from './generationModelCatalog'

type ImageGenerationOperationCode = 'image.text_to_image' | 'image.image_to_image'
type VideoGenerationOperationCode = 'video.generate' | 'video.edit'

export interface ImageQueueModelLock {
  taskId?: number
  operationCode?: ImageGenerationOperationCode
  request?: {
    refAssetIds?: number[]
    modelVersionId?: unknown
  }
}

export interface VideoQueueModelLock {
  edit?: boolean
  modelVersionId?: unknown
  operationCode?: VideoGenerationOperationCode
}

/** 新建付费任务只能使用入队时锁定的正整数后端模型版本 ID。 */
export const hasValidLockedModelVersionId = (value: unknown): boolean => {
  return normalizeGenerationModelVersionId(value) !== null
}

/**
 * 已有 taskId 的图片只恢复原任务，不再要求本地草稿携带模型。
 * 尚未提交的队列必须同时锁定模型和与参考图输入一致的操作类型。
 */
export const getImageQueueModelLockError = (message: ImageQueueModelLock): string => {
  if (Number(message.taskId || 0) > 0) return ''
  const request = message.request
  const expectedOperation: ImageGenerationOperationCode = (request?.refAssetIds || []).some(
    (assetId) => Number(assetId || 0) > 0,
  )
    ? 'image.image_to_image'
    : 'image.text_to_image'
  if (
    !request ||
    !hasValidLockedModelVersionId(request.modelVersionId) ||
    message.operationCode !== expectedOperation
  ) {
    return '旧图片生成记录缺少与输入类型匹配的已锁定模型，请重新发起生成'
  }
  return ''
}

/** 未提交的视频队列必须锁定与“生成/修改”任务类型完全一致的后端模型。 */
export const getVideoQueueModelLockError = (lock: VideoQueueModelLock): string => {
  const expectedOperation: VideoGenerationOperationCode = lock.edit ? 'video.edit' : 'video.generate'
  if (!hasValidLockedModelVersionId(lock.modelVersionId) || lock.operationCode !== expectedOperation) {
    return '旧视频生成记录缺少与任务类型匹配的已锁定模型，请重新生成视频'
  }
  return ''
}

const EXECUTION_CONFIG_KEYS = [
  'params_schema',
  'paramsSchema',
  'input_schema',
  'inputSchema',
  'input_assets_schema',
  'inputAssetsSchema',
  'capability',
  'capabilities',
  'capability_code',
  'capabilityCode',
  'effect',
  'effects',
  'effect_code',
  'effectCode',
  'effect_type',
  'effectType',
  'generation_type',
  'generationType',
  'generation_mode',
  'generationMode',
  'model_family',
  'modelFamily',
] as const

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableJsonValue(item)]),
  )
}

/** 只对会改变请求语义的模型字段做稳定指纹，展示名等后台文案更新不会中断任务。 */
export function buildGenerationModelExecutionFingerprint(model: BackendGenerationModel | null | undefined): string {
  if (!model) return ''
  const executionConfig = Object.fromEntries(
    EXECUTION_CONFIG_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(model, key)).map((key) => [
      key,
      model[key],
    ]),
  )
  return JSON.stringify(stableJsonValue(executionConfig))
}

export interface LockedGenerationModelAvailabilityCheck {
  operationCode: GenerationOperationCode
  modelVersionId: unknown
  modelVersion?: BackendGenerationModel | null
  catalogModels: readonly unknown[]
}

/**
 * 创建付费任务前再次校验锁定模型仍属于同一工作空间、同一 operation 且执行配置未变化。
 * 只返回错误，不挑选替代模型；调用方必须 fail closed。
 */
export function getLockedGenerationModelAvailabilityError(check: LockedGenerationModelAvailabilityCheck): string {
  const expectedId = normalizeGenerationModelVersionId(check.modelVersionId)
  if (expectedId === null) return '已锁定的模型版本无效，请重新选择模型'

  const candidates = (Array.isArray(check.catalogModels) ? check.catalogModels : []).filter(
    (model): model is BackendGenerationModel => Boolean(model) && typeof model === 'object' && !Array.isArray(model),
  )
  const currentModel = candidates.find((model) => {
    if (getBackendGenerationModelVersionId(model) !== expectedId || !isBackendGenerationModelEnabled(model)) {
      return false
    }
    if (!hasBackendGenerationModelOperationDeclaration(model)) return true
    return getBackendGenerationModelOperationCodes(model).includes(check.operationCode)
  })

  if (!currentModel) return '所选模型已下架、无权限或不再支持当前操作，请返回首页重新选择'
  const configurationError = getBackendGenerationModelConfigurationError(currentModel)
  if (configurationError) return configurationError

  const lockedFingerprint = buildGenerationModelExecutionFingerprint(check.modelVersion)
  const currentFingerprint = buildGenerationModelExecutionFingerprint(currentModel)
  if (lockedFingerprint !== currentFingerprint) {
    return '所选模型配置已更新，为避免参数或计费不一致，请返回首页重新选择'
  }
  return ''
}
