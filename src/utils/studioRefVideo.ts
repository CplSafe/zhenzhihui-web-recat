/**
 * 创作台「参考视频」的约束与校验（纯逻辑层）。
 *
 * 约束全部来自后端：
 * - 条数：后端 provider 对参考视频的上限是 3 段（见 minimaxMaxVideos / 火山 video[] 约定）；
 * - 单条时长优先读取模型 schema 的 `source_video_duration` 字段；
 *   Seedance 2.5 缺失该字段时按服务商公开的 30 秒输入上限兜底。
 */
import { getModelParamFields, findModelParamField } from './modelSchema'

/** 参考视频数量上限（后端 provider 侧的硬约束）。 */
export const MAX_REF_VIDEOS = 3

/** 当前模型下参考视频的可用额度。 */
export interface StudioRefVideoLimits {
  /** 最多可添加的参考视频条数。 */
  maxCount: number
  /**
   * 单条参考视频的时长上限（秒）；模型未声明时为 null，表示前端不做时长校验。
   * 注意这是【单条】上限，不是所有参考视频的总和。
   */
  maxDurationSec: number | null
  /** 单条参考视频的时长下限（秒）；模型未声明时为 null。 */
  minDurationSec: number | null
}

/** 读取数值型 schema 约束，非法值返回 null。 */
function readNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function isSeedance25(model: unknown): boolean {
  if (!model || typeof model !== 'object') return false
  const record = model as Record<string, unknown>
  const identity = [
    record.model,
    record.model_code,
    record.modelCode,
    record.model_name,
    record.modelName,
    record.display_name,
    record.displayName,
    record.name,
  ]
  return identity.some((value) => typeof value === 'string' && /seedance[\s._-]*(?:v[\s._-]*)?2[\s._-]*5/i.test(value))
}

/**
 * 依据选中模型解析参考视频的数量与单条时长上限。
 *
 * 时长以模型 schema 的 `source_video_duration` 为准；Seedance 2.5 的模型
 * schema 目前未声明输入视频时长，但服务商文档明确上限为 30 秒。
 * https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh&redirect=1
 */
export function resolveRefVideoLimits(model: unknown): StudioRefVideoLimits {
  const field = findModelParamField(getModelParamFields(model), ['source_video_duration', 'sourceVideoDuration'])
  return {
    maxCount: MAX_REF_VIDEOS,
    maxDurationSec: readNumber((field as any)?.max ?? (field as any)?.maximum) ?? (isSeedance25(model) ? 30 : null),
    minDurationSec: readNumber((field as any)?.min ?? (field as any)?.minimum),
  }
}

/** 一条待用参考视频。 */
export interface StudioRefVideo {
  id: string
  url: string
  /** 由本地 File 生成的 objectURL，移除时需要回收。 */
  isObjectUrl?: boolean
  /** 视频时长（秒）；元数据未就绪时为 0。 */
  durationSec: number
  /**
   * 原始文件。
   *
   * 参考视频不能走 smartShotImage.ensureAssetId —— 那条链路会用
   * validateReferenceImageBlob 校验 MIME 与 magic bytes，视频一律被判为「不是支持的图片格式」。
   * 因此这里保留 File，提交时直接交给 uploadAssetFile（由文件自身推断类型）。
   */
  file: File
}

/** 参考视频总时长（秒）。 */
export function totalRefVideoSec(videos: readonly StudioRefVideo[]): number {
  return videos.reduce((sum, video) => sum + (Number(video.durationSec) || 0), 0)
}

/** 单条视频是否超出模型声明的时长范围；返回原因或空串。 */
function checkDuration(durationSec: number, limits: StudioRefVideoLimits): string {
  // 时长元数据没读出来（为 0）时不拦截，交由后端最终校验。
  if (!durationSec) return ''
  if (limits.maxDurationSec !== null && durationSec > limits.maxDurationSec) {
    return `单条参考视频最长 ${limits.maxDurationSec}s，当前约 ${Math.ceil(durationSec)}s`
  }
  if (limits.minDurationSec !== null && durationSec < limits.minDurationSec) {
    return `单条参考视频最短 ${limits.minDurationSec}s，当前 ${Math.round(durationSec)}s`
  }
  return ''
}

/**
 * 校验参考视频是否满足当前模型的约束。
 * 返回第一条阻塞原因；通过时返回空串。
 */
export function validateRefVideos(videos: readonly StudioRefVideo[], limits: StudioRefVideoLimits): string {
  if (videos.length > limits.maxCount) return `最多支持 ${limits.maxCount} 个参考视频`
  for (const video of videos) {
    const reason = checkDuration(video.durationSec, limits)
    if (reason) return reason
  }
  return ''
}

/** 再添加一条 `durationSec` 秒的视频是否会被拒；返回原因或空串。 */
export function getRefVideoRejectReason(
  videos: readonly StudioRefVideo[],
  durationSec: number,
  limits: StudioRefVideoLimits,
): string {
  if (videos.length >= limits.maxCount) return `最多支持 ${limits.maxCount} 个参考视频`
  return checkDuration(durationSec, limits)
}
