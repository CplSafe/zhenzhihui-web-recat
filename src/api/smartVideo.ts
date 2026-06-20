/**
 * 智能成片 — 生成视频:逐个分镜图 → 短视频片段(走业务后端 video.generate / Seedance,同 2.0)。
 * 以该镜「分镜图」为参考图(图生视频),prompt 带画面描述/台词,参数含时长/分辨率/比例/音频。
 */
// @ts-nocheck
import { createAiTask, waitForAiTask } from './business'
import { buildVideoGenerationParams } from '@/utils/videoTasks'
import { normalizeSeedanceRatio, normalizeSeedanceDuration } from '@/utils/videoOptions'
import { resolveGeneratedMediaUrls } from '@/utils/taskMedia'

const VIDEO_MODEL_KEYWORDS = ['seedance', 'seedance 2.0', 'doubao-seedance-2-0']
const extractVideoAssetId = (task: any): number =>
  Number(task?.outputs?.find?.((o: any) => o?.asset_id)?.asset_id || 0)

const isKeywordModelMissing = (e: any) =>
  e?.code === 'MODEL_NOT_FOUND' || /没有启用匹配/.test(String(e?.message || ''))

export async function generateClip(args: {
  workspaceId: number
  prompt: string
  imageAssetId?: number
  durationSec?: number
  ratio?: string
  modelPlanCandidates?: string[]
}): Promise<{ url: string; assetId: number }> {
  const buildArgs = (withKeywords: boolean) => ({
    workspaceId: args.workspaceId,
    capability: 'video',
    operationCode: 'video.generate',
    ...(withKeywords ? { preferredModelKeywords: VIDEO_MODEL_KEYWORDS } : {}),
    ...(args.modelPlanCandidates?.length ? { modelPlanCandidates: args.modelPlanCandidates } : {}),
    prompt: args.prompt,
    inputAssets: args.imageAssetId ? [{ asset_id: args.imageAssetId, role: 'image' }] : [],
    params: (model: any) =>
      buildVideoGenerationParams(model, {
        duration: normalizeSeedanceDuration(args.durationSec || 5),
        resolution: '720p',
        ratio: normalizeSeedanceRatio(args.ratio || '16:9'),
        generateAudio: true,
      }),
  })
  // 优先 Seedance;匹配不到则去掉关键词,用 video.generate 下任意可用模型
  let task: any
  try {
    task = await createAiTask(buildArgs(true))
  } catch (e) {
    if (!isKeywordModelMissing(e)) throw e
    task = await createAiTask(buildArgs(false))
  }
  const completed = await waitForAiTask({ workspaceId: args.workspaceId, task })
  const assetId = extractVideoAssetId(completed)
  const [url] = await resolveGeneratedMediaUrls({ workspaceId: args.workspaceId, task: completed, type: 'video' })
  if (!url) throw new Error('视频任务已完成,暂未返回可预览地址')
  return { url, assetId }
}
