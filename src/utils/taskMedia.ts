/**
 * AI 任务媒体结果解析：优先使用素材 ID 获取稳定地址，并在资产异步落库时有限重试。
 * 分页扫描带重复页保护和页数上限，避免后端忽略 offset 时形成无限请求。
 */
import { extractAssetPage, extractTaskMediaUrls, getAssetDownloadUrl, listAssets } from '../api/business'

/** 反查任务素材时的单页大小。 */
const TASK_ASSET_PAGE_SIZE = 100
/** 首轮恢复任务时允许扫描的最大素材页数。 */
const TASK_ASSET_MAX_PAGES = 20
/** 任务完成到资产可见之间的有限退避序列。 */
const TASK_ASSET_RETRY_DELAYS_MS = [0, 400, 900, 1800, 3000, 3000] as const

/** 按需等待指定毫秒数。 */
const wait = (delayMs: number): Promise<void> =>
  delayMs > 0 ? new Promise((resolve) => window.setTimeout(resolve, delayMs)) : Promise.resolve()

/** 严格比较两个有效的任务 ID。 */
const sameTaskId = (left: unknown, right: unknown): boolean => {
  const leftId = Number(left || 0)
  const rightId = Number(right || 0)
  return leftId > 0 && rightId > 0 && leftId === rightId
}

/** 分页查找绑定到指定任务的素材，并防止重复页造成死循环。 */
async function findAssetsByTaskId({
  workspaceId,
  taskId,
  type,
  maxPages = TASK_ASSET_MAX_PAGES,
}: {
  workspaceId: number
  taskId: unknown
  type: 'video' | 'image' | ''
  maxPages?: number
}): Promise<any[]> {
  const wsId = Math.floor(Number(workspaceId) || 0)
  const normalizedTaskId = Number(taskId || 0)
  if (!wsId || !normalizedTaskId) return []

  let offset = 0
  const seenPageSignatures = new Set<string>()
  for (let pageIndex = 0; pageIndex < Math.max(1, maxPages); pageIndex += 1) {
    const payload = await listAssets({
      workspaceId: wsId,
      type,
      limit: TASK_ASSET_PAGE_SIZE,
      offset,
    })
    const page = extractAssetPage(payload)
    const items = Array.isArray(page.items) ? page.items : []
    const matches = items.filter((asset: any) => sameTaskId(asset?.task_id ?? asset?.taskId, normalizedTaskId))
    if (matches.length) return matches

    const pageIds = items.map((asset: any) => String(asset?.id ?? '').trim())
    const pageSignature = items.length > 0 && pageIds.every(Boolean) ? `${items.length}:${pageIds.join(',')}` : ''
    if (pageSignature && seenPageSignatures.has(pageSignature)) break
    if (pageSignature) seenPageSignatures.add(pageSignature)

    const nextOffset = offset + items.length
    const explicitTotal =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? ((payload as any).total ?? (payload as any).data?.total)
        : undefined
    const hasExplicitTotal = explicitTotal !== undefined && Number.isFinite(Number(explicitTotal))
    const total = hasExplicitTotal ? Math.max(0, Number(explicitTotal) || 0) : 0
    if (!items.length || nextOffset <= offset || (hasExplicitTotal && nextOffset >= total)) {
      break
    }
    offset = nextOffset
  }

  return []
}

// 解析已完成任务的可播放地址：优先 output.asset_id，其次按 task.id 反查素材，最后使用供应商临时直链。
// type 会传给素材列表作为兜底筛选条件。
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

  if (task?.id && wsId) {
    try {
      const taskAssets = await findAssetsByTaskId({ workspaceId: wsId, taskId: task.id, type: type || '' })
      for (const asset of taskAssets) {
        const url = await getAssetDownloadUrl({ workspaceId: wsId, assetId: asset.id })
        if (url) urls.push(url)
      }
    } catch {
      // 资产列表短暂不可用时仍允许使用任务直链完成当前页面预览。
    }
  }

  if (urls.length) {
    return urls
  }

  return extractTaskMediaUrls(task)
}

// 从已完成任务的 outputs 里取第一个 asset_id(0 = 没有)。
// smartVideo/hotCopy(原名 extractVideoAssetId)与 smartShotImage/smartFaceBlur(原名 outputAssetId)
// 曾各有一份字节相同的实现,统一到此。
export function extractOutputAssetId(task: any): number {
  return Number(task?.outputs?.find?.((o: any) => o?.asset_id)?.asset_id || 0)
}

