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
  getAssetDownloadUrl,
  listAssets,
  extractAssetPageItems,
  getModelForOperation,
  resolveTaskModel,
  estimateAiTaskCost,
} from './business'
import { buildVideoGenerationParams } from '@/utils/videoTasks'
import { getModelParamFields } from '@/utils/modelSchema'
import { normalizeSeedanceRatio, normalizeSeedanceDuration } from '@/utils/videoOptions'
import { resolveGeneratedMediaUrls } from '@/utils/taskMedia'

const VIDEO_MODEL_KEYWORDS = ['seedance']

const extractVideoAssetId = (task: any): number => Number(task?.outputs?.find?.((o: any) => o?.asset_id)?.asset_id || 0)

async function findVideoAssetIdByTaskId(workspaceId: number, taskId: any): Promise<number> {
  const tId = Number(taskId || 0)
  if (!workspaceId || !tId) return 0
  try {
    const payload = await listAssets({ workspaceId, type: 'video', limit: 100 })
    const hit = extractAssetPageItems(payload).find((a: any) => Number(a?.task_id) === tId)
    return Number(hit?.id || 0) || 0
  } catch {
    return 0
  }
}

/** 上传本地文件成 asset,返回 asset_id(type 由文件推断:视频→video,图片→image)。 */
export async function uploadHotCopyAsset(workspaceId: number, file: File): Promise<number> {
  const out: any = await uploadAssetFile({ workspaceId, file })
  return Number(out?.asset?.id || 0) || 0
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
  /** 任务创建后回调 task_id:供前端持久化,刷新/切换后用 awaitHotVideoResult 续轮询(不丢在途生成) */
  onTask?: (taskId: number) => void
}): Promise<{ url: string; assetId: number }> {
  const products = (args.productAssetIds || []).filter((n) => Number(n) > 0).slice(0, 9)
  const inputAssets = [
    { asset_id: args.videoAssetId, role: 'video' },
    ...products.map((id) => ({ asset_id: id, role: 'image' })),
  ]
  // 钉死 seedance,不做跨模型退避:先显式解析支持 video.replicate 的 seedance 模型,再用 modelVersionId 提交。
  // createAiTask 走「显式模型」分支(无「换下一个模型」循环),seedance 失败直接抛错由用户决定,
  // 绝不退避到 happyhorse 等其它视频模型。
  const model = await getModelForOperation('video.replicate', VIDEO_MODEL_KEYWORDS, args.modelPlanCandidates)
  if (!model?.id)
    throw new Error('当前工作空间/套餐暂无「爆款复刻(video.replicate)」可用模型(seedance),请联系管理员开通')
  const task = await createAiTask({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.replicate',
    modelVersionId: model.id,
    modelVersion: model,
    prompt: args.prompt || '保留源视频的镜头节奏与爆点结构,把主体替换为参考图中的产品。',
    inputAssets,
    // video.replicate 的画面/时长主要由源视频决定:仅按模型 params_schema 填字段,
    // 无 schema 时不塞 duration/resolution/ratio 等(否则 provider 报「参数有误」)。
    params: (m: any) => {
      const fields = getModelParamFields(m)
      if (!fields.length) return {}
      return buildVideoGenerationParams(m, {
        duration: normalizeSeedanceDuration(args.durationSec || 10),
        sourceVideoDuration: args.sourceVideoDurationSec, // 有源视频时长则按它计费(schema 声明才下发)
        resolution: '720p',
        ratio: normalizeSeedanceRatio(args.ratio || '9:16'),
        generateAudio: true,
      })
    },
  })
  args.onTask?.(Number(task?.id || 0) || 0)
  const completed = await waitForAiTask({
    workspaceId: args.workspaceId,
    task,
    intervalMs: 4000,
    timeoutMs: 60 * 60 * 1000,
  })
  let assetId = extractVideoAssetId(completed)
  if (!assetId) assetId = await findVideoAssetIdByTaskId(args.workspaceId, completed?.id || (task as any)?.id)
  let [url] = await resolveGeneratedMediaUrls({ workspaceId: args.workspaceId, task: completed, type: 'video' })
  if (!url && assetId) url = await getAssetDownloadUrl({ workspaceId: args.workspaceId, assetId }).catch(() => '')
  if (!url) throw new Error('复刻任务已完成,暂未返回可预览地址')
  return { url, assetId }
}

/**
 * 按 task_id 续等一个【已创建】的视频任务结果(刷新/切换页面后恢复在途生成用)。
 * 与 replicateHotVideo / editFullVideo 的收尾一致:轮询到完成 → 取 asset_id + 可预览地址。
 */
export async function awaitHotVideoResult(args: {
  workspaceId: number
  taskId: number
}): Promise<{ url: string; assetId: number }> {
  const completed = await waitForAiTask({
    workspaceId: args.workspaceId,
    task: { id: args.taskId, status: 'processing' },
    intervalMs: 4000,
    timeoutMs: 60 * 60 * 1000,
  })
  let assetId = extractVideoAssetId(completed)
  if (!assetId) assetId = await findVideoAssetIdByTaskId(args.workspaceId, completed?.id || args.taskId)
  let [url] = await resolveGeneratedMediaUrls({ workspaceId: args.workspaceId, task: completed, type: 'video' })
  if (!url && assetId) url = await getAssetDownloadUrl({ workspaceId: args.workspaceId, assetId }).catch(() => '')
  if (!url) throw new Error('视频任务已完成,暂未返回可预览地址')
  return { url, assetId }
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
  const pick = (kw: string[]) =>
    resolveTaskModel({
      capability: 'video',
      operationCode: 'video.replicate',
      preferredModelKeywords: kw,
      modelPlanCandidates: args.modelPlanCandidates,
    }).catch(() => null)
  let model = await pick(VIDEO_MODEL_KEYWORDS)
  if (!model?.id) model = await pick([])
  if (!model?.id) throw new Error('暂无可用的爆款复刻模型')
  const params = buildVideoGenerationParams(model, {
    duration: normalizeSeedanceDuration(args.durationSec || 10),
    sourceVideoDuration: args.sourceVideoDurationSec,
    resolution: '720p',
    ratio: normalizeSeedanceRatio(args.ratio || '9:16'),
    generateAudio: true,
  })
  return estimateAiTaskCost({
    workspaceId: args.workspaceId,
    modelVersionId: model.id,
    operationCode: 'video.replicate',
    params,
  })
}
