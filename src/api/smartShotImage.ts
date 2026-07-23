/**
 * 智能成片 — 镜头编排:分镜图生成(走业务后端 /ai/tasks 文/图生图,同 2.0)。
 * 每个镜头按 画面描述 + 该镜头素材(参考图)生成;为保持连贯,第 2 镜起额外带上
 * 上一张已生成的分镜图作为参考图。本地图片(objectURL/dataURL)会先上传成 asset 取得 asset_id。
 */
// @ts-nocheck
import {
  createAiTask,
  waitForAiTask,
  cancelAiTask,
  isAbortedTaskError,
  uploadAssetFile,
  extractTaskMediaUrls,
  getAssetDownloadUrl,
  resolveTaskModel,
  estimateAiTaskCost,
  getAiTaskId,
  normalizeAiTaskStatus,
} from './business'
import { resolveGeneratedMediaUrls, findAssetIdByTaskId, extractOutputAssetId } from '@/utils/taskMedia'
import { buildStoryboardImageParams } from '@/utils/storyboardTasks'
import { getModelParamFields } from '@/utils/modelSchema'

/** 从模型尺寸选项中选出像素量最小的一档，兼容分辨率、K 和纯数字写法。 */
function smallestSize(options: string[]): string {
  const score = (s: string) => {
    const px = s.match(/(\d+)\s*[x×]\s*(\d+)/i)
    if (px) return Number(px[1]) * Number(px[2])
    const k = s.match(/(\d+(?:\.\d+)?)\s*k/i)
    if (k) return Number(k[1]) * 1e6
    const n = Number(s.replace(/[^\d.]/g, ''))
    return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY
  }
  return [...options].sort((a, b) => score(a) - score(b))[0]
}

/**
 * 严格按模型 params_schema 构建出图参数，避免 provider 拒绝未声明字段。
 * lowRes 仅在模型声明 size 时选最小档，watermark 也只在 schema 存在时下发。
 */
function buildImageParams(model: any, ratio?: string, lowRes?: boolean) {
  const params: any = buildStoryboardImageParams(model, ratio)
  const fields = getModelParamFields(model)
  // 仅当模型声明了 watermark 字段才显式关水印(如 doubao-seedream);gpt-image-2 无此字段则不下发。
  if (fields.some((f: any) => f?.name === 'watermark')) params.watermark = false
  if (lowRes) {
    const sizeField = fields.find((f: any) => f?.name === 'size')
    const opts = Array.isArray(sizeField?.options) ? sizeField.options.map(String) : []
    if (opts.length) params[sizeField.name] = smallestSize(opts)
  }
  return params
}

/** 以调用方缓存对象为生命周期，隔离在途上传与 URL 所属工作空间。 */
const pendingAssetUploads = new WeakMap<Record<string, number>, Map<string, Promise<number>>>()
/** 记录每个 URL 缓存 asset_id 所属的工作空间，防止跨空间复用。 */
const cachedAssetWorkspaces = new WeakMap<Record<string, number>, Map<string, number>>()

/** 将资产 ID 归一化为正安全整数，非法值统一返回 0。 */
function validAssetId(value: unknown): number {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : 0
}

