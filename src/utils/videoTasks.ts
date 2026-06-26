/**
 * 视频生成任务参数构建
 * 根据不同 AI 模型的 schema 构建视频生成请求参数。
 */
import { normalizeSeedanceRatio } from './videoOptions.js'
import { getModelParamFields, findFirstField } from './modelSchema.js'

export function buildVideoGenerationParams(model, params) {
  const fields = getModelParamFields(model)
  const duration = normalizeDuration(params?.duration)
  const ratio = normalizeSeedanceRatio(params?.ratio)
  const resolution = String(params?.resolution || '').trim()
  const generateAudio = Boolean(params?.generateAudio)

  if (!fields.length) {
    return {
      duration: snapSeedanceDuration(duration),
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

  const audioField = findFirstField(fields, ['generate_audio', 'generateAudio'])
  if (audioField) {
    payload[audioField.name] = generateAudio
  } else if (generateAudio) {
    // 模型 schema 没声明 audio 字段时也要带上(否则成片无声):按标准名 generate_audio 下发
    payload.generate_audio = true
  }

  return payload
}

function normalizeDuration(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return 10
  return seconds
}

function snapSeedanceDuration(duration) {
  const options = [5, 10, 15]
  let best = options[0]
  let bestDiff = Math.abs(best - duration)

  for (const option of options.slice(1)) {
    const diff = Math.abs(option - duration)
    if (diff < bestDiff) {
      best = option
      bestDiff = diff
    } else if (diff === bestDiff && option < best) {
      best = option
    }
  }

  return best
}

function pickOption(value, field) {
  const options = Array.isArray(field?.options) ? field.options.map(String) : []
  const text = String(value ?? '')
  if (!options.length) return text
  if (options.includes(text)) return text
  return String(options[0])
}

function pickClosestNumericOption(value, field) {
  const options = Array.isArray(field?.options) ? field.options : []
  const numericOptions = options.map((option) => Number(option)).filter((num) => Number.isFinite(num) && num > 0)

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
