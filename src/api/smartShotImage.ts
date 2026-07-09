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
} from './business'
import { resolveGeneratedMediaUrls, findAssetIdByTaskId, extractOutputAssetId } from '@/utils/taskMedia'
import { buildStoryboardImageParams } from '@/utils/storyboardTasks'
import { getModelParamFields } from '@/utils/modelSchema'

// 选出最小尺寸档(支持 "1024x1024" / "1K"/"2K" / 纯数字 等写法)
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

// 图像出图参数:严格按模型 params_schema 构建(buildStoryboardImageParams 只填模型声明的字段)。
// gpt-image-2 仅声明 ratio/quality/count → 只发这三个;不塞 watermark/size/generate_audio 等未声明字段
// (发未声明参数会被 provider 报「参数有误」)。lowRes 时若模型支持 size 才强制最小档。
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

// 分镜图模型偏好:GPT Image 2(openai gpt-image-2,支持 image.text_to_image / image.image_to_image)
const STORYBOARD_MODEL_KEYWORDS = ['gpt-image-2', 'gpt-image', 'gpt image', 'seedream', 'doubao']

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
}): Promise<{ url: string; assetId: number }> {
  const refs = (args.refAssetIds || []).filter((n) => Number(n) > 0)
  const runShotTask = async (
    operationCode: string,
    inputAssetIds: number[],
  ): Promise<{ url: string; assetId: number }> => {
    const task = await createAiTask({
      workspaceId: args.workspaceId,
      capability: 'image',
      operationCode,
      preferredModelKeywords: STORYBOARD_MODEL_KEYWORDS,
      ...(args.modelPlanCandidates?.length ? { modelPlanCandidates: args.modelPlanCandidates } : {}),
      prompt: args.prompt,
      inputAssets: inputAssetIds.map((id) => ({ asset_id: id, role: 'reference_image' })),
      params: (model: any) => buildImageParams(model, args.ratio, args.lowRes),
    })
    const taskId = Number((task as any)?.id || 0) || 0
    if (taskId) args.onTask?.(taskId)
    if (args.signal?.aborted) {
      if (taskId) {
        try {
          await cancelAiTask({ workspaceId: args.workspaceId, taskId })
        } catch {
          /* ignore */
        }
      }
      throw new Error('分镜图生成已取消')
    }
    // 分镜图生成放宽轮询超时(默认 120s 偏短)
    let completed
    try {
      completed = await waitForAiTask({
        workspaceId: args.workspaceId,
        task,
        timeoutMs: 30 * 60 * 1000,
        signal: args.signal,
      })
    } catch (e: any) {
      if (taskId && (isAbortedTaskError(e) || args.signal?.aborted)) {
        try {
          await cancelAiTask({ workspaceId: args.workspaceId, taskId })
        } catch {
          /* ignore */
        }
        throw new Error('分镜图生成已取消')
      }
      throw e
    }
    // 取 asset_id:outputs 优先;没有则按 task_id 反查(否则刷新水合换不了URL → 破图)
    let assetId = extractOutputAssetId(completed)
    if (!assetId) assetId = await findAssetIdByTaskId(args.workspaceId, completed?.id || (task as any)?.id, 'image')
    // 有 asset_id → 优先用同源流式地址(getAssetDownloadUrl 已改为返回 /download,同源 HTTPS、不过期),
    // 避免直接用 outputs[].url 的 OSS 原始地址(http + IP 主机,在 HTTPS 页会 Mixed Content 破图)。
    let url = assetId ? await getAssetDownloadUrl({ workspaceId: args.workspaceId, assetId }).catch(() => '') : ''
    if (!url)
      url =
        (await resolveGeneratedMediaUrls({ workspaceId: args.workspaceId, task: completed, type: 'image' }))[0] || ''
    if (!url) url = extractTaskMediaUrls(completed)[0] || ''
    if (!url) throw new Error('未生成分镜图')
    return { url, assetId }
  }

  // 任务执行失败自动重试一次（context canceled / provider 错误通常是偶发网络抖动）
  const runWithRetry = async (fn: () => Promise<{ url: string; assetId: number }>, maxRetries = 1) => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn()
      } catch (e: any) {
        if (attempt >= maxRetries) throw e
        // 检查顶层 message + response.error_message（context canceled 通常在后端返回的 error_message 里）
        const msg = String(e?.message || '').toLowerCase()
        const inner = String(e?.response?.error_message || '').toLowerCase()
        if (!/context canceled|provider task failed|internal.*error/i.test(`${msg} ${inner}`)) throw e
        await new Promise((r) => setTimeout(r, 1200))
      }
    }
    throw new Error('unreachable')
  }

  if (!refs.length) {
    return runWithRetry(() => runShotTask('image.text_to_image', []))
  }

  try {
    return await runWithRetry(() => runShotTask('image.image_to_image', refs))
  } catch {
    // 当前图生图模型链路不稳定时，自动回退一次文生图，优先保证分镜可生成。
    return runWithRetry(() => runShotTask('image.text_to_image', []))
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