/** 把图片(objectURL / dataURL / http)上传为后端素材,返回 asset_id;带缓存避免重复上传。 */
export async function ensureAssetId(
  workspaceId: number,
  url: string,
  cache: Record<string, number> = {},
): Promise<number> {
  if (!url) return 0
  const normalizedWorkspaceId = validAssetId(workspaceId)
  const cachedId = validAssetId(cache[url])
  if (cachedId) {
    let cacheWorkspaces = cachedAssetWorkspaces.get(cache)
    if (!cacheWorkspaces) {
      cacheWorkspaces = new Map()
      cachedAssetWorkspaces.set(cache, cacheWorkspaces)
    }
    const cachedWorkspaceId = cacheWorkspaces.get(url)
    if (cachedWorkspaceId === undefined) {
      cacheWorkspaces.set(url, normalizedWorkspaceId)
      return cachedId
    }
    if (cachedWorkspaceId === normalizedWorkspaceId) return cachedId
  }

  let cacheUploads = pendingAssetUploads.get(cache)
  if (!cacheUploads) {
    cacheUploads = new Map()
    pendingAssetUploads.set(cache, cacheUploads)
  }
  const uploadKey = `${normalizedWorkspaceId}:${url}`
  const pending = cacheUploads.get(uploadKey)
  if (pending) return pending

  const upload = (async () => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`图片读取失败（HTTP ${res.status || 0}）`)
    const blob = await res.blob()
    const type = blob.type || 'image/jpeg'
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
    const file = new File([blob], `ref_${Math.floor(performance.now())}.${ext}`, { type })
    const out = await uploadAssetFile({ workspaceId, file })
    const id = validAssetId(out?.asset?.id)
    if (id) {
      cache[url] = id
      let cacheWorkspaces = cachedAssetWorkspaces.get(cache)
      if (!cacheWorkspaces) {
        cacheWorkspaces = new Map()
        cachedAssetWorkspaces.set(cache, cacheWorkspaces)
      }
      cacheWorkspaces.set(url, normalizedWorkspaceId)
    }
    return id
  })()
  cacheUploads.set(uploadKey, upload)
  try {
    return await upload
  } finally {
    if (cacheUploads.get(uploadKey) === upload) cacheUploads.delete(uploadKey)
    if (!cacheUploads.size) pendingAssetUploads.delete(cache)
  }
}

/**
 * 把图片落库成后端 asset(供持久化):dataURL/blob 会上传取得 asset_id + 签名URL;
 * 已是 http 的原样返回。这样草稿里存的是可持久的 http URL,刷新/重进不丢图。
 */
export async function persistImageAsset(
  workspaceId: number,
  url: string,
  cache: Record<string, number> = {},
): Promise<{ url: string; assetId: number }> {
  if (!url) return { url: '', assetId: 0 }
  if (!/^(data:|blob:)/.test(url)) return { url, assetId: 0 } // 已是后端/外链 http,无需上传
  let assetId = 0
  try {
    assetId = await ensureAssetId(workspaceId, url, cache)
  } catch {
    return { url, assetId: 0 } // 上传失败:本会话内仍用 dataURL
  }
  if (!assetId) return { url, assetId: 0 }
  let hosted = url
  try {
    hosted = (await getAssetDownloadUrl({ workspaceId, assetId })) || url
  } catch {
    /* 取签名URL失败,保留原 url */
  }
  return { url: hosted, assetId }
}

/** 按 asset_id 重新取签名URL(签名会过期,加载时刷新)。失败返回空。 */
export async function refreshAssetUrl(workspaceId: number, assetId: number): Promise<string> {
  const validId = validAssetId(assetId)
  if (!validId) return ''
  try {
    return (await getAssetDownloadUrl({ workspaceId, assetId: validId })) || ''
  } catch {
    return ''
  }
}

/** 分镜图模型偏好、任务重试退避与资产入库就绪等待策略。 */
const STORYBOARD_MODEL_KEYWORDS = ['gpt-image-2', 'gpt-image', 'gpt image', 'seedream', 'doubao']
/** 分镜图任务提交/轮询暂时失败的退避表。 */
const IMAGE_TASK_RETRY_DELAYS_MS = [1200, 2400]
/** 任务完成后等待资产实际可下载的退避表。 */
const ASSET_READY_RETRY_DELAYS_MS = [800, 1600, 3200, 5000]

