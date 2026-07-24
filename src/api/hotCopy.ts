/**
 * 爆款复制 — 走后端 video.replicate(「爆款做同款」)能力:
 * 1 段源视频(role=video,≤200MB)+ 1~9 张主体图(role=image),prompt 写替换意图。
 * 后端内部 AI 拆解源视频后按用户选择的后端模型重新生成,异步轮询取结果。一次成片(非可编辑分镜)。
 */
// @ts-nocheck
import {
  createAiTask,
  waitForAiTask,
  uploadAssetFile,
  getModelForOperation,
  estimateAiTaskCost,
  getAiTaskId,
} from './business'
import { normalizeSeedanceRatio } from '@/utils/videoOptions'
import { validateSmartVideoDuration } from '@/utils/videoDurationValue'
import { resolveTaskVideoResult } from '@/utils/taskMedia'
import { readAiTaskProgress } from '@/utils/taskProgress'
import { getBackendGenerationModelName, getBackendGenerationModelVersionId } from '@/utils/generationModelCatalog'
import { buildModelRestrictionSummary, getModelConstraintConflicts } from '@/utils/modelRestrictions'
import { buildHotCopyReplicateModelParams } from '@/utils/hotCopyModelAdapters'

/** 爆款复制的模型筛选、任务超时与模型预热缓存策略。 */
const VIDEO_MODEL_KEYWORDS = ['seedance']
/** 爆款复制视频生成任务的最大等待时间。 */
const HOT_COPY_VIDEO_TIMEOUT_MS = 60 * 60 * 1000
/** 正式提交前模型查询的超时时间。 */
const HOT_COPY_MODEL_LOOKUP_TIMEOUT_MS = 8000
/** 点击去制作后的费用预估不得无限阻塞页面切换。 */
const HOT_COPY_ESTIMATE_TIMEOUT_MS = 15000
/** 按工作空间预热模型的缓存有效期。 */
const HOT_COPY_MODEL_CACHE_TTL_MS = 5 * 60 * 1000
/** 已成功解析的爆款复制模型缓存。 */
const hotCopyModelCache = new Map()
/** 正在进行的模型查询单飞 Promise 缓存。 */
const hotCopyModelPromises = new Map()
/** 页面显式选择的爆款复制模型已经失效或不支持当前操作。 */
export const HOT_COPY_MODEL_UNAVAILABLE_CODE = 'HOT_COPY_MODEL_UNAVAILABLE'
const HOT_COPY_OPERATION_CODE = 'video.replicate'
/** 用户确认后的费用与正式提交前复核费用不一致。 */
export const HOT_COPY_QUOTE_CHANGED_CODE = 'HOT_COPY_QUOTE_CHANGED'
/** 缺少报价、报价损坏或报价不属于当前请求快照。 */
export const HOT_COPY_QUOTE_INVALID_CODE = 'HOT_COPY_QUOTE_INVALID'
const HOT_COPY_OPERATION_KEYS = ['operation_codes', 'operationCodes', 'operation_code', 'operationCode', 'operations']

/**
 * 一次爆款复制估价/提交共用的不可变请求快照。
 * 模型详情和参数都在付费动作开始前完成复制，后续素材预处理不得再从实时目录解析其他模型。
 */
export interface HotCopyReplicateSnapshot {
  workspaceId: number
  modelVersionId: number
  modelVersion: any
  sourceVideoDurationSec: number
  referenceImageCount: number
  params: Readonly<Record<string, any>>
}

/** 用户点击生成时确认的不可变报价；正式创建付费任务前必须按同一请求快照重新估价。 */
export interface HotCopyReplicateQuote {
  workspaceId: number
  operationCode: 'video.replicate'
  modelVersionId: number
  snapshotKey: string
  estimatedCost: number
  balance: number
  canAfford: boolean
}

/** 创建带稳定错误码的“所选模型不可用”错误。 */
function createHotCopyModelUnavailableError(message: string, cause?: unknown): Error {
  const error: any = new Error(message)
  error.code = HOT_COPY_MODEL_UNAVAILABLE_CODE
  if (cause !== undefined) error.cause = cause
  return error
}