const VIDEO_TYPE_HINT_PATTERN = /(^|[^a-z0-9])(?:video|mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|ogv)(?:$|[^a-z0-9])/i
const VIDEO_URL_EXTENSION_PATTERN = /\.(?:mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|ogv)(?:$|[?#&])/i
const MEDIA_URL_EXTENSION_PATTERN =
  /\.(?:mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|ogv|jpg|jpeg|png|webp|gif|bmp|svg|avif|heic|heif|mp3|wav|aac|m4a|flac|ogg|pdf)(?:$|[?#&])/i

const OUTPUT_TYPE_HINT_KEYS = [
  'type',
  'media_type',
  'mediaType',
  'mime_type',
  'mimeType',
  'content_type',
  'contentType',
  'asset_type',
  'assetType',
  'output_type',
  'outputType',
  'role',
  'kind',
  'format',
  'extension',
  'ext',
] as const

const OUTPUT_URL_KEYS = [
  'url',
  'uri',
  'download_url',
  'downloadUrl',
  'media_url',
  'mediaUrl',
  'file_url',
  'fileUrl',
  'output_url',
  'outputUrl',
] as const

/** 收集输出及其常见元数据容器，兼容不同供应商的结果信封。 */
const outputMetadataSources = (output: any): any[] =>
  [output, output?.metadata, output?.meta, output?.file].filter(
    (source) => source && typeof source === 'object' && !Array.isArray(source),
  )

/** 判断一个带 asset_id 的输出是否被明确标记为视频。 */
const isExplicitVideoOutput = (output: any): boolean => {
  const sources = outputMetadataSources(output)
  const hasVideoTypeHint = sources.some((source) =>
    OUTPUT_TYPE_HINT_KEYS.some((key) => VIDEO_TYPE_HINT_PATTERN.test(String(source?.[key] ?? '').trim())),
  )
  if (hasVideoTypeHint) return true

  return sources.some((source) =>
    OUTPUT_URL_KEYS.some((key) => VIDEO_URL_EXTENSION_PATTERN.test(String(source?.[key] ?? '').trim())),
  )
}

/** 判断输出是否携带任何可用于区分媒体类型的信息。 */
const hasOutputTypeInformation = (output: any): boolean => {
  const sources = outputMetadataSources(output)
  const hasTypeField = sources.some((source) =>
    OUTPUT_TYPE_HINT_KEYS.some((key) => String(source?.[key] ?? '').trim().length > 0),
  )
  if (hasTypeField) return true

  return sources.some((source) =>
    OUTPUT_URL_KEYS.some((key) => MEDIA_URL_EXTENSION_PATTERN.test(String(source?.[key] ?? '').trim())),
  )
}

/**
 * 从视频任务输出中安全提取 asset_id。
 * 优先使用明确的视频类型/MIME/角色/文件扩展名；仅当唯一资产输出完全没有类型信息时兼容旧响应。
 */
export function extractVideoOutputAssetId(task: any): number {
  const assetOutputs = (Array.isArray(task?.outputs) ? task.outputs : [])
    .map((output: any) => ({ output, assetId: Number(output?.asset_id || 0) }))
    .filter(({ assetId }) => Number.isFinite(assetId) && assetId > 0)

  const explicitVideoOutput = assetOutputs.find(({ output }) => isExplicitVideoOutput(output))
  if (explicitVideoOutput) return explicitVideoOutput.assetId

  if (assetOutputs.length !== 1 || hasOutputTypeInformation(assetOutputs[0].output)) return 0
  return assetOutputs[0].assetId
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
  for (const [attempt, delayMs] of TASK_ASSET_RETRY_DELAYS_MS.entries()) {
    await wait(delayMs)
    try {
      // 第一次完整翻页，兼顾恢复较旧任务；后续属于“刚完成但资产尚未落库”的短重试，
      // 新资产通常位于列表头部，只查前两页可避免最坏情况下反复发出上百个请求。
      const [hit] = await findAssetsByTaskId({
        workspaceId,
        taskId: tId,
        type,
        maxPages: attempt === 0 ? TASK_ASSET_MAX_PAGES : 2,
      })
      const assetId = Number(hit?.id || 0) || 0
      if (assetId) return assetId
    } catch {
      // 任务已成功但资产落库/列表查询可能短暂失败，继续有限次数重试。
    }
  }
  return 0
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
  let assetId = extractVideoOutputAssetId(completed)
  if (!assetId) assetId = await findAssetIdByTaskId(workspaceId, completed?.id || fallbackTaskId, 'video')
  // 已经反查到稳定资产时直接取我方存储地址，避免 resolveGeneratedMediaUrls 再扫描一遍素材列表。
  let url = assetId ? await getAssetDownloadUrl({ workspaceId, assetId }).catch(() => '') : ''
  if (!url && !assetId) [url] = extractTaskMediaUrls(completed)
  return { url: url || '', assetId }
}