/** 汇总供应商错误中的可读信息与任务数据，兼容创建和轮询两种错误信封。 */
function getShotImageErrorContext(error: any): {
  message: string
  task: Record<string, any>
  response: Record<string, any>
} {
  const response = error?.response && typeof error.response === 'object' ? error.response : {}
  const data = response?.data && typeof response.data === 'object' ? response.data : response
  let task = data
  if (data?.task && typeof data.task === 'object') task = data.task
  else if (response?.task && typeof response.task === 'object') task = response.task
  const message = [
    error?.message,
    response?.message,
    response?.error_message,
    response?.error?.message,
    task?.message,
    task?.error_message,
    task?.failure_reason,
  ]
    .filter(Boolean)
    .join(' ')
  return { message, task, response }
}

/** 内容审核是确定性业务结果，不能当作网络/上游暂时故障使用同一幂等键重试。 */
function isShotImageContentSafetyError(error: any): boolean {
  const { message } = getShotImageErrorContext(error)
  return /安全审核|内容审核|内容安全|未通过.{0,8}审核|审核未通过|敏感内容|版权限制|SensitiveContentDetected|PrivacyInformation|copyright|content policy|policy violation|moderation|safety review/i.test(
    message,
  )
}

/**
 * 只识别“供应商已经生成候选结果、结果审核未通过、且确认未计费”的随机失败。
 * 输入审核、缺少结算字段、已经计费或仍有输出的任务都必须原样失败，不能自动重采样。
 */
function isUnbilledGeneratedOutputSafetyError(error: any): boolean {
  const { message, task, response } = getShotImageErrorContext(error)
  const codes = [error?.code, response?.code, response?.code_string, task?.code, task?.code_string]
    .map((value) =>
      String(value ?? '')
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean)
  if (Number(error?.status || 0) !== 502 || (!codes.includes('10502') && !codes.includes('PROVIDER_FAILED'))) {
    return false
  }
  const generatedOutputRejected =
    /(?:生成|输出)(?:的)?内容.{0,16}(?:未通过|审核失败|被.{0,4}(?:拦截|拒绝)).{0,16}(?:安全审核|内容审核)|(?:生成|输出)(?:的)?内容.{0,16}(?:安全审核|内容审核).{0,12}(?:未通过|失败|拒绝|拦截)|(?:generated|output).{0,32}(?:content|image).{0,32}(?:safety|moderation).{0,20}(?:reject|block|fail)/i.test(
      message,
    )
  if (!generatedOutputRejected) return false

  const actualCost = task?.actual_cost
  const status = normalizeAiTaskStatus(task?.status)
  const outputs = task?.outputs
  return (
    getAiTaskId(task) > 0 &&
    typeof actualCost === 'number' &&
    Number.isFinite(actualCost) &&
    actualCost === 0 &&
    status === 'failed' &&
    Array.isArray(outputs) &&
    outputs.length === 0
  )
}

/** 创建统一的分镜图取消异常，便于上层与任务失败区分。 */
function createShotImageCancelledError() {
  const error: any = new Error('分镜图生成已取消')
  error.code = 'TASK_CANCELLED'
  error.cause = 'aborted'
  return error
}

/** 在每个可中断阶段前立即检查调用方的 AbortSignal。 */
function ensureShotImageNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createShotImageCancelledError()
}

/** 可被 AbortSignal 打断的退避等待，完成后会清理计时器和监听器。 */
const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    ensureShotImageNotAborted(signal)
    let timer = 0
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(createShotImageCancelledError())
    }
    timer = window.setTimeout(
      () => {
        cleanup()
        resolve()
      },
      Math.max(0, ms),
    )
    signal?.addEventListener('abort', onAbort, { once: true })
  })

