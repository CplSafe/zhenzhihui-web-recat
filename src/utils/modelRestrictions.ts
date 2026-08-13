/**
 * 将后端模型元数据转换为可展示、可校验的使用限制。
 *
 * 限制原则上只来自后端字段与 params schema，不根据模型名称猜测能力。
 * 唯一的例外是时长档位：个别模型声明了 duration 字段却没给可选值，前端因此无从校验，
 * 只能把总时长原样下发再被 provider 以 400 拒绝。这种情况下回退到 creativeVideoModelKind
 * 里的兜底表（见 getFallbackDurationOptions），且后端一旦声明就立即以后端为准。
 */
import {
  getModelParamFieldNames,
  getModelParamFields,
  getModelParamOptionValues,
  matchModelParamOptionValue,
  normalizeModelParamName,
} from './modelSchema'
import { getFallbackDurationOptions } from './creativeVideoModelKind'
import { parseDurationSeconds } from './videoDurationValue'

export interface NumericModelConstraint {
  options?: number[]
  minimum?: number
  maximum?: number
  required?: boolean
}

export interface StringModelConstraint {
  options?: string[]
  required?: boolean
}

export interface BooleanModelConstraint {
  options?: boolean[]
  required?: boolean
}

export interface GenerationModelConstraints {
  duration?: NumericModelConstraint
  /** 兼容已有入口校验的简洁字段。 */
  ratios?: string[]
  resolutions?: string[]
  /** 保留 required 等完整元数据。 */
  ratio?: StringModelConstraint
  resolution?: StringModelConstraint
  audio?: BooleanModelConstraint
  referenceImages?: NumericModelConstraint
  requiredFields?: string[]
}

export interface ModelRestrictionSummary {
  messages: string[]
  constraints: GenerationModelConstraints
}

export interface GenerationModelConstraintValues {
  durationSec?: number
  ratio?: string
  resolution?: string
  generateAudio?: boolean
  referenceImageCount?: number
}

const EXPLICIT_RESTRICTION_KEYS = [
  'limitations',
  'limitation',
  'restriction_text',
  'restrictionText',
  'restrictions',
  'usage_notes',
  'usageNotes',
  'limit_description',
  'limitDescription',
  'constraints_description',
  'constraintsDescription',
  'warning',
  'warnings',
  'notice',
  'notices',
] as const

const PLAN_KEYS = [
  'required_plan_name',
  'requiredPlanName',
  'required_plan',
  'requiredPlan',
  'minimum_plan',
  'minimumPlan',
] as const

const DURATION_FIELD_NAMES = ['duration', 'seconds', 'durationsec', 'durationseconds', 'videoduration']
const RATIO_FIELD_NAMES = ['ratio', 'aspectratio', 'videoaspectratio']
const RESOLUTION_FIELD_NAMES = ['resolution', 'size', 'videoresolution', 'outputresolution']
const AUDIO_FIELD_NAMES = ['generateaudio', 'audio', 'withaudio', 'enableaudio']
const REFERENCE_IMAGE_FIELD_NAMES = [
  'imagecount',
  'inputimagecount',
  'referenceimagecount',
  'inputimages',
  'referenceimages',
  'referenceimageids',
  'inputimageids',
  'images',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readFiniteNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = record[key]
    if (raw === undefined || raw === null || raw === '') continue
    const value = Number(raw)
    if (Number.isFinite(value)) return value
  }
  return undefined
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLocaleLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return null
}

function collectExplicitText(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim()
    return text ? [text] : []
  }
  if (Array.isArray(value)) return value.flatMap(collectExplicitText)
  if (!isRecord(value)) return []
  return ['message', 'text', 'description', 'label'].flatMap((key) => collectExplicitText(value[key]))
}

function formatSeconds(values: number[]): string {
  return values.map((value) => `${value} 秒`).join('、')
}

function formatNumericRange(label: string, minimum?: number, maximum?: number, unit = ''): string {
  if (minimum !== undefined && maximum !== undefined) return `${label}：${minimum}–${maximum}${unit}`
  if (minimum !== undefined) return `${label}：至少 ${minimum}${unit}`
  return `${label}：最大 ${maximum}${unit}`
}

function isRequired(field: Record<string, unknown>): boolean {
  return field.required === true || field.required === 1 || String(field.required || '').toLocaleLowerCase() === 'true'
}

function fieldMatches(field: Record<string, unknown>, candidates: readonly string[]): boolean {
  const normalizedCandidates = new Set(candidates.map(normalizeModelParamName))
  return getModelParamFieldNames(field).some((name) => normalizedCandidates.has(normalizeModelParamName(name)))
}

