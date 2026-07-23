/**
 * 爆款复制 — 走后端 video.replicate(「爆款做同款」)能力:
 * 1 段源视频(role=video,≤200MB)+ 1~9 张主体图(role=image),prompt 写替换意图。
 * 后端内部 AI 拆解源视频后用 Seedance 重新生成,异步轮询取结果。一次成片(非可编辑分镜)。
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
import { buildVideoGenerationParams } from '@/utils/videoTasks'
import { normalizeSeedanceRatio, normalizeSeedanceDuration } from '@/utils/videoOptions'
import { resolveTaskVideoResult } from '@/utils/taskMedia'
import { readAiTaskProgress } from '@/utils/taskProgress'

/** 爆款复制的模型筛选、任务超时与模型预热缓存策略。 */
const VIDEO_MODEL_KEYWORDS = ['seedance']
/** 爆款复制视频生成任务的最大等待时间。 */
const HOT_COPY_VIDEO_TIMEOUT_MS = 60 * 60 * 1000
/** 正式提交前模型查询的超时时间。 */
const HOT_COPY_MODEL_LOOKUP_TIMEOUT_MS = 8000
/** 按工作空间预热模型的缓存有效期。 */
const HOT_COPY_MODEL_CACHE_TTL_MS = 5 * 60 * 1000
/** 已成功解析的爆款复制模型缓存。 */
const hotCopyModelCache = new Map()
/** 正在进行的模型查询单飞 Promise 缓存。 */
const hotCopyModelPromises = new Map()

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
  return {
    generate_audio: true,
    ...buildVideoGenerationParams(model, {
      duration: normalizeSeedanceDuration(args.durationSec || 10),
      sourceVideoDuration: args.sourceVideoDurationSec,
      resolution: '720p',
      ratio: normalizeSeedanceRatio(args.ratio || '16:9'),
      generateAudio: true,
    }),
  }
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
  /** 页面空闲时预热得到的模型；缺失时仍按原逻辑实时查询。 */
  modelVersion?: any
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
  // 钉死 seedance,不做跨模型退避:先显式解析支持 video.replicate 的 seedance 模型,再用 modelVersionId 提交。
  // createAiTask 走「显式模型」分支(无「换下一个模型」循环),seedance 失败直接抛错由用户决定。
  // 查模型必带 workspace_id(否则后端按订阅返回空列表 → 误报无可用模型);显式传入,不依赖模块级当前 workspace。
  const model = args.modelVersion?.id ? args.modelVersion : await preloadHotCopyVideoModel(args)
  let task
  try {
    task = await createAiTask({
      workspaceId: args.workspaceId,
      capability: 'video',
      operationCode: 'video.replicate',
      modelVersionId: model.id,
      modelVersion: model,
      idempotencyKey: String(args.idempotencyKey || '').trim() || undefined,
      signal: args.signal,
      prompt: args.prompt || '保留源视频的镜头节奏与爆点结构,把主体替换为参考图中的产品。',
      inputAssets,
      // 时长/比例按用户在入口的选择下发 —— 与智能成片 generateFullVideo 同一写法:始终走
      // buildVideoGenerationParams(其内部按模型 schema 决定字段名/取值;无 schema 时也下发标准
      // duration/resolution/ratio,保证用户所选时长/比例生效)。source_video_duration 仅在模型 schema
      // 声明时下发,用于「按源视频真实时长计费」,与 duration 不冲突。
      params: buildReplicateVideoParams(model, args),
    })
  } catch (error) {
    // 模型可能刚被管理员关闭或套餐发生变化；本次仍按原错误返回，下次点击重新查询，避免缓存放大故障。
    invalidateHotCopyVideoModel(args.workspaceId)
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
  ratio?: string
  durationSec?: number
  modelPlanCandidates?: string[]
}): Promise<any> {
  const model = await preloadHotCopyVideoModel(args)
  const params = buildReplicateVideoParams(model, args)
  return estimateAiTaskCost({
    workspaceId: args.workspaceId,
    modelVersionId: model.id,
    operationCode: 'video.replicate',
    params,
  })
}