/** 只将网络、限流、上游和服务端暂时故障判定为可重试，取消不重试。 */
function isRetryableShotImageError(error: any): boolean {
  if (isAbortedTaskError(error)) return false
  if (isShotImageContentSafetyError(error)) return false
  const status = Number(error?.status || 0)
  if (status === 0 || status === 429 || status >= 500) return true
  const code = String(error?.code || '').toUpperCase()
  const msg = String(error?.message || '').toLowerCase()
  const inner = String(
    error?.response?.message ||
      error?.response?.error_message ||
      error?.response?.error?.message ||
      error?.response?.data?.message ||
      '',
  ).toLowerCase()
  if (code === 'INTERNAL_ERROR' || code === '50008') return true
  return /context canceled|provider task failed|status failed|upstream|internal.*error|internal_error|服务内部错误|服务器内部错误|网络请求失败|网络请求超时/i.test(
    `${msg} ${inner}`,
  )
}

/** 识别后端已明确确认图片任务进入不可恢复终态；普通 5xx/断网不能算终态。 */
export function isTerminalShotImageTaskError(error: any): boolean {
  const { task, response } = getShotImageErrorContext(error)
  const status = normalizeAiTaskStatus(
    task?.status ?? response?.task?.status ?? response?.data?.task?.status ?? response?.data?.status,
  )
  return ['failed', 'error', 'payment_failed', 'cancelled', 'expired'].includes(status)
}

/**
 * 只识别 provider 明确表示不支持图生图的错误。
 * 网络或结果解析失败不能在此回退，否则可能额外创建一个计费任务。
 */
function isExplicitlyUnsupportedImageToImageError(error: any): boolean {
  const code = String(error?.code || error?.response?.code || error?.response?.code_string || '')
    .trim()
    .toUpperCase()
  if (
    [
      'MODEL_NOT_FOUND',
      'MODEL_OPERATION_NOT_SUPPORTED',
      'OPERATION_NOT_SUPPORTED',
      'UNSUPPORTED_OPERATION',
      'NOT_SUPPORTED',
    ].includes(code)
  ) {
    return true
  }

  const message = [
    error?.message,
    error?.response?.message,
    error?.response?.error_message,
    error?.response?.error?.message,
    error?.response?.data?.message,
  ]
    .filter(Boolean)
    .join(' ')
  return /(?:image\.image_to_image|image[-_\s]?to[-_\s]?image|图生图).{0,40}(?:not supported|unsupported|not available|不支持|未开通|不可用)|(?:not supported|unsupported|不支持).{0,40}(?:image\.image_to_image|image[-_\s]?to[-_\s]?image|图生图)|input asset role .*(?:not allowed|unsupported)/i.test(
    message,
  )
}

/** 为一次用户出图操作生成稳定幂等根键，各执行阶段在其上派生。 */
function createShotImageIdempotencyRoot(): string {
  const randomId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `shot_image_${randomId}`
}

/** 在同一阶段内做有界重试；AbortSignal 中断后不会继续执行下一次尝试。 */
async function retryShotImageStage<T>(
  run: () => Promise<T>,
  shouldRetry: (error: any) => boolean,
  signal?: AbortSignal,
  maxRetries = IMAGE_TASK_RETRY_DELAYS_MS.length,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    ensureShotImageNotAborted(signal)
    try {
      const result = await run()
      ensureShotImageNotAborted(signal)
      return result
    } catch (error: any) {
      ensureShotImageNotAborted(signal)
      if (attempt >= maxRetries || !shouldRetry(error)) throw error
      await delay(
        IMAGE_TASK_RETRY_DELAYS_MS[attempt] ||
          IMAGE_TASK_RETRY_DELAYS_MS[IMAGE_TASK_RETRY_DELAYS_MS.length - 1] ||
          1200,
        signal,
      )
    }
  }
}

/** 判断地址是否为应用同源的资产下载端点，仅此类地址需做入库就绪探测。 */
function isSameOriginAssetDownload(url: string): boolean {
  if (!url) return false
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const parsed = new URL(url, base)
    return parsed.origin === base && /^\/api\/v1\/assets\/\d+\/download$/i.test(parsed.pathname)
  } catch {
    return false
  }
}