/** 判断任务失败是否表示显式选择的模型已下架、无权限或不再支持当前操作。 */
export function isHotCopyModelUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const source: any = error
  if (source.code === HOT_COPY_MODEL_UNAVAILABLE_CODE) return true
  const codes = [
    source.code,
    source.response?.code,
    source.response?.error?.code,
    source.response?.data?.code,
    source.response?.data?.error?.code,
  ]
    .map((value) =>
      String(value || '')
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean)
  if (
    codes.some((code) =>
      [
        'MODEL_NOT_FOUND',
        'MODEL_VERSION_NOT_FOUND',
        'MODEL_DISABLED',
        'MODEL_NOT_ALLOWED_BY_PLAN',
        'MODEL_OPERATION_NOT_SUPPORTED',
        'OPERATION_NOT_SUPPORTED',
      ].includes(code),
    )
  ) {
    return true
  }
  const status = Number(source.status ?? source.response?.status ?? 0)
  const message = String(
    source.message ||
      source.response?.message ||
      source.response?.error?.message ||
      source.response?.data?.message ||
      '',
  ).toLowerCase()
  return (
    (status === 403 || status === 404) &&
    /model|模型|subscription|plan|套餐|operation|能力|下架|禁用|不可用/.test(message)
  )
}

/** 深复制后端 JSON 模型，避免目录刷新或调用方改写影响已经启动的任务。 */
function cloneJsonValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value)
    } catch {
      // 后端模型应是 JSON 数据；极端情况下继续用 JSON 复制兜底。
    }
  }
  return JSON.parse(JSON.stringify(value))
}

/** 递归冻结请求快照，保证估价后不会被后续预处理意外修改。 */
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  Object.values(value as Record<string, unknown>).forEach((item) => deepFreeze(item))
  return value
}

/** 读取模型版本真实主键。 */
function readHotCopyModelVersionId(model: any): number {
  return getBackendGenerationModelVersionId(model) || 0
}

/** 兼容数组、字符串和 `{ code }` 结构读取模型明确声明的操作码。 */
function collectHotCopyOperationCodes(value: unknown, result: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectHotCopyOperationCodes(item, result))
    return
  }
  if (value && typeof value === 'object') {
    const record: any = value
    collectHotCopyOperationCodes(record.code ?? record.operation_code ?? record.operationCode ?? record.value, result)
    return
  }
  if (typeof value !== 'string' && typeof value !== 'number') return
  const text = String(value).trim()
  if (!text) return
  if (text.startsWith('[')) {
    try {
      collectHotCopyOperationCodes(JSON.parse(text), result)
      return
    } catch {
      // 非法 JSON 继续按普通分隔字符串解析。
    }
  }
  text.split(/[\s,|]+/).forEach((operationCode) => {
    const normalized = operationCode.trim()
    if (normalized) result.add(normalized)
  })
}

/** 爆款复制只接受后端明确声明支持 video.replicate 的模型。 */
function assertHotCopyReplicateModel(model: any): number {
  const modelVersionId = readHotCopyModelVersionId(model)
  const hasDeclaration = HOT_COPY_OPERATION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(model || {}, key))
  const operationCodes = new Set<string>()
  HOT_COPY_OPERATION_KEYS.forEach((key) => collectHotCopyOperationCodes(model?.[key], operationCodes))
  if (!modelVersionId || !hasDeclaration || !operationCodes.has(HOT_COPY_OPERATION_CODE)) {
    throw createHotCopyModelUnavailableError('所选视频模型不支持爆款复制，请返回首页重新选择')
  }
  return modelVersionId
}

