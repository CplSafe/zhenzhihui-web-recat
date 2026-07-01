import { extractAssetPageItems, extractTaskMediaUrls, getAssetDownloadUrl, listAssets } from '../api/business'

// Resolve the playable / viewable URLs for a completed AI task.
//
// Preference order:
//  1. minio-backed signed URLs from each output's asset_id (long-lived, our own storage)
//  2. provider direct URLs embedded in the task (short-lived, e.g. TOS signed)
//  3. assets that reference task.id (covers tasks whose outputs were assigned post-hoc)
//
// `type` is forwarded to listAssets for the fallback search ("image" | "video" | "").
export async function resolveGeneratedMediaUrls({ workspaceId, task, type }) {
  const wsId = Number(workspaceId || 0)
  const outputAssetIds = Array.isArray(task?.outputs)
    ? task.outputs.map((output) => output?.asset_id).filter(Boolean)
    : []
  const uniqueAssetIds = [...new Set(outputAssetIds)]
  const urls = []

  for (const assetId of uniqueAssetIds) {
    try {
      const url = await getAssetDownloadUrl({ workspaceId: wsId, assetId })
      if (url) urls.push(url)
    } catch {
      // Ignore a single signed-url miss; task_id fallback below can still find generated assets.
    }
  }

  if (urls.length) {
    return urls
  }

  const directUrls = extractTaskMediaUrls(task)
  if (directUrls.length) {
    return directUrls
  }

  if (!task?.id || !wsId) {
    return []
  }

  try {
    const payload = await listAssets({ workspaceId: wsId, type, limit: 100 })
    const taskAssets = extractAssetPageItems(payload).filter((asset) => asset?.task_id === task.id)

    for (const asset of taskAssets) {
      const url = await getAssetDownloadUrl({ workspaceId: wsId, assetId: asset.id })
      if (url) urls.push(url)
    }
  } catch {
    return urls
  }

  return urls
}

// 从已完成任务的 outputs 里取第一个 asset_id(0 = 没有)。
// smartVideo/hotCopy(原名 extractVideoAssetId)与 smartShotImage/smartFaceBlur(原名 outputAssetId)
// 曾各有一份字节相同的实现,统一到此。
export function extractOutputAssetId(task: any): number {
  return Number(task?.outputs?.find?.((o: any) => o?.asset_id)?.asset_id || 0)
}

// 任务 outputs 没带 asset_id 时,按 task_id 去资产列表反查 asset_id(否则刷新水合换不了 URL → 媒体丢失)。
// smartVideo / hotCopy 原各有一份字节相同的实现,统一到此(type 默认 video)。
export async function findAssetIdByTaskId(
  workspaceId: number,
  taskId: any,
  type: 'video' | 'image' = 'video',
): Promise<number> {
  const tId = Number(taskId || 0)
  if (!workspaceId || !tId) return 0
  try {
    const payload = await listAssets({ workspaceId, type, limit: 100 })
    const hit = extractAssetPageItems(payload).find((a: any) => Number(a?.task_id) === tId)
    return Number(hit?.id || 0) || 0
  } catch {
    return 0
  }
}

// 已完成【视频】任务 → { url, assetId } 的统一解析尾巴:
// outputs 取 asset_id → 没有则按 task_id 反查 → 取可预览地址 → 无地址但有 asset_id 则退回同源 /download。
// url 可能为 ''(解析不出),由调用方按各自语义抛错,以保留原有的差异化错误文案。
// 统一 hotCopy.replicate/awaitHotVideoResult、smartVideo.editFullVideo/resolveVideoTaskResult 里逐字重复的 4 段。
export async function resolveTaskVideoResult(
  workspaceId: number,
  completed: any,
  fallbackTaskId: any,
): Promise<{ url: string; assetId: number }> {
  let assetId = extractOutputAssetId(completed)
  if (!assetId) assetId = await findAssetIdByTaskId(workspaceId, completed?.id || fallbackTaskId, 'video')
  let [url] = await resolveGeneratedMediaUrls({ workspaceId, task: completed, type: 'video' })
  if (!url && assetId) url = await getAssetDownloadUrl({ workspaceId, assetId }).catch(() => '')
  return { url: url || '', assetId }
}
