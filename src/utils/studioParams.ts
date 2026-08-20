/**
 * AI 创作台的生成参数纯逻辑层。
 *
 * 档位以【后端模型 schema 为准】：比例、分辨率、时长都从选中模型声明的参数约束
 * （utils/modelRestrictions 解析出的 GenerationModelConstraints）推导，
 * 只有模型完全没有声明该字段时才退回下面的兜底档位。
 * 不发请求、不读全局状态。
 */
import type { GenerationModelConstraints } from './modelRestrictions'
import { supportsAudioToggle } from './studioVideoMode'
import { matchModelParamOptionValue } from './modelSchema'
import { DEFAULT_VIDEO_RESOLUTIONS } from './videoOptions'

/** 创作台的两种创作模式。 */
export type StudioMode = 'image' | 'video'

/** 画面比例档位；图标形状由共享的 RatioIcon 依据 value 自行解析。 */
export interface StudioRatioOption {
  value: string
  label: string
}

/** 模型未声明时的兜底分辨率档位（视频复用全站统一档位表）。 */
const FALLBACK_VIDEO_RESOLUTIONS = DEFAULT_VIDEO_RESOLUTIONS
const FALLBACK_IMAGE_RESOLUTIONS = ['1K', '2K']

/** 模型未声明时的兜底时长档位（秒）。 */
const FALLBACK_VIDEO_DURATIONS = [5, 10]

/** 模型未声明时的兜底比例档位。 */
const FALLBACK_VIDEO_RATIOS = ['16:9', '1:1', '9:16']
const FALLBACK_IMAGE_RATIOS = ['1:1', '16:9', '3:4', '9:16']

/** 单次生成数量档位。 */
export const GENERATION_COUNTS = [1, 2, 3, 4] as const

/** 参考图数量兜底上限（模型声明 referenceImages 时以模型为准）。 */
export const MAX_REFERENCE_IMAGES = 9

/** 把比例字符串包装为档位选项。 */
export function toRatioOption(value: string): StudioRatioOption {
  return { value, label: value }
}

/** 一次生成的完整参数。 */
export interface StudioParams {
  resolution: string
  ratio: string
  /** 视频总时长（秒）；图片模式忽略。 */
  durationSec: number
  /** 生成数量。 */
  count: number
  /** 是否输出声音；仅模型支持时生效（options.supportsAudio）。 */
  generateAudio: boolean
}

/** 当前模式 + 选中模型下，各参数实际可选的档位。 */
export interface StudioParamOptions {
  resolutions: string[]
  ratios: StudioRatioOption[]
  durations: number[]
  counts: number[]
  /** 参考图数量上限。 */
  maxReferenceImages: number
  /** 模型是否支持音频输出开关；不支持时页面隐藏该项。 */
  supportsAudio: boolean
}

/**
 * 依据模型声明的约束推导可选档位。
 *
 * 后端声明了就以后端为准（这样新模型上线无需改前端）；没声明才用兜底档位。
 */
export function resolveParamOptions(mode: StudioMode, constraints?: GenerationModelConstraints): StudioParamOptions {
  const declaredResolutions = constraints?.resolutions?.length
    ? constraints.resolutions
    : constraints?.resolution?.options || []
  const declaredRatios = constraints?.ratios?.length ? constraints.ratios : constraints?.ratio?.options || []

  const resolutions = declaredResolutions.length
    ? [...declaredResolutions]
    : mode === 'video'
      ? [...FALLBACK_VIDEO_RESOLUTIONS]
      : [...FALLBACK_IMAGE_RESOLUTIONS]

  const ratioValues = declaredRatios.length
    ? declaredRatios
    : mode === 'video'
      ? FALLBACK_VIDEO_RATIOS
      : FALLBACK_IMAGE_RATIOS

  return {
    resolutions,
    ratios: ratioValues.map(toRatioOption),
    durations: mode === 'video' ? resolveDurationOptions(constraints) : [],
    counts: [...GENERATION_COUNTS],
    maxReferenceImages: resolveMaxReferenceImages(constraints),
    supportsAudio: mode === 'video' && supportsAudioToggle(constraints),
  }
}

/**
 * 时长档位：优先用模型枚举的可选值；只给了 min/max 时按区间【过滤兜底梯度】。
 *
 * 刻意不按步长自造秒数——模型没枚举过的时长提交上去会被后端判为参数非法，
 * 这与 GenerationModelDropdown.getGenerationModelDurationOptions 的既有规则保持一致。
 */