function numericConstraintOf(
  field: Record<string, unknown>,
  optionParser: (value: unknown) => number | null,
): NumericModelConstraint {
  const options = Array.from(
    new Set(
      getModelParamOptionValues(field)
        .map(optionParser)
        .filter((value): value is number => value !== null && Number.isFinite(value)),
    ),
  ).sort((left, right) => left - right)
  const minimum = readFiniteNumber(field, ['minimum', 'min', 'min_value', 'minValue', 'minItems'])
  const maximum = readFiniteNumber(field, ['maximum', 'max', 'max_value', 'maxValue', 'maxItems'])
  const required = isRequired(field)

  return {
    ...(options.length ? { options } : {}),
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
    ...(required ? { required: true } : {}),
  }
}

/**
 * 读取单个后端模型的限制说明与入口兼容性约束。
 * 空 schema 或没有声明限制时返回空结果，不生成“默认限制”。
 */
export function buildModelRestrictionSummary(
  model: Record<string, unknown> | null | undefined,
): ModelRestrictionSummary {
  if (!model) return { messages: [], constraints: {} }

  const messages: string[] = []
  const constraints: GenerationModelConstraints = {}

  for (const key of EXPLICIT_RESTRICTION_KEYS) {
    messages.push(...collectExplicitText(model[key]))
  }

  const requiredPlan = PLAN_KEYS.flatMap((key) => collectExplicitText(model[key]))[0]
  if (requiredPlan) messages.push(`套餐要求：${requiredPlan}`)

  const fields = getModelParamFields(model)
  const requiredFields: string[] = []
  for (const field of fields) {
    if (isRequired(field)) requiredFields.push(field.name)

    if (fieldMatches(field, DURATION_FIELD_NAMES)) {
      const duration = numericConstraintOf(field, parseDurationSeconds)
      if (Object.keys(duration).length) constraints.duration = duration
      if (duration.options?.length) messages.push(`时长仅支持：${formatSeconds(duration.options)}`)
      else if (duration.minimum !== undefined || duration.maximum !== undefined) {
        messages.push(formatNumericRange('时长范围', duration.minimum, duration.maximum, ' 秒'))
      }
      continue
    }

    if (fieldMatches(field, RATIO_FIELD_NAMES)) {
      const ratios = uniqueStrings(getModelParamOptionValues(field))
      const required = isRequired(field)
      if (ratios.length) {
        constraints.ratios = ratios
        messages.push(`画面比例支持：${ratios.join('、')}`)
      }
      if (ratios.length || required)
        constraints.ratio = { ...(ratios.length ? { options: ratios } : {}), ...(required ? { required: true } : {}) }
      continue
    }

    if (fieldMatches(field, RESOLUTION_FIELD_NAMES)) {
      const resolutions = uniqueStrings(getModelParamOptionValues(field))
      const required = isRequired(field)
      if (resolutions.length) {
        constraints.resolutions = resolutions
        messages.push(
          `${normalizeModelParamName(field.name) === 'size' ? '画面尺寸' : '分辨率'}支持：${resolutions.join('、')}`,
        )
      }
      if (resolutions.length || required) {
        constraints.resolution = {
          ...(resolutions.length ? { options: resolutions } : {}),
          ...(required ? { required: true } : {}),
        }
      }
      continue
    }

    if (fieldMatches(field, AUDIO_FIELD_NAMES)) {
      const options = Array.from(
        new Set(
          getModelParamOptionValues(field)
            .map(readBoolean)
            .filter((value): value is boolean => value !== null),
        ),
      )
      const required = isRequired(field)
      if (options.length || required) {
        constraints.audio = {
          ...(options.length ? { options } : {}),
          ...(required ? { required: true } : {}),
        }
      }
      if (options.length === 1 && options[0] === false) messages.push('不支持生成音频')
      continue
    }

    if (fieldMatches(field, REFERENCE_IMAGE_FIELD_NAMES)) {
      const referenceImages = numericConstraintOf(field, (value) => {
        const numeric = Number(value)
        return Number.isFinite(numeric) ? numeric : null
      })
      if (Object.keys(referenceImages).length) constraints.referenceImages = referenceImages
      if (referenceImages.minimum !== undefined || referenceImages.maximum !== undefined) {
        messages.push(formatNumericRange('参考图数量', referenceImages.minimum, referenceImages.maximum, ' 张'))
      }
    }
  }

  if (requiredFields.length) constraints.requiredFields = Array.from(new Set(requiredFields))

  // 后端没有给出任何时长约束时，才回退到按模型识别的兜底档位。
  // schema 只要声明了 options 或上下限，这里就一律不介入——后端永远是权威。
  const hasDeclaredDuration = Boolean(
    constraints.duration?.options?.length ||
    constraints.duration?.minimum !== undefined ||
    constraints.duration?.maximum !== undefined,
  )
  if (!hasDeclaredDuration) {
    const fallbackDurations = getFallbackDurationOptions(model)
    if (fallbackDurations?.length) {
      constraints.duration = { ...(constraints.duration ?? {}), options: fallbackDurations }
      messages.push(`时长仅支持：${formatSeconds(fallbackDurations)}`)
    }
  }

  return {
    messages: Array.from(new Set(messages.map((message) => message.trim()).filter(Boolean))),
    constraints,
  }
}