/** 对同源资产地址按退避表探测可读性，外部地址不主动请求。 */
async function waitForDisplayUrl(url: string, signal?: AbortSignal): Promise<string> {
  if (!url) return ''
  if (!isSameOriginAssetDownload(url)) return url

  for (let attempt = 0; attempt <= ASSET_READY_RETRY_DELAYS_MS.length; attempt++) {
    ensureShotImageNotAborted(signal)
    try {
      const res = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'image/*,*/*;q=0.8' },
        signal,
      })
      try {
        await res.body?.cancel?.()
      } catch {
        /* ignore */
      }
      if (res.ok) {
        ensureShotImageNotAborted(signal)
        return url
      }
    } catch (e: any) {
      if (signal?.aborted || String(e?.name || '') === 'AbortError') throw createShotImageCancelledError()
    }
    if (attempt < ASSET_READY_RETRY_DELAYS_MS.length) await delay(ASSET_READY_RETRY_DELAYS_MS[attempt], signal)
  }

  return ''
}

/** 按后端给出的顺序返回首个已就绪的可展示地址。 */
async function firstReadyDisplayUrl(urls: string[], signal?: AbortSignal): Promise<string> {
  for (const url of urls || []) {
    const ready = await waitForDisplayUrl(url, signal)
    if (ready) return ready
  }
  return ''
}

export type ShotImageGenerationResult = { url: string; assetId: number }

/**
 * 等待一个已经创建的分镜图任务。
 * cancelRemoteOnAbort 只供首次提交链路使用；恢复链路中断时仅停止本地等待，后端任务继续执行。
 */
async function waitForShotImageTask(args: {
  workspaceId: number
  taskId: number
  task?: any
  signal?: AbortSignal
  onTask?: (taskId: number) => void
  cancelRemoteOnAbort?: boolean
}): Promise<any> {
  const taskId = getAiTaskId({ id: args.taskId })
  if (!taskId) throw new Error('分镜图生成任务 ID 无效')

  args.onTask?.(taskId)

  const cancelRemoteTask = async () => {
    if (!args.cancelRemoteOnAbort) return
    try {
      await cancelAiTask({ workspaceId: args.workspaceId, taskId })
    } catch {
      /* ignore */
    }
  }

  if (args.signal?.aborted) {
    await cancelRemoteTask()
    throw createShotImageCancelledError()
  }

  return retryShotImageStage(
    async () => {
      try {
        // 每次重试都只按同一个 taskId 查询，绝不回到 createAiTask，避免重复计费。
        return await waitForAiTask({
          workspaceId: args.workspaceId,
          task: {
            ...(args.task || {}),
            id: taskId,
            status: normalizeAiTaskStatus(args.task?.status) || 'processing',
          },
          timeoutMs: 30 * 60 * 1000,
          signal: args.signal,
        })
      } catch (error: any) {
        if (isAbortedTaskError(error) || args.signal?.aborted) {
          await cancelRemoteTask()
          throw createShotImageCancelledError()
        }
        throw error
      }
    },
    (error) => !isTerminalShotImageTaskError(error) && isRetryableShotImageError(error),
    args.signal,
  )
}

/** 把已完成的分镜图任务解析为可展示 URL 与持久化 asset_id。 */
async function resolveShotImageTaskResult(args: {
  workspaceId: number
  completed: any
  taskId: number
  signal?: AbortSignal
}): Promise<ShotImageGenerationResult> {
  ensureShotImageNotAborted(args.signal)
  let assetId = validAssetId(extractOutputAssetId(args.completed))
  if (!assetId) {
    assetId = validAssetId(
      await findAssetIdByTaskId(args.workspaceId, getAiTaskId(args.completed) || args.taskId, 'image'),
    )
  }

  let url = assetId
    ? await getAssetDownloadUrl({ workspaceId: args.workspaceId, assetId })
        .then((item) => waitForDisplayUrl(item, args.signal))
        .catch(() => {
          ensureShotImageNotAborted(args.signal)
          return ''
        })
    : ''
  if (!url) url = await firstReadyDisplayUrl(extractTaskMediaUrls(args.completed), args.signal)
  if (!url) {
    const urls = await resolveGeneratedMediaUrls({
      workspaceId: args.workspaceId,
      task: args.completed,
      type: 'image',
    })
    url = await firstReadyDisplayUrl(urls, args.signal)
  }
  if (!url) throw new Error('未生成分镜图')
  return { url, assetId }
}