/** 校验无法由后端模型参数构建器自动覆盖的爆款复制固定输入。 */
function assertHotCopyReplicateConstraints(
  model: any,
  args: {
    durationSec?: number
    ratio?: string
    sourceVideoDurationSec?: number
    referenceImageCount?: number
  },
): { sourceVideoDurationSec: number; referenceImageCount: number } {
  const sourceVideoDurationSec = Number(args.sourceVideoDurationSec)
  if (!Number.isFinite(sourceVideoDurationSec) || sourceVideoDurationSec <= 0) {
    throw new Error('无法读取源视频真实时长，请重新选择视频后重试')
  }

  const referenceImageCount = Number(args.referenceImageCount)
  if (!Number.isSafeInteger(referenceImageCount) || referenceImageCount < 1 || referenceImageCount > 9) {
    throw new Error('爆款复制需要 1 至 9 张可用参考图片')
  }

  const durationValidation = validateSmartVideoDuration(args.durationSec ?? 10)
  if (!durationValidation.valid) {
    throw new Error('爆款复制时长必须是 1 至 15 秒内的整数')
  }
  const conflicts = getModelConstraintConflicts(buildModelRestrictionSummary(model).constraints, {
    durationSec: durationValidation.seconds,
    ratio: normalizeSeedanceRatio(args.ratio || '16:9'),
    resolution: '720p',
    generateAudio: true,
    referenceImageCount,
  })
  if (conflicts.length) {
    const modelName = getBackendGenerationModelName(model) || '所选视频模型'
    throw new Error(`${modelName} 与当前生成参数不兼容：${conflicts.join('；')}`)
  }

  return { sourceVideoDurationSec, referenceImageCount }
}

/** 将工作空间 ID 归一化为模型缓存键。 */
function hotCopyModelCacheKey(workspaceId: number): string {
  return String(Math.floor(Number(workspaceId) || 0))
}

/** 为模型查询增加独立超时上限，结束后始终清理计时器。 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/** 作废指定工作空间的爆款复制模型缓存和在途查询。 */
export function invalidateHotCopyVideoModel(workspaceId: number): void {
  const key = hotCopyModelCacheKey(workspaceId)
  hotCopyModelCache.delete(key)
  hotCopyModelPromises.delete(key)
}

/**
 * 页面空闲时预热爆款复制模型。缓存仅按工作空间复用；失败不缓存，正式提交仍会重新走原查询逻辑。
 */
export async function preloadHotCopyVideoModel(args: {
  workspaceId: number
  modelPlanCandidates?: string[]
}): Promise<any> {
  const key = hotCopyModelCacheKey(args.workspaceId)
  if (key === '0') throw new Error('工作空间 ID 无效')
  const cached = hotCopyModelCache.get(key)
  if (cached && Date.now() - cached.createdAt < HOT_COPY_MODEL_CACHE_TTL_MS && cached.model?.id) {
    return cached.model
  }
  const pending = hotCopyModelPromises.get(key)
  if (pending) return pending

  const promise = withTimeout(
    getModelForOperation('video.replicate', VIDEO_MODEL_KEYWORDS, args.modelPlanCandidates, args.workspaceId),
    HOT_COPY_MODEL_LOOKUP_TIMEOUT_MS,
    '爆款复制模型查询超时，请重试',
  )
    .then((model) => {
      if (!model?.id) {
        throw new Error('当前工作空间/套餐暂无「爆款复刻(video.replicate)」可用模型(seedance),请联系管理员开通')
      }
      hotCopyModelCache.set(key, { createdAt: Date.now(), model })
      return model
    })
    .finally(() => {
      if (hotCopyModelPromises.get(key) === promise) hotCopyModelPromises.delete(key)
    })

  hotCopyModelPromises.set(key, promise)
  return promise
}

/** 上传本地文件成 asset,返回 asset_id(type 由文件推断:视频→video,图片→image)。 */
export async function uploadHotCopyAsset(workspaceId: number, file: File): Promise<number> {
  const out: any = await uploadAssetFile({ workspaceId, file })
  return Number(out?.asset?.id || 0) || 0
}