function hasOwn(values: GenerationModelConstraintValues, key: keyof GenerationModelConstraintValues): boolean {
  return Object.prototype.hasOwnProperty.call(values, key)
}

/** 校验当前入口值是否落在所选模型的后端约束内。 */
/**
 * 模型下拉里跟在模型名后的时长能力标注，例如「最长 15 秒」。
 *
 * 只描述后端声明过的能力：没有时长约束的模型（脚本、图片等）返回空串，
 * 不能凭空写一个「最长 15 秒」让用户以为所有模型都做得到。
 */
export function getModelDurationLimitLabel(constraints: GenerationModelConstraints | undefined): string {
  const duration = constraints?.duration
  if (!duration) return ''

  const options = (duration.options || []).filter((value) => Number.isFinite(value) && value > 0)
  const declaredMax = Number.isFinite(duration.maximum as number) ? (duration.maximum as number) : null
  const maximum = options.length ? Math.max(...options) : declaredMax
  if (maximum !== null && maximum > 0) return `最长 ${maximum} 秒`

  // 只声明了下限：仍然告诉用户这个模型的起步时长，避免看起来毫无约束。
  const minimum = Number.isFinite(duration.minimum as number) ? (duration.minimum as number) : null
  return minimum !== null && minimum > 0 ? `最短 ${minimum} 秒` : ''
}

export function getModelConstraintConflicts(
  constraints: GenerationModelConstraints | undefined,
  values: GenerationModelConstraintValues,
): string[] {
  if (!constraints) return []
  const conflicts: string[] = []
  const durationSec = Number(values.durationSec)
  const duration = constraints.duration

  if (duration && Number.isFinite(durationSec) && durationSec > 0) {
    if (duration.options?.length && !duration.options.includes(durationSec)) {
      conflicts.push(`当前 ${durationSec} 秒不在可选时长 ${formatSeconds(duration.options)} 内`)
    } else if (
      (duration.minimum !== undefined && durationSec < duration.minimum) ||
      (duration.maximum !== undefined && durationSec > duration.maximum)
    ) {
      conflicts.push(
        `当前 ${durationSec} 秒不符合${formatNumericRange(
          '时长范围',
          duration.minimum,
          duration.maximum,
          ' 秒',
        ).replace('时长范围：', '')}`,
      )
    }
  } else if (duration?.required && hasOwn(values, 'durationSec')) {
    conflicts.push('当前模型要求提供时长')
  }

  const ratio = String(values.ratio || '').trim()
  const ratios = constraints.ratio?.options ?? constraints.ratios
  // 只在拼写上不同（大小写、首尾空格）视为同一档位：`720p` 与 `720P` 不是能力差异，不该报冲突。
  if (ratio && ratios?.length && matchModelParamOptionValue(ratio, ratios) === undefined) {
    conflicts.push(`当前比例 ${ratio} 不在支持范围 ${ratios.join('、')} 内`)
  } else if (!ratio && constraints.ratio?.required && hasOwn(values, 'ratio')) {
    conflicts.push('当前模型要求提供画面比例')
  }

  const resolution = String(values.resolution || '').trim()
  const resolutions = constraints.resolution?.options ?? constraints.resolutions
  if (resolution && resolutions?.length && matchModelParamOptionValue(resolution, resolutions) === undefined) {
    conflicts.push(`当前分辨率 ${resolution} 不在支持范围 ${resolutions.join('、')} 内`)
  } else if (!resolution && constraints.resolution?.required && hasOwn(values, 'resolution')) {
    conflicts.push('当前模型要求提供分辨率')
  }

  if (hasOwn(values, 'generateAudio')) {
    if (typeof values.generateAudio !== 'boolean' && constraints.audio?.required) {
      conflicts.push('当前模型要求明确是否生成音频')
    } else if (
      typeof values.generateAudio === 'boolean' &&
      constraints.audio?.options?.length &&
      !constraints.audio.options.includes(values.generateAudio)
    ) {
      conflicts.push(`当前模型${values.generateAudio ? '不支持' : '要求'}生成音频`)
    }
  }

  if (hasOwn(values, 'referenceImageCount')) {
    const count = Number(values.referenceImageCount)
    const referenceImages = constraints.referenceImages
    if (!Number.isFinite(count) && referenceImages?.required) {
      conflicts.push('当前模型要求提供参考图')
    } else if (Number.isFinite(count) && referenceImages) {
      if (
        (referenceImages.minimum !== undefined && count < referenceImages.minimum) ||
        (referenceImages.maximum !== undefined && count > referenceImages.maximum)
      ) {
        conflicts.push(
          `当前参考图数量 ${count} 不符合${formatNumericRange(
            '参考图数量',
            referenceImages.minimum,
            referenceImages.maximum,
            ' 张',
          ).replace('参考图数量：', '')}`,
        )
      }
    }
  }

  return conflicts
}