/**
 * 按 taskId 恢复一个已提交的图片任务：只续轮询并解析结果，不会调用 createAiTask 或重新计费。
 * AbortSignal 只中断本地等待，不取消后端任务，之后仍可使用同一个 taskId 再次恢复。
 */
export async function resumeShotImageGeneration(args: {
  workspaceId: number
  taskId: number
  signal?: AbortSignal
}): Promise<ShotImageGenerationResult> {
  const taskId = getAiTaskId({ id: args.taskId })
  if (!taskId) throw new Error('分镜图生成任务 ID 无效')

  const completed = await waitForShotImageTask({
    workspaceId: args.workspaceId,
    taskId,
    task: { id: taskId, status: 'processing' },
    signal: args.signal,
  })

  return retryShotImageStage(
    () =>
      resolveShotImageTaskResult({
        workspaceId: args.workspaceId,
        completed,
        taskId,
        signal: args.signal,
      }),
    (error) => !isAbortedTaskError(error) && !args.signal?.aborted,
    args.signal,
  )
}

/**
 * 生成一张分镜图。refAssetIds 为参考图 asset_id(该镜头素材 + 上一张分镜图)。
 * modelPlanCandidates 需传当前工作空间真实套餐候选(否则默认 free 查不到付费图像模型)。
 * 返回 { url, assetId }。
 */
