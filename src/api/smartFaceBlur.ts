/**
 * 智能成片 — 人脸脱敏:正式生成视频前,对每张「进入视频」的分镜图做人脸检测脱敏(把人脸区域
 * 像素整块挖空成透明,产出人脸位置透明的整图 PNG),再把脱敏版喂给 seedance —— 火山对含真人
 * 人脸的输入图会拒审(InputImageSensitiveContentDetected.PrivacyInformation),必须先脱敏。
 * 走业务后端 image.face_detect 能力(DetectFace + importFaceCrops 挖空,同 2.0「人脸检测抠图」)。
 * 脱敏失败返回 ok=false；是否阻断后续生成由调用方按业务安全要求决定。
 */
// @ts-nocheck
import { createAiTask, waitForAiTask, listAiModels, getAssetDownloadUrl } from './business'
import { resolveGeneratedMediaUrls, findAssetIdByTaskId, extractOutputAssetId } from '@/utils/taskMedia'

// 懒加载缓存「人脸检测抠图」模型 ID:先精确名称、再放宽含「人脸」、最后任意兜底(同 2.0)
let cachedFaceModelId = 0
async function getFaceDetectModelId(): Promise<number> {
  if (cachedFaceModelId) return cachedFaceModelId
  try {
    const models = await listAiModels({ operationCode: 'image.face_detect' })
    const list = Array.isArray(models) ? models : models?.items || models?.data || []
    const hit =
      list.find((m: any) => String(m?.name || '').includes('人脸检测')) ||
      list.find((m: any) => String(m?.name || '').includes('人脸')) ||
      list[0]
    // 只在查到时缓存(对齐 Vue):失败/异常不写 0,避免首次失败后永久返回 0、下次还能重试
    if (hit?.id) cachedFaceModelId = Number(hit.id) || 0
  } catch {
    /* 查不到/异常:不写缓存,下次重试 */
  }
  return cachedFaceModelId || 0
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
    // 对齐 Vue 版:无条件传 modelVersionId,走 createAiTask 的显式模型分支(resolveExplicitTaskModel),
    // 绕过 plan 候选 + pickModel —— 避免套餐/能力不匹配时误报"没有启用支持 image.face_detect 的模型"。
    // 不再传 capability / modelPlanCandidates(那会把任务推向 plan 分支)。
    const task = await createAiTask({
      workspaceId: args.workspaceId,
      operationCode: 'image.face_detect',
      modelVersionId: model,
      prompt: '人脸检测脱敏',
      inputAssets: [{ asset_id: args.assetId, role: 'image' }],
    } as any)
    const completed = await waitForAiTask({ workspaceId: args.workspaceId, task, timeoutMs: 10 * 60 * 1000 })
    debug.status = completed?.status || ''
    let outId = extractOutputAssetId(completed)
    if (!outId) outId = await findAssetIdByTaskId(args.workspaceId, completed?.id || (task as any)?.id, 'image')
    let url =
      (await resolveGeneratedMediaUrls({ workspaceId: args.workspaceId, task: completed, type: 'image' }))[0] || ''
    if (!url && outId)
      url = await getAssetDownloadUrl({ workspaceId: args.workspaceId, assetId: outId }).catch(() => '')
    debug.outUrl = url
    debug.outAssetId = outId
    if (!url || !outId) throw new Error('脱敏任务未返回结果')
    return { url, assetId: outId, ok: true, debug }
  } catch (e: any) {
    debug.error = e?.message || String(e)
    return { url: '', assetId: 0, ok: false, debug }
  }
}