function resolveDurationOptions(constraints?: GenerationModelConstraints): number[] {
  const duration = constraints?.duration
  if (duration?.options?.length) return [...duration.options].sort((a, b) => a - b)

  const min = Number(duration?.minimum)
  const max = Number(duration?.maximum)
  const hasRange = Number.isFinite(min) || Number.isFinite(max)
  if (hasRange) {
    const within = FALLBACK_VIDEO_DURATIONS.filter(
      (value) => (!Number.isFinite(min) || value >= min) && (!Number.isFinite(max) || value <= max),
    )
    // 过滤后为空说明兜底梯度与该模型区间不相交，此时保留原梯度而不是留下空档位。
    if (within.length) return within
  }
  return [...FALLBACK_VIDEO_DURATIONS]
}

/**
 * 参考图上限：模型声明 referenceImages.maximum 时以它为准。
 * 未声明时图片与视频都按 9 张兜底——视频参考图同时承担首尾帧与参考生成两种用途。
 */
function resolveMaxReferenceImages(constraints?: GenerationModelConstraints): number {
  const max = Number(constraints?.referenceImages?.maximum)
  if (Number.isFinite(max) && max >= 0) return Math.floor(max)
  return MAX_REFERENCE_IMAGES
}

/** 在给定档位下取一个合理默认值：优先常用值，否则取首项。 */
function preferred<T>(options: readonly T[], wishlist: readonly T[], fallback: T): T {
  for (const wish of wishlist) {
    if (options.includes(wish)) return wish
  }
  return options.length ? options[0] : fallback
}

/** 依据可选档位给出默认参数。 */
export function defaultStudioParams(mode: StudioMode, options?: StudioParamOptions): StudioParams {
  const opts = options || resolveParamOptions(mode)
  const ratioValues = opts.ratios.map((item) => item.value)
  return {
    resolution: preferred(opts.resolutions, mode === 'video' ? ['720p', '1080p'] : ['2K', '1K'], ''),
    ratio: preferred(ratioValues, mode === 'video' ? ['16:9', '9:16'] : ['1:1', '16:9'], ''),
    durationSec: mode === 'video' ? preferred(opts.durations, [5], opts.durations[0] || 5) : 0,
    count: 1,
    // 支持音频的模型默认开声，与可灵等同类产品的默认一致。
    generateAudio: opts.supportsAudio,
  }
}

/**
 * 把参数收敛到当前档位内。
 *
 * 切模式、切模型后都要调用：模型换了以后原来的比例/时长可能已经不被支持，
 * 继续提交会被后端按参数不合法拒绝。仍然合法的选择保持不变，避免无谓地重置用户选择。
 */
export function normalizeParams(mode: StudioMode, params: StudioParams, options: StudioParamOptions): StudioParams {
  const fallback = defaultStudioParams(mode, options)
  const ratioValues = options.ratios.map((item) => item.value)
  // 分辨率与比例按大小写无关匹配：模型写 720P、页面存 720p 属于同一档，
  // 直接用 includes 会误判为「不支持」并重置用户的选择。
  const matchedResolution = matchModelParamOptionValue(params.resolution, options.resolutions)
  const matchedRatio = matchModelParamOptionValue(params.ratio, ratioValues)
  return {
    resolution: matchedResolution ?? fallback.resolution,
    ratio: matchedRatio ?? fallback.ratio,
    durationSec:
      mode === 'video'
        ? options.durations.includes(params.durationSec)
          ? params.durationSec
          : fallback.durationSec
        : 0,
    count: options.counts.includes(params.count) ? params.count : fallback.count,
    // 模型不支持音频时强制关闭，避免把无效参数带进提交。
    generateAudio: options.supportsAudio ? params.generateAudio : false,
  }
}

/** 参数条上展示的摘要文案，如「1080p · 5s · 16:9 · 有声 · 1 条」。 */
export function formatParamsSummary(mode: StudioMode, params: StudioParams, options?: StudioParamOptions): string {
  const parts = [params.resolution].filter(Boolean)
  if (mode === 'video' && params.durationSec) parts.push(`${params.durationSec}s`)
  if (params.ratio) parts.push(params.ratio)
  // 只有模型支持音频时才展示声音状态，避免对不支持的模型显示「无声」造成误解。
  if (options?.supportsAudio) parts.push(params.generateAudio ? '有声' : '无声')
  parts.push(`${params.count} 条`)
  return parts.join(' · ')
}