export async function generateShotImage(args: {
  workspaceId: number
  prompt: string
  refAssetIds?: number[]
  modelPlanCandidates?: string[]
  ratio?: string
  /** 最低分辨率出图(素材元素用,省时省额度) */
  lowRes?: boolean
  /** 前端中断当前等待链路 */
  signal?: AbortSignal
  /** 任务一创建就抛出 taskId,供上层在需要时主动 cancel */
  onTask?: (taskId: number) => void
  /** 同一次用户动作的稳定幂等根键；省略时本次调用自动创建。 */
  idempotencyKey?: string
  /** 图生图不可用时是否允许退回文生图；需要严格匹配费用确认的场景应设为 false。 */
  allowTextToImageFallback?: boolean
}): Promise<{ url: string; assetId: number }> {
  const refs = (args.refAssetIds || []).filter((n) => Number(n) > 0)
  const idempotencyRoot = String(args.idempotencyKey || '').trim() || createShotImageIdempotencyRoot()
  let outputSafetyRetryUsed = false

  const submitShotTask = async (
    operationCode: string,
    inputAssetIds: number[],
    idempotencyKey: string,
  ): Promise<{ task: any; taskId: number }> =>
    retryShotImageStage(
      async () => {
        const task = await createAiTask({
          workspaceId: args.workspaceId,
          capability: 'image',
          operationCode,
          preferredModelKeywords: STORYBOARD_MODEL_KEYWORDS,
          ...(args.modelPlanCandidates?.length ? { modelPlanCandidates: args.modelPlanCandidates } : {}),
          idempotencyKey,
          signal: args.signal,
          prompt: args.prompt,
          inputAssets: inputAssetIds.map((id) => ({ asset_id: id, role: 'reference_image' })),
          params: (model: any) => buildImageParams(model, args.ratio, args.lowRes),
        })
        const taskId = getAiTaskId(task)
        if (!taskId) {
          const error: any = new Error('分镜图任务创建后未返回任务 ID')
          error.status = 502
          throw error
        }
        return { task, taskId }
      },
      isRetryableShotImageError,
      args.signal,
    )

  const runShotTask = async (
    operationCode: string,
    inputAssetIds: number[],
    operationKey: string,
  ): Promise<{ url: string; assetId: number }> => {
    const { task, taskId } = await submitShotTask(operationCode, inputAssetIds, operationKey)
    const completed = await waitForShotImageTask({
      workspaceId: args.workspaceId,
      task,
      taskId,
      signal: args.signal,
      onTask: args.onTask,
      cancelRemoteOnAbort: true,
    })
    // Completed tasks may become visible in the asset service slightly later.
    // Retry result resolution only; never submit another provider task.
    return retryShotImageStage(
      () =>
        resolveShotImageTaskResult({
          workspaceId: args.workspaceId,
          completed,
          taskId,
          signal: args.signal,
        }),
      (error) => !isAbortedTaskError(error) && !args.signal?.aborted,
      args.signal,
    )
  }

  /**
   * 供应商偶尔会生成一个随后被输出审核丢弃的候选图。仅当后端明确返回 actual_cost=0、
   * failed 且 outputs 为空时，用新的幂等键重新采样一次；其余审核错误绝不自动重试。
   */
  const runShotTaskWithOutputSafetyRetry = async (
    operationCode: string,
    inputAssetIds: number[],
    operationKey: string,
  ): Promise<{ url: string; assetId: number }> => {
    try {
      return await runShotTask(operationCode, inputAssetIds, operationKey)
    } catch (error) {
      if (outputSafetyRetryUsed || !isUnbilledGeneratedOutputSafetyError(error)) throw error
      ensureShotImageNotAborted(args.signal)
      outputSafetyRetryUsed = true
      return runShotTask(operationCode, inputAssetIds, `${operationKey}_output_safety_retry`)
    }
  }

  if (!refs.length) {
    return runShotTaskWithOutputSafetyRetry('image.text_to_image', [], `${idempotencyRoot}_text_to_image`)
  }

  try {
    return await runShotTaskWithOutputSafetyRetry('image.image_to_image', refs, `${idempotencyRoot}_image_to_image`)
  } catch (error) {
    // Only an explicit capability/operation rejection permits a text-to-image
    // fallback. Network, polling, provider, and result-URL errors may describe
    // a task that already ran and must not silently create a second charge.
    if (args.allowTextToImageFallback === false || !isExplicitlyUnsupportedImageToImageError(error)) throw error
    return runShotTaskWithOutputSafetyRetry('image.text_to_image', [], `${idempotencyRoot}_text_to_image_fallback`)
  }
}

/**
 * 单张分镜图(image.text_to_image / image_to_image)提交前积分预估。
 * 估价用的 model/operation/params 与 generateShotImage 一致 → 预估 = 实扣(单张口径)。
 */
export async function estimateShotImageCost(args: {
  workspaceId: number
  hasRefs?: boolean
  ratio?: string
  lowRes?: boolean
  modelPlanCandidates?: string[]
}): Promise<any> {
  const operationCode = args.hasRefs ? 'image.image_to_image' : 'image.text_to_image'
  // 与出片同口径解析模型(capability:'image' + 套餐候选);先按关键词(gpt-image-2)、查不到退回任意图像模型。
  const pick = (kw: string[]) =>
    resolveTaskModel({
      capability: 'image',
      operationCode,
      preferredModelKeywords: kw,
      modelPlanCandidates: args.modelPlanCandidates,
    }).catch(() => null)
  let model = await pick(STORYBOARD_MODEL_KEYWORDS)
  if (!model?.id) model = await pick([])
  if (!model?.id) throw new Error('暂无可用的图像生成模型')
  const params = buildImageParams(model, args.ratio, args.lowRes)
  return estimateAiTaskCost({ workspaceId: args.workspaceId, modelVersionId: model.id, operationCode, params })
}