/** 按模型 schema 构建 video.replicate 参数，确保时长、比例和声音与正式提交一致。 */
function buildReplicateVideoParams(
  model: any,
  args: { durationSec?: number; sourceVideoDurationSec?: number; ratio?: string },
): Record<string, any> {
  const durationValidation = validateSmartVideoDuration(args.durationSec ?? 10)
  if (!durationValidation.valid) {
    throw new Error('爆款复制时长必须是 1 至 15 秒内的整数')
  }
  return buildHotCopyReplicateModelParams(model, {
    durationSec: durationValidation.seconds,
    sourceVideoDurationSec: args.sourceVideoDurationSec,
    ratio: normalizeSeedanceRatio(args.ratio || '16:9'),
  })
}

/**
 * 在用户确认生成/费用时创建完整请求快照。
 * 后续估价和任务提交只读取该快照，不再重新查询目录、自动挑选或切换模型。
 */
export function createHotCopyReplicateSnapshot(args: {
  workspaceId: number
  modelVersion: any
  sourceVideoDurationSec?: number
  referenceImageCount?: number
  ratio?: string
  durationSec?: number
}): HotCopyReplicateSnapshot {
  const workspaceId = Math.floor(Number(args.workspaceId) || 0)
  if (!(workspaceId > 0)) throw new Error('工作空间 ID 无效')

  const modelVersion = cloneJsonValue(args.modelVersion)
  const modelVersionId = assertHotCopyReplicateModel(modelVersion)
  const { sourceVideoDurationSec, referenceImageCount } = assertHotCopyReplicateConstraints(modelVersion, args)
  const params = buildReplicateVideoParams(modelVersion, {
    sourceVideoDurationSec,
    ratio: args.ratio,
    durationSec: args.durationSec,
  })
  return deepFreeze({
    workspaceId,
    modelVersionId,
    modelVersion: {
      ...modelVersion,
      id: modelVersionId,
    },
    sourceVideoDurationSec,
    referenceImageCount,
    params: cloneJsonValue(params),
  })
}

/** 估价缓存键包含完整模型 schema，避免同 ID 原地更新后复用旧估价。 */
export function getHotCopyReplicateSnapshotKey(snapshot: HotCopyReplicateSnapshot | null | undefined): string {
  if (!snapshot) return ''
  return JSON.stringify([
    snapshot.workspaceId,
    HOT_COPY_OPERATION_CODE,
    snapshot.modelVersionId,
    {
      params_schema: snapshot.modelVersion?.params_schema ?? null,
      paramsSchema: snapshot.modelVersion?.paramsSchema ?? null,
    },
    snapshot.sourceVideoDurationSec,
    snapshot.referenceImageCount,
    snapshot.params,
  ])
}

/** 校验调用方传入的现成快照，并防止跨工作空间复用。 */
function resolveHotCopyReplicateSnapshot(args: {
  workspaceId: number
  requestSnapshot?: HotCopyReplicateSnapshot
  modelVersion?: any
  sourceVideoDurationSec?: number
  referenceImageCount?: number
  ratio?: string
  durationSec?: number
}): HotCopyReplicateSnapshot {
  const workspaceId = Math.floor(Number(args.workspaceId) || 0)
  if (args.requestSnapshot) {
    if (Number(args.requestSnapshot.workspaceId || 0) !== workspaceId) {
      throw new Error('爆款复制请求快照与当前工作空间不一致，请重新发起')
    }
    const modelVersionId = assertHotCopyReplicateModel(args.requestSnapshot.modelVersion)
    if (modelVersionId !== Number(args.requestSnapshot.modelVersionId || 0)) {
      throw createHotCopyModelUnavailableError('所选视频模型快照无效，请返回首页重新选择')
    }
    if (
      args.referenceImageCount !== undefined &&
      Number(args.referenceImageCount) !== Number(args.requestSnapshot.referenceImageCount)
    ) {
      throw new Error('参考图片数量与估价快照不一致，请重新发起')
    }
    return args.requestSnapshot
  }
  if (!args.modelVersion) {
    throw createHotCopyModelUnavailableError('请先选择可用的视频生成模型')
  }
  return createHotCopyReplicateSnapshot({
    workspaceId,
    modelVersion: args.modelVersion,
    sourceVideoDurationSec: args.sourceVideoDurationSec,
    referenceImageCount: args.referenceImageCount,
    ratio: args.ratio,
    durationSec: args.durationSec,
  })
}

