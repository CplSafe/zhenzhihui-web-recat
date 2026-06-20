/**
 * 智能成片 — 镜头编排:分镜图生成(走业务后端 /ai/tasks 文/图生图,同 2.0)。
 * 每个镜头按 画面描述 + 该镜头素材(参考图)生成;为保持连贯,第 2 镜起额外带上
 * 上一张已生成的分镜图作为参考图。本地图片(objectURL/dataURL)会先上传成 asset 取得 asset_id。
 */
// @ts-nocheck
import { createAiTask, waitForAiTask, uploadAssetFile, extractTaskMediaUrls, getAssetDownloadUrl } from './business'

/** 把图片(objectURL / dataURL / http)上传为后端素材,返回 asset_id;带缓存避免重复上传。 */
export async function ensureAssetId(
  workspaceId: number,
  url: string,
  cache: Record<string, number> = {},
): Promise<number> {
  if (!url) return 0
  if (cache[url]) return cache[url]
  const res = await fetch(url)
  const blob = await res.blob()
  const type = blob.type || 'image/jpeg'
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
  const file = new File([blob], `ref_${Math.floor(performance.now())}.${ext}`, { type })
  const out = await uploadAssetFile({ workspaceId, file })
  const id = Number(out?.asset?.id || 0)
  if (id) cache[url] = id
  return id
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
  if (!assetId) return ''
  try {
    return (await getAssetDownloadUrl({ workspaceId, assetId })) || ''
  } catch {
    return ''
  }
}

/** 取已完成任务输出图的 asset_id(供下一镜头连贯参考)。 */
function outputAssetId(task: any): number {
  return Number(task?.outputs?.find?.((o: any) => o?.asset_id)?.asset_id || 0)
}

// 分镜图模型偏好(与 2.0 一致:火山 Doubao-Seedream)
const STORYBOARD_MODEL_KEYWORDS = ['seedream', 'seeddream', 'doubao-seedream']

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
}): Promise<{ url: string; assetId: number }> {
  const refs = (args.refAssetIds || []).filter((n) => Number(n) > 0)
  const operationCode = refs.length ? 'image.image_to_image' : 'image.text_to_image'
  const task = await createAiTask({
    workspaceId: args.workspaceId,
    capability: 'image',
    operationCode,
    preferredModelKeywords: STORYBOARD_MODEL_KEYWORDS,
    ...(args.modelPlanCandidates?.length ? { modelPlanCandidates: args.modelPlanCandidates } : {}),
    prompt: args.prompt,
    inputAssets: refs.map((id) => ({ asset_id: id, role: 'reference_image' })),
  })
  // 分镜图生成放宽轮询超时(默认 120s 偏短)
  const completed = await waitForAiTask({ workspaceId: args.workspaceId, task, timeoutMs: 30 * 60 * 1000 })
  const url = extractTaskMediaUrls(completed)[0] || ''
  if (!url) throw new Error('未生成分镜图')
  return { url, assetId: outputAssetId(completed) }
}
