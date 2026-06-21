/**
 * 智能成片 — 人脸脱敏:正式生成视频前,对每张「进入视频」的分镜图做人脸检测脱敏(打码/抠脸),
 * 产出新的后端 asset,再把脱敏版喂给 seedance。走业务后端 image.face_detect 能力
 * (同 2.0「人脸检测抠图」模型)。脱敏失败不阻塞——回退用原图(由调用方决定)。
 */
// @ts-nocheck
import {
  createAiTask,
  waitForAiTask,
  listAiModels,
  getAssetDownloadUrl,
  listAssets,
  extractAssetPageItems,
} from './business'
import { resolveGeneratedMediaUrls } from '@/utils/taskMedia'

// 懒加载缓存「人脸检测抠图」模型 ID:先精确名称、再放宽含「人脸」、最后任意兜底(同 2.0)
let cachedFaceModelId = 0
async function getFaceDetectModelId(): Promise<number> {
  if (cachedFaceModelId) return cachedFaceModelId
  try {
    const models = await listAiModels({ operationCode: 'image.face_detect' })
    const list = Array.isArray(models) ? models : models?.items || models?.data || []
    const hit =
      list.find((m: any) => String(m?.name || '').includes('人脸检测抠图')) ||
      list.find((m: any) => String(m?.name || '').includes('人脸')) ||
      list[0]
    cachedFaceModelId = Number(hit?.id || 0) || 0
  } catch {
    cachedFaceModelId = 0
  }
  return cachedFaceModelId
}

function outputAssetId(task: any): number {
  return Number(task?.outputs?.find?.((o: any) => o?.asset_id)?.asset_id || 0)
}

// outputs 没带 asset_id 时按 task_id 反查资产列表(否则刷新水合换不了URL → 破图)
async function findAssetIdByTaskId(workspaceId: number, taskId: any): Promise<number> {
  const tId = Number(taskId || 0)
  if (!workspaceId || !tId) return 0
  try {
    const payload = await listAssets({ workspaceId, type: 'image', limit: 100 })
    const hit = extractAssetPageItems(payload).find((a: any) => Number(a?.task_id) === tId)
    return Number(hit?.id || 0) || 0
  } catch {
    return 0
  }
}

export interface FaceBlurResult {
  url: string
  assetId: number
  ok: boolean
  /** 调试:模型/输入/输出/状态/错误,供「脱敏调试」弹窗展示 */
  debug: {
    model: number
    operationCode: string
    srcAssetId: number
    outUrl: string
    outAssetId: number
    status: string
    error: string
  }
}

/**
 * 对单张图(asset_id)做人脸脱敏,返回脱敏后的 {url, assetId}。
 * 失败时 ok=false、url/assetId 为空(调用方回退原图),debug 带错误信息。
 */
export async function blurFacesOnAsset(args: {
  workspaceId: number
  assetId: number
  modelPlanCandidates?: string[]
}): Promise<FaceBlurResult> {
  const model = await getFaceDetectModelId()
  const debug: FaceBlurResult['debug'] = {
    model,
    operationCode: 'image.face_detect',
    srcAssetId: Number(args.assetId || 0),
    outUrl: '',
    outAssetId: 0,
    status: '',
    error: '',
  }
  try {
    if (!args.workspaceId || !args.assetId) throw new Error('缺少工作空间或图片 asset_id')
    const task = await createAiTask({
      workspaceId: args.workspaceId,
      capability: 'image',
      operationCode: 'image.face_detect',
      ...(model ? { modelVersionId: model } : {}),
      ...(args.modelPlanCandidates?.length ? { modelPlanCandidates: args.modelPlanCandidates } : {}),
      prompt: '人脸检测脱敏',
      inputAssets: [{ asset_id: args.assetId, role: 'image' }],
    } as any)
    const completed = await waitForAiTask({ workspaceId: args.workspaceId, task, timeoutMs: 10 * 60 * 1000 })
    debug.status = completed?.status || ''
    let outId = outputAssetId(completed)
    if (!outId) outId = await findAssetIdByTaskId(args.workspaceId, completed?.id || (task as any)?.id)
    let url = (await resolveGeneratedMediaUrls({ workspaceId: args.workspaceId, task: completed, type: 'image' }))[0] || ''
    if (!url && outId) url = await getAssetDownloadUrl({ workspaceId: args.workspaceId, assetId: outId }).catch(() => '')
    debug.outUrl = url
    debug.outAssetId = outId
    if (!url || !outId) throw new Error('脱敏任务未返回结果')
    return { url, assetId: outId, ok: true, debug }
  } catch (e: any) {
    debug.error = e?.message || String(e)
    return { url: '', assetId: 0, ok: false, debug }
  }
}