/** 将后端 estimate-cost 响应绑定到请求快照，拒绝缺失或不可解释的计费字段。 */
export function createHotCopyReplicateQuote(
  requestSnapshot: HotCopyReplicateSnapshot,
  estimateResult: any,
): HotCopyReplicateQuote {
  const snapshot = resolveHotCopyReplicateSnapshot({
    workspaceId: requestSnapshot?.workspaceId,
    requestSnapshot,
  })
  const estimatedCost = Number(estimateResult?.estimated_cost ?? estimateResult?.estimatedCost)
  const balance = Number(estimateResult?.balance)
  if (!Number.isFinite(estimatedCost) || estimatedCost < 0 || !Number.isFinite(balance) || balance < 0) {
    const error: any = new Error('费用预估结果不完整，已停止提交，请重新估价')
    error.code = HOT_COPY_QUOTE_INVALID_CODE
    throw error
  }
  return deepFreeze({
    workspaceId: snapshot.workspaceId,
    operationCode: HOT_COPY_OPERATION_CODE,
    modelVersionId: snapshot.modelVersionId,
    snapshotKey: getHotCopyReplicateSnapshotKey(snapshot),
    estimatedCost,
    balance,
    canAfford: estimateResult?.can_afford === true || estimateResult?.canAfford === true,
  })
}

/** 按完整不可变请求快照获取一次可确认报价。 */
export async function estimateHotCopyReplicateQuote(args: {
  workspaceId: number
  requestSnapshot: HotCopyReplicateSnapshot
}): Promise<HotCopyReplicateQuote> {
  const result = await estimateReplicateCost(args)
  return createHotCopyReplicateQuote(args.requestSnapshot, result)
}

/** 校验报价确实由当前模型、operation、params 与 schema 快照产生。 */
function assertHotCopyReplicateQuoteMatchesSnapshot(
  snapshot: HotCopyReplicateSnapshot,
  confirmedQuote: HotCopyReplicateQuote | null | undefined,
): HotCopyReplicateQuote {
  const snapshotKey = getHotCopyReplicateSnapshotKey(snapshot)
  const quote = confirmedQuote
  const valid =
    quote &&
    quote.workspaceId === snapshot.workspaceId &&
    quote.operationCode === HOT_COPY_OPERATION_CODE &&
    quote.modelVersionId === snapshot.modelVersionId &&
    quote.snapshotKey === snapshotKey &&
    Number.isFinite(quote.estimatedCost) &&
    quote.estimatedCost >= 0 &&
    Number.isFinite(quote.balance) &&
    quote.balance >= 0
  if (!valid) {
    const error: any = new Error('视频费用确认快照已失效，已停止提交，请重新确认')
    error.code = HOT_COPY_QUOTE_INVALID_CODE
    throw error
  }
  if (!quote.canAfford) {
    const error: any = new Error('积分余额不足，已停止提交，请充值后重新确认')
    error.code = HOT_COPY_QUOTE_INVALID_CODE
    throw error
  }
  return quote
}

/** 创建付费任务前强制重新估价；价格变化或余额不足时 fail closed。 */
async function revalidateHotCopyReplicateQuoteBeforeSubmission(
  snapshot: HotCopyReplicateSnapshot,
  confirmedQuote: HotCopyReplicateQuote | null | undefined,
): Promise<HotCopyReplicateQuote> {
  const confirmed = assertHotCopyReplicateQuoteMatchesSnapshot(snapshot, confirmedQuote)
  const current = await estimateHotCopyReplicateQuote({
    workspaceId: snapshot.workspaceId,
    requestSnapshot: snapshot,
  })
  if (current.estimatedCost !== confirmed.estimatedCost) {
    const error: any = new Error(
      `本次生成费用已从 ${confirmed.estimatedCost} 积分变为 ${current.estimatedCost} 积分，已停止提交，请重新确认`,
    )
    error.code = HOT_COPY_QUOTE_CHANGED_CODE
    error.hotCopyQuote = current
    throw error
  }
  if (!current.canAfford) {
    const error: any = new Error('积分余额不足，已停止提交，请充值后重新确认')
    error.code = HOT_COPY_QUOTE_CHANGED_CODE
    error.hotCopyQuote = current
    throw error
  }
  return current
}

