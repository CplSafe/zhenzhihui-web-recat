/**
 * 视频生成任务参数构建
 * 根据不同 AI 模型的 schema 构建视频生成请求参数。
 */
import { normalizeSeedanceRatio } from './videoOptions.js'
import { getModelParamFields, findFirstField } from './modelSchema.js'
import { parseDurationSeconds, resolveVideoDuration } from './videoDurationValue.js'

/** 根据模型 schema 和用户选择构建视频生成请求参数。 */
export function buildVideoGenerationParams(model, params) {
  const fields = getModelParamFields(model)
  const duration = parseDurationSeconds(params?.duration) ?? 10
  const ratio = normalizeSeedanceRatio(params?.ratio)
  const resolution = String(params?.resolution || '').trim()
  const generateAudio = Boolean(params?.generateAudio)

  if (!fields.length) {
    return {
      duration: resolveVideoDuration(duration) ?? 10,
      resolution: resolution || '720p',
      ratio,
      generate_audio: generateAudio,
    }
  }

  const payload: Record<string, any> = {}

  const durationField = findFirstField(fields, ['duration', 'seconds'])
  if (durationField) {
    payload[durationField.name] = pickClosestNumericOption(duration, durationField)
  }

  const ratioField = findFirstField(fields, ['ratio', 'aspect_ratio', 'aspectRatio'])
  if (ratioField) {
    payload[ratioField.name] = pickOption(ratio, ratioField)
  }

  const resolutionField = findFirstField(fields, ['resolution'])
  if (resolutionField) {
    payload[resolutionField.name] = pickOption(resolution || '720p', resolutionField)
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
    payload[audioField.name] = generateAudio
  } else if (generateAudio) {
    // 模型 schema 没声明 audio 字段时也要带上(否则成片无声):按标准名 generate_audio 下发
    payload.generate_audio = true
  }

  return payload
}

/** 在字段可选值中选择目标值，不存在时回退首项。 */
function pickOption(value, field) {
  const options = Array.isArray(field?.options) ? field.options.map(String) : []
  const text = String(value ?? '')
  if (!options.length) return text
  if (options.includes(text)) return text
  return String(options[0])
}

/** 在数值选项中选择与目标值距离最近的一项。 */
function pickClosestNumericOption(value, field) {
  const options = Array.isArray(field?.options) ? field.options : []
  const numericOptions = options
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
