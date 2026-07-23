/**
 * 创意视频时长策略：从自然语言需求中识别明确总时长，并校验模型支持范围。
 * 只接受明确表达的总时长，避免把“第 3 秒”等镜头时间误当成成片时长。
 */
import { SUPPORTED_VIDEO_DURATIONS, parseDurationSeconds } from './videoDurationValue'

/** 阿拉伯数字时长片段。 */
const ARABIC_DURATION_TOKEN = String.raw`\d+(?:\.\d+)?`
/** 中文数字时长片段。 */
const CHINESE_DURATION_TOKEN = '[零〇一二两三四五六七八九十]+'
/** 可识别的数字片段组合。 */
const DURATION_TOKEN = `(${ARABIC_DURATION_TOKEN}|${CHINESE_DURATION_TOKEN})`
/** 支持的秒单位表达。 */
const DURATION_UNIT = '(?:秒|s(?:ec(?:ond)?s?)?)'

/** 明确描述“视频总时长”的语句模式，排除普通时间点。 */
const EXPLICIT_TOTAL_DURATION_PATTERNS = [
  new RegExp(
    `(?:视频|成片|短片|广告片|整体)\\s*(?:总)?时长\\s*(?:为|是|设为|设置为|控制在|约|大约)?\\s*${DURATION_TOKEN}\\s*${DURATION_UNIT}`,
    'i',
  ),
  new RegExp(`总时长\\s*(?:为|是|设为|设置为|控制在|约|大约)?\\s*${DURATION_TOKEN}\\s*${DURATION_UNIT}`, 'i'),
  new RegExp(
    `(?:生成|制作|做)(?:一个|一条|一段|一支)?\\s*${DURATION_TOKEN}\\s*${DURATION_UNIT}\\s*(?:的)?(?:视频|成片|短片|广告)`,
    'i',
  ),
  new RegExp(`${DURATION_TOKEN}\\s*${DURATION_UNIT}\\s*(?:的)?(?:视频|成片|短片|广告)`, 'i'),
  new RegExp(`^\\s*${DURATION_TOKEN}\\s*${DURATION_UNIT}`, 'i'),
]

/** 中文数字字符到数值的基础映射。 */
const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

/** 将零到九十九范围内的中文数字解析为整数。 */
function parseChineseInteger(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  if (!text.includes('十')) {
    const digits = [...text].map((character) => CHINESE_DIGITS[character])
    if (digits.some((digit) => digit === undefined)) return null
    const number = Number(digits.join(''))
    return Number.isFinite(number) && number > 0 ? number : null
  }

  const [tensText, unitsText, ...rest] = text.split('十')
  if (rest.length) return null
  const tens = tensText ? CHINESE_DIGITS[tensText] : 1
  const units = unitsText ? CHINESE_DIGITS[unitsText] : 0
  if (tens === undefined || units === undefined) return null
  const number = tens * 10 + units
  return number > 0 ? number : null
}

/** 解析中文或阿拉伯数字形式的时长值。 */
function parseDurationToken(value: string): number | null {
  return parseDurationSeconds(value) ?? parseChineseInteger(value)
}

/**
 * Extract an explicitly stated total video duration from free-form requirements.
 * Per-shot phrases such as "镜头1持续3秒" deliberately do not match.
 */
export function extractExplicitTotalDurationSeconds(requirement: unknown): number | null {
  if (typeof requirement !== 'string') return null
  for (const pattern of EXPLICIT_TOTAL_DURATION_PATTERNS) {
    const match = requirement.match(pattern)
    const seconds = match?.[1] ? parseDurationToken(match[1]) : null
    if (seconds !== null) return seconds
  }
  return null
}

/** 创意时长不合法时的具体原因。 */
export type CreativeDurationIssue =
  | 'invalid-selection'
  | 'unsupported-selection'
  | 'unsupported-requirement'
  | 'requirement-mismatch'

/** 创意时长校验的成功或失败结果。 */
export type CreativeDurationValidation =
  | {
      valid: true
      selectedSeconds: number
      requestedSeconds: number | null
      issue: null
      message: ''
    }
  | {
      valid: false
      selectedSeconds: number | null
      requestedSeconds: number | null
      issue: CreativeDurationIssue
      message: string
    }

/** 不同创作流程可传入各自的合法时长，默认保留离散档位流程的 5/10/15 秒规则。 */
export interface CreativeDurationPolicyOptions {
  supportedDurations?: readonly number[]
  supportedDurationLabel?: string
}

/** 把连续范围压缩成“1至15秒”，离散档位仍显示完整列表。 */
function formatSupportedDurationLabel(durations: readonly number[]): string {
  if (!durations.length) return '有效时长'
  const continuous = durations.every((duration, index) => index === 0 || duration === durations[index - 1] + 1)
  if (continuous && durations.length > 2) {
    return `${durations[0]}至${durations[durations.length - 1]}秒`
  }
  return durations.map((seconds) => `${seconds}秒`).join('、')
}

/** 同时校验结构化时长选择和需求文本中明确写出的总时长。 */
export function validateCreativeDurationSelection(
  requirement: unknown,
  selectedDuration: unknown,
  options: CreativeDurationPolicyOptions = {},
): CreativeDurationValidation {
  const supportedDurations = options.supportedDurations?.length
    ? [...new Set(options.supportedDurations)].filter((duration) => Number.isFinite(duration) && duration > 0)
    : [...SUPPORTED_VIDEO_DURATIONS]
  const supportedDurationLabel = options.supportedDurationLabel || formatSupportedDurationLabel(supportedDurations)
  const selectedSeconds = parseDurationSeconds(selectedDuration)
  const requestedSeconds = extractExplicitTotalDurationSeconds(requirement)
  const selectedSupported = selectedSeconds !== null && supportedDurations.includes(selectedSeconds)

  if (!selectedSupported) {
    const issue = selectedSeconds === null ? 'invalid-selection' : 'unsupported-selection'
    return {
      valid: false,
      selectedSeconds,
      requestedSeconds,
      issue,
      message:
        issue === 'unsupported-selection'
          ? `当前选择的${selectedSeconds}秒不受支持，请选择${supportedDurationLabel}`
          : `视频时长无效，请选择${supportedDurationLabel}`,
    }
  }

  if (requestedSeconds !== null && !supportedDurations.includes(requestedSeconds)) {
    return {
      valid: false,
      selectedSeconds,
      requestedSeconds,
      issue: 'unsupported-requirement',
      message: `创作需求中指定了${requestedSeconds}秒，但当前视频模型仅支持${supportedDurationLabel}，请修改需求或时长选项`,
    }
  }

  if (requestedSeconds !== null && requestedSeconds !== selectedSeconds) {
    return {
      valid: false,
      selectedSeconds,
      requestedSeconds,
      issue: 'requirement-mismatch',
      message: `创作需求中指定了${requestedSeconds}秒，但当前时长选项是${selectedSeconds}秒，请保持两处一致后再生成`,
    }
  }

  return {
    valid: true,
    selectedSeconds,
    requestedSeconds,
    issue: null,
    message: '',
  }
}
