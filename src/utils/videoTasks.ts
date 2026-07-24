/**
 * 视频生成任务参数构建
 * 根据不同 AI 模型的 schema 构建视频生成请求参数。
 */
import { normalizeSeedanceRatio } from './videoOptions.js'
import {
  getModelParamFields,
  getModelParamOptionValues,
  findFirstField,
  getModelParamSchema,
  hasModelParamSchema,
} from './modelSchema.js'
import { parseDurationSeconds, resolveVideoDuration } from './videoDurationValue.js'

/** 根据模型 schema 和用户选择构建视频生成请求参数。 */
export function buildVideoGenerationParams(model, params) {
  const hasDeclaredSchema = hasModelParamSchema(model)
  const schema = getModelParamSchema(model)
  if (hasDeclaredSchema && !schema) {
    throw new Error(`${modelDisplayName(model)} 的参数定义无法解析，请联系管理员检查模型配置`)
  }
  const fields = getModelParamFields(model)
  const duration = parseDurationSeconds(params?.duration) ?? 10
  const exactDuration = params?.durationMode === 'exact'
  const validateExactDuration = params?.validateExactDuration === true
  const explicitRatio = String(params?.ratio ?? '').trim()
  const ratio = explicitRatio || normalizeSeedanceRatio(params?.ratio)
  const resolution = String(params?.resolution || '').trim()
  const generateAudio = Boolean(params?.generateAudio)

  if (!fields.length) {
    // 模型明确给出空 schema 时，表示没有可由调用方设置的参数；不能再套用旧模型的通用字段。
    if (hasDeclaredSchema) return {}
    return {
      duration: exactDuration ? duration : (resolveVideoDuration(duration) ?? 10),
      resolution: resolution || '720p',
      ratio: normalizeSeedanceRatio(params?.ratio),
      generate_audio: generateAudio,
    }
  }

  const payload: Record<string, any> = {}

  const durationField = findFirstField(fields, ['duration', 'seconds'])
  if (durationField) {
    // 精确时长不能静默吸附到其他档位；模型不支持时应在创建付费任务前给出明确提示。
    payload[durationField.name] =
      exactDuration && validateExactDuration
        ? requireSupportedExactDuration(duration, durationField, model)
        : exactDuration
          ? duration
          : pickClosestNumericOption(duration, durationField)
  }

  const ratioField = findFirstField(fields, ['ratio', 'aspect_ratio', 'aspectRatio'])
  if (ratioField) {
    payload[ratioField.name] = pickOption(ratio, ratioField, {
      explicit: Boolean(explicitRatio),
      label: '画面比例',
      model,
    })
  }

  const resolutionField = findFirstField(fields, ['resolution', 'size'])
  if (resolutionField) {
    payload[resolutionField.name] = pickOption(resolution || '720p', resolutionField, {
      explicit: Boolean(resolution),
      label: '分辨率',
      model,
    })
  }

  // 源视频时长(秒):含输入视频的任务(video.edit / video.replicate)按真实源视频时长计费,优先于 duration。
  // 仅当模型 schema 声明了该字段、且前端读到有效时长时下发 —— 与提交保持一致,保证「预估 = 实扣」。
  const sourceVideoDuration = parseDurationSeconds(params?.sourceVideoDuration)
  const sourceDurField = findFirstField(fields, ['source_video_duration', 'sourceVideoDuration'])
  if (sourceDurField && sourceVideoDuration !== null) {
    payload[sourceDurField.name] = sourceVideoDuration
  }

  const audioField = findFirstField(fields, ['generate_audio', 'generateAudio'])
  if (audioField) {
    payload[audioField.name] = pickOption(generateAudio, audioField, {
      explicit: Object.prototype.hasOwnProperty.call(params || {}, 'generateAudio'),
      label: '音频生成参数',
      model,
    })
  }

  return payload
}

function fieldOptionValues(field) {
  return getModelParamOptionValues(field)
}

function booleanOptionValue(value) {
  if (typeof value === 'boolean') return value
  if (value === 1 || String(value).trim().toLocaleLowerCase() === 'true') return true
  if (value === 0 || String(value).trim().toLocaleLowerCase() === 'false') return false
  return null
}

function optionMatches(value, option) {
  if (typeof value === 'boolean') return booleanOptionValue(option) === value
  return String(option) === String(value ?? '')
}

/**
 * 在字段可选值中选择目标值。
 *
 * 只有调用方没有提供值时才可使用后端第一项作为默认值；用户明确选择了 schema
 * 不支持的比例、分辨率或音频值时必须在创建付费任务前报错。
 */
function pickOption(value, field, context) {
  const rawOptions = fieldOptionValues(field)
  const normalizedOptions = rawOptions.map(String)
  const text = String(value ?? '')
  if (!normalizedOptions.length) return value
  const matchedIndex = rawOptions.findIndex((option) => optionMatches(value, option))
  if (matchedIndex >= 0) return rawOptions[matchedIndex]
  if (!context?.explicit) return rawOptions[0]

  throw new Error(
    `${modelDisplayName(context.model)} 不支持当前${context.label} ${text || '空值'}，可选值：${normalizedOptions.join('、')}`,
  )
}

/** 在数值选项中选择与目标值距离最近的一项。 */
function pickClosestNumericOption(value, field) {
  const numericOptions = fieldOptionValues(field)
    .map((option) => parseDurationSeconds(option))
    .filter((num): num is number => num !== null)

  if (!numericOptions.length) {
    return value
  }

  let best = numericOptions[0]
  let bestDiff = Math.abs(best - value)

  for (const option of numericOptions.slice(1)) {
    const diff = Math.abs(option - value)
    if (diff < bestDiff) {
      best = option
      bestDiff = diff
    } else if (diff === bestDiff && option < best) {
      best = option
    }
  }

  return best
}

function readNumericBoundary(field, names) {
  for (const name of names) {
    const value = Number(field?.[name])
    if (Number.isFinite(value)) return value
  }
  return null
}

function modelDisplayName(model) {
  return String(model?.display_name || model?.displayName || model?.name || model?.model || '当前视频模型').trim()
}

/** 校验智能成片的精确时长是否落在当前模型 schema 支持范围内。 */
function requireSupportedExactDuration(value, field, model) {
  const numericOptions = fieldOptionValues(field)
    .map((option) => parseDurationSeconds(option))
    .filter((num): num is number => num !== null)
  const supportedOptions = Array.from(new Set<number>(numericOptions)).sort((a, b) => a - b)

  if (supportedOptions.length && !supportedOptions.includes(value)) {
    throw new Error(`${modelDisplayName(model)} 不支持 ${value} 秒视频，可选时长：${supportedOptions.join('、')} 秒`)
  }

  const minimum = readNumericBoundary(field, ['minimum', 'min', 'min_value', 'minValue'])
  const maximum = readNumericBoundary(field, ['maximum', 'max', 'max_value', 'maxValue'])
  if ((minimum !== null && value < minimum) || (maximum !== null && value > maximum)) {
    const range =
      minimum !== null && maximum !== null
        ? `${minimum}–${maximum} 秒`
        : minimum !== null
          ? `不少于 ${minimum} 秒`
          : `不超过 ${maximum} 秒`
    throw new Error(`${modelDisplayName(model)} 支持的时长为${range}，当前为 ${value} 秒`)
  }

  return value
}
