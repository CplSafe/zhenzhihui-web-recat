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
} from './business'
import { buildVideoGenerationParams } from '@/utils/videoTasks'
import { normalizeSeedanceRatio, normalizeSeedanceDuration } from '@/utils/videoOptions'
import { resolveGeneratedMediaUrls } from '@/utils/taskMedia'

const VIDEO_MODEL_KEYWORDS = ['seedance']

const extractVideoAssetId = (task: any): number =>
  Number(task?.outputs?.find?.((o: any) => o?.asset_id)?.asset_id || 0)

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
  modelPlanCandidates?: string[]
}): Promise<{ url: string; assetId: number }> {
  const products = (args.productAssetIds || []).filter((n) => Number(n) > 0).slice(0, 9)
  const inputAssets = [
    { asset_id: args.videoAssetId, role: 'video' },
    ...products.map((id) => ({ asset_id: id, role: 'image' })),
  ]
  const task = await createAiTask({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.replicate',
    preferredModelKeywords: VIDEO_MODEL_KEYWORDS,
    ...(args.modelPlanCandidates?.length ? { modelPlanCandidates: args.modelPlanCandidates } : {}),
    prompt: args.prompt || '保留源视频的镜头节奏与爆点结构,把主体替换为参考图中的产品。',
    inputAssets,
    params: (model: any) => ({
      generate_audio: true,
      ...buildVideoGenerationParams(model, {
        duration: normalizeSeedanceDuration(args.durationSec || 10),
        resolution: '720p',
        ratio: normalizeSeedanceRatio(args.ratio || '9:16'),
        generateAudio: true,
      }),
    }),
  })
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
