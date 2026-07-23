/**
 * 视频时长值工具：解析带单位的秒数，并分别维护离散档位流程与智能成片的时长范围。
 * 严格模式拒绝非法值，兼容模式可使用显式回退，避免页面各自猜测或静默改写时长。
 */
/** 爆款复制等离散档位流程当前接受的时长。 */
export const SUPPORTED_VIDEO_DURATIONS = [5, 10, 15] as const

/** 智能成片允许逐秒选择的完整时长范围。 */
export const SMART_VIDEO_DURATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const

/** 由支持时长常量推导出的合法秒数联合类型。 */
export type SupportedVideoDuration = (typeof SUPPORTED_VIDEO_DURATIONS)[number]

/** 智能成片合法秒数联合类型。 */
export type SmartVideoDuration = (typeof SMART_VIDEO_DURATIONS)[number]

/** 视频时长校验成功或失败的结构化结果。 */
export type VideoDurationValidation =
  | { valid: true; seconds: SupportedVideoDuration; reason: null }
  | { valid: false; seconds: number | null; reason: 'invalid' | 'unsupported' }

/** 智能成片时长校验成功或失败的结构化结果。 */
export type SmartVideoDurationValidation =
  | { valid: true; seconds: SmartVideoDuration; reason: null }
  | { valid: false; seconds: number | null; reason: 'invalid' | 'unsupported' }

/** 时长解析失败时是否严格拒绝及其兼容回退选项。 */
export interface ResolveVideoDurationOptions {
  /** Return null instead of silently adjusting an invalid or unsupported value. */
  strict?: boolean
  /** Compatibility fallback used when the value cannot be parsed. */
  fallback?: SupportedVideoDuration
}

/** 匹配正数秒值及可选的 s/秒单位。 */
const DURATION_TEXT_PATTERN = /^([+]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:s|秒)?$/i

/**
 * Parse a positive duration expressed as a number, `"5"`, `"3.5s"`, or `"3.5秒"`.
 * Returns null for ambiguous text, zero, negative, and non-finite values.
 */
export function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null
  }

  if (typeof value !== 'string') return null

  const match = value.trim().match(DURATION_TEXT_PATTERN)
  if (!match) return null

  const seconds = Number(match[1])
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

/** 判断输入是否恰好属于当前模型支持的时长集合。 */
export function isSupportedVideoDuration(value: unknown): value is SupportedVideoDuration {
  return typeof value === 'number' && SUPPORTED_VIDEO_DURATIONS.some((duration) => duration === value)
}

/** 判断输入是否为智能成片支持的 1–15 秒整数。 */
export function isSmartVideoDuration(value: unknown): value is SmartVideoDuration {
  return typeof value === 'number' && SMART_VIDEO_DURATIONS.some((duration) => duration === value)
}

/** 不自动调整地校验时长，使页面能够明确拦截 11 秒等不支持输入。 */
export function validateVideoDuration(value: unknown): VideoDurationValidation {
  const seconds = parseDurationSeconds(value)
  if (seconds === null) return { valid: false, seconds: null, reason: 'invalid' }
  if (!isSupportedVideoDuration(seconds)) return { valid: false, seconds, reason: 'unsupported' }
  return { valid: true, seconds, reason: null }
}

/** 不取整、不吸附地校验智能成片的 1–15 秒整数时长。 */
export function validateSmartVideoDuration(value: unknown): SmartVideoDurationValidation {
  const seconds = parseDurationSeconds(value)
  if (seconds === null) return { valid: false, seconds: null, reason: 'invalid' }
  if (!isSmartVideoDuration(seconds)) return { valid: false, seconds, reason: 'unsupported' }
  return { valid: true, seconds, reason: null }
}

/** 解析为模型支持时长；兼容模式取最近档位且平局取短值，严格模式返回 null。 */
export function resolveVideoDuration(
  value: unknown,
  options: ResolveVideoDurationOptions = {},
): SupportedVideoDuration | null {
  const validation = validateVideoDuration(value)
  if (validation.valid) return validation.seconds
  if (options.strict) return null

  const fallback = isSupportedVideoDuration(options.fallback) ? options.fallback : 10
  if (validation.seconds === null) return fallback

  let closest: SupportedVideoDuration = SUPPORTED_VIDEO_DURATIONS[0]
  let closestDifference = Math.abs(validation.seconds - closest)

  for (const duration of SUPPORTED_VIDEO_DURATIONS.slice(1)) {
    const difference = Math.abs(validation.seconds - duration)
    if (difference < closestDifference) {
      closest = duration
      closestDifference = difference
    }
  }

  return closest
}
