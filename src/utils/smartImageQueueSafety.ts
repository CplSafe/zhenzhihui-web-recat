import type { BackendGenerationModel, GenerationOperationCode } from './generationModelCatalog'
import { buildGenerationModelExecutionFingerprint } from './generationQueueModelGuards'

/** 图片聊天队列只允许这两种付费操作。 */
export type SmartImageGenerationOperation = Extract<
  GenerationOperationCode,
  'image.text_to_image' | 'image.image_to_image'
>

/** 用户确认时冻结的一整个图片批次报价；每张图仍对应一笔独立任务。 */
export interface LockedSmartImageQuotedCost {
  workspaceId: number
  operationCode: SmartImageGenerationOperation
  modelVersionId: number
  /** 只覆盖会影响执行语义的模型 schema/capability 字段。 */
  modelExecutionFingerprint: string
  /** 与正式提交完全相同的单任务 params 快照指纹。 */
  paramsFingerprint: string
  perImageCost: number
  batchTotalCost: number
  balanceAtQuote: number
  batchSize: number
  quotedAt: number
}

export interface SmartImageQuoteBinding {
  workspaceId: number
  operationCode: SmartImageGenerationOperation
  modelVersionId: number
  modelVersion?: BackendGenerationModel | null
  params: unknown
  batchSize: number
}

export interface SmartImageReestimate extends SmartImageQuoteBinding {
  estimatedCost: number
  balance: number
  canAfford: boolean
  /** 当前任务在内、仍未提交的同批次任务数。 */
  remainingCount: number
}

const positiveInteger = (value: unknown): number => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableJsonValue(item)]),
  )
}

/** 生成可持久化的参数指纹，避免刷新后用另一组参数复用旧报价。 */
export function buildSmartImageParamsFingerprint(params: unknown): string {
  return JSON.stringify(stableJsonValue(params && typeof params === 'object' ? params : {}))
}

/** 将一次有效的费用预估固化为后续队列唯一可接受的报价快照。 */
export function createLockedSmartImageQuote(
  binding: SmartImageQuoteBinding & {
    perImageCost: number
    balance: number
    quotedAt?: number
  },
): LockedSmartImageQuotedCost {
  const workspaceId = positiveInteger(binding.workspaceId)
  const modelVersionId = positiveInteger(binding.modelVersionId)
  const batchSize = positiveInteger(binding.batchSize)
  const perImageCost = Number(binding.perImageCost)
  const balance = Number(binding.balance)
  const quotedAt = Number(binding.quotedAt ?? Date.now())
  const batchTotalCost = perImageCost * batchSize
  if (
    !workspaceId ||
    !modelVersionId ||
    !batchSize ||
    !Number.isFinite(perImageCost) ||
    perImageCost < 0 ||
    !Number.isFinite(batchTotalCost) ||
    batchTotalCost < 0 ||
    !Number.isFinite(balance) ||
    balance < batchTotalCost ||
    !Number.isFinite(quotedAt) ||
    quotedAt <= 0
  ) {
    throw new Error('图片任务报价无效，请重新确认费用')
  }

  return {
    workspaceId,
    operationCode: binding.operationCode,
    modelVersionId,
    modelExecutionFingerprint: buildGenerationModelExecutionFingerprint(binding.modelVersion),
    paramsFingerprint: buildSmartImageParamsFingerprint(binding.params),
    perImageCost,
    batchTotalCost,
    balanceAtQuote: balance,
    batchSize,
    quotedAt,
  }
}

/** 校验待提交消息仍与用户确认时的空间、模型、schema、参数和批次数量完全一致。 */
export function getSmartImageQuoteBindingError(
  quote: LockedSmartImageQuotedCost | null | undefined,
  binding: SmartImageQuoteBinding,
): string {
  if (!quote) return '图片任务缺少用户已确认的锁定报价，请重新发起生成'
  if (
    positiveInteger(quote.workspaceId) !== positiveInteger(binding.workspaceId) ||
    quote.operationCode !== binding.operationCode ||
    positiveInteger(quote.modelVersionId) !== positiveInteger(binding.modelVersionId)
  ) {
    return '图片任务的工作空间、模型或操作类型已变化，请重新确认费用'
  }
  if (positiveInteger(quote.batchSize) !== positiveInteger(binding.batchSize)) {
    return '图片任务的生成数量已变化，请重新确认费用'
  }

  const lockedModelFingerprint = String(quote.modelExecutionFingerprint ?? '')
  const currentModelFingerprint = buildGenerationModelExecutionFingerprint(binding.modelVersion)
  if (typeof quote.modelExecutionFingerprint !== 'string' || lockedModelFingerprint !== currentModelFingerprint) {
    return '图片模型配置已变化，请重新选择模型并确认费用'
  }
  if (
    typeof quote.paramsFingerprint !== 'string' ||
    quote.paramsFingerprint !== buildSmartImageParamsFingerprint(binding.params)
  ) {
    return '图片生成参数已变化，请重新确认费用'
  }
  return ''
}

/**
 * 真正创建每张图片任务前复核报价。
 * 价格必须与确认值完全一致，余额必须足以覆盖当前仍未提交的整个批次。
 */
export function getSmartImageQuoteValidationError(
  quote: LockedSmartImageQuotedCost | null | undefined,
  current: SmartImageReestimate,
): string {
  const bindingError = getSmartImageQuoteBindingError(quote, current)
  if (bindingError) return bindingError
  if (!quote) return '图片任务缺少用户已确认的锁定报价，请重新发起生成'

  const quotedCost = Number(quote.perImageCost)
  const quotedBatchTotal = Number(quote.batchTotalCost)
  const quotedBalance = Number(quote.balanceAtQuote)
  const quotedAt = Number(quote.quotedAt)
  const currentCost = Number(current.estimatedCost)
  const balance = Number(current.balance)
  const remainingCount = positiveInteger(current.remainingCount)
  if (
    !Number.isFinite(quotedCost) ||
    quotedCost < 0 ||
    !Number.isFinite(quotedBatchTotal) ||
    quotedBatchTotal !== quotedCost * positiveInteger(quote.batchSize) ||
    !Number.isFinite(quotedBalance) ||
    quotedBalance < quotedBatchTotal ||
    !Number.isFinite(quotedAt) ||
    quotedAt <= 0 ||
    !Number.isFinite(currentCost) ||
    currentCost < 0 ||
    !Number.isFinite(balance) ||
    balance < 0 ||
    !remainingCount ||
    remainingCount > positiveInteger(quote.batchSize)
  ) {
    return '图片任务报价无效，请重新确认费用'
  }
  if (Math.abs(quotedCost - currentCost) > 1e-6) {
    return `图片生成费用已由每张 ${quotedCost} 积分变为 ${currentCost} 积分，请重新确认后生成`
  }

  const remainingTotal = currentCost * remainingCount
  if (!current.canAfford || remainingTotal > balance) {
    return `当前余额 ${balance} 积分不足以完成剩余 ${remainingCount} 张图片（需要 ${remainingTotal} 积分），尚未创建付费任务`
  }
  return ''
}