/** 解析已完成任务的视频地址；资产尚在入库时抛出可恢复的待就绪错误。 */
async function resolveCompletedHotCopyVideo(
  workspaceId: number,
  completed: any,
  taskId: number,
  pendingMessage: string,
): Promise<{ url: string; assetId: number }> {
  try {
    const result = await resolveTaskVideoResult(workspaceId, completed, taskId)
    if (result.url) return result
  } catch (cause) {
    const error: any = new Error(pendingMessage)
    error.code = 'TASK_MEDIA_PENDING'
    error.hotCopyTaskId = taskId
    error.cause = cause
    throw error
  }
  const error: any = new Error(pendingMessage)
  error.code = 'TASK_MEDIA_PENDING'
  error.hotCopyTaskId = taskId
  throw error
}

/**
 * 爆款做同款。返回 { url, assetId }(成片视频)。
 * @param videoAssetId   源视频 asset_id(role=video)
 * @param productAssetIds 主体/替换产品图 asset_id(role=image,1~9)
 * @param prompt         替换意图(如「把源视频里的产品换成 @产品图,保留节奏」)
 */
export async function replicateHotVideo(args: {
  workspaceId: number
  videoAssetId: number
  productAssetIds?: number[]
  prompt?: string
  ratio?: string
  durationSec?: number
  /** 源视频真实时长(秒):video.replicate 按它计费(优先于 duration),前端读源视频 HTML5 元数据得到 */
  sourceVideoDurationSec?: number
  modelPlanCandidates?: string[]
  /** 兼容旧调用的显式模型；不会再自动查询或切换其他模型。 */
  modelVersion?: any
  /** 用户确认生成时冻结的模型、工作空间和规范化参数。付费提交必须显式提供。 */
  requestSnapshot: HotCopyReplicateSnapshot
  /** 用户点击生成时确认的报价；正式创建付费任务前会按同一快照强制重新估价。 */
  confirmedQuote: HotCopyReplicateQuote
  signal?: AbortSignal
  /** 持久化 generation/context 对应的稳定幂等键。 */
  idempotencyKey?: string
  /** 任务创建后回调 task_id:供前端持久化,刷新/切换后用 awaitHotVideoResult 续轮询(不丢在途生成) */
  onTask?: (taskId: number) => void
  /** 后端任务返回的真实进度；后端未提供进度时不回调。 */
  onProgress?: (progress: number) => void
}): Promise<{ url: string; assetId: number }> {
  const products = (args.productAssetIds || []).filter((n) => Number(n) > 0).slice(0, 9)
  const inputAssets = [
    { asset_id: args.videoAssetId, role: 'video' },
    ...products.map((id) => ({ asset_id: id, role: 'image' })),
  ]
  // 用户确认后只使用同一个不可变快照；禁止在素材预处理后重新读实时目录或自动换模型。
  const snapshot = resolveHotCopyReplicateSnapshot({
    ...args,
    referenceImageCount: products.length,
  })
  const model = snapshot.modelVersion
  await revalidateHotCopyReplicateQuoteBeforeSubmission(snapshot, args.confirmedQuote)
  let task
  try {
    task = await createAiTask({
      workspaceId: args.workspaceId,
      capability: 'video',
      operationCode: 'video.replicate',
      modelVersionId: snapshot.modelVersionId,
      modelVersion: model,
      idempotencyKey: String(args.idempotencyKey || '').trim() || undefined,
      signal: args.signal,
      prompt: args.prompt || '保留源视频的镜头节奏与爆点结构,把主体替换为参考图中的产品。',
      inputAssets,
      // 时长/比例按用户在入口的选择下发 —— 与智能成片 generateFullVideo 同一写法:始终走
      // buildVideoGenerationParams(其内部按模型 schema 决定字段名/取值;无 schema 时也下发标准
      // duration/resolution/ratio,保证用户所选时长/比例生效)。source_video_duration 仅在模型 schema
      // 声明时下发,用于「按源视频真实时长计费」,与 duration 不冲突。
      params: snapshot.params,
    })
  } catch (error) {
    if (isHotCopyModelUnavailableError(error)) {
      throw createHotCopyModelUnavailableError('所选视频模型已下架或当前空间不可用，请返回首页重新选择', error)
    }
    throw error
  }
  const taskId = getAiTaskId(task)
  if (!taskId) throw new Error('爆款复制任务创建后未返回任务 ID')
  args.onTask?.(taskId)
  const completed = await waitForAiTask({
    workspaceId: args.workspaceId,
    task,
    intervalMs: 4000,
    timeoutMs: HOT_COPY_VIDEO_TIMEOUT_MS,
    signal: args.signal,
    onPoll: (currentTask: any) => {
      const progress = readAiTaskProgress(currentTask)
      if (progress !== undefined) args.onProgress?.(progress)
    },
  })
  return resolveCompletedHotCopyVideo(
    args.workspaceId,
    completed,
    getAiTaskId(completed) || taskId,
    '复刻任务已完成，视频仍在入库，请稍后自动重试',
  )
}

/**
 * 按 task_id 续等一个【已创建】的视频任务结果(刷新/切换页面后恢复在途生成用)。
 * 与 replicateHotVideo / editFullVideo 的收尾一致:轮询到完成 → 取 asset_id + 可预览地址。
 */
export async function awaitHotVideoResult(args: {
  workspaceId: number
  taskId: number
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}): Promise<{ url: string; assetId: number }> {
  const taskId = getAiTaskId({ id: args.taskId })
  if (!taskId) throw new Error('爆款复制任务 ID 无效')
  const completed = await waitForAiTask({
    workspaceId: args.workspaceId,
    task: { id: taskId, status: 'processing' },
    intervalMs: 4000,
    timeoutMs: HOT_COPY_VIDEO_TIMEOUT_MS,
    signal: args.signal,
    onPoll: (currentTask: any) => {
      const progress = readAiTaskProgress(currentTask)
      if (progress !== undefined) args.onProgress?.(progress)
    },
  })
  return resolveCompletedHotCopyVideo(
    args.workspaceId,
    completed,
    taskId,
    '视频任务已完成，视频仍在入库，请稍后自动重试',
  )
}

/**
 * 做同款(video.replicate)提交前积分预估。估价用的 model/operation/params 必须与 replicateHotVideo 一致。
 * 按源视频真实时长 source_video_duration 计费(schema 声明才下发,优先于 duration)。
 */
export async function estimateReplicateCost(args: {
  workspaceId: number
  sourceVideoDurationSec?: number
  referenceImageCount?: number
  ratio?: string
  durationSec?: number
  modelPlanCandidates?: string[]
  /** 兼容旧调用的显式模型；不会再自动查询或切换其他模型。 */
  modelVersion?: any
  /** 用户确认费用时冻结的模型、工作空间和规范化参数。 */
  requestSnapshot?: HotCopyReplicateSnapshot
}): Promise<any> {
  const snapshot = resolveHotCopyReplicateSnapshot(args)
  try {
    return await withTimeout(
      estimateAiTaskCost({
        workspaceId: snapshot.workspaceId,
        modelVersionId: snapshot.modelVersionId,
        operationCode: 'video.replicate',
        params: snapshot.params,
      }),
      HOT_COPY_ESTIMATE_TIMEOUT_MS,
      '视频费用预估超时，请稍后重试',
    )
  } catch (error) {
    if (isHotCopyModelUnavailableError(error)) {
      throw createHotCopyModelUnavailableError('所选视频模型已下架或当前空间不可用，请重新选择', error)
    }
    throw error
  }
}
