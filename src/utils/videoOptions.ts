/**
 * 视频生成选项常量与规范化
 * 时长选项、画面比例选项、Seedance 比例映射等。
 */
export const SEEDANCE_DURATION_OPTIONS = Array.from({ length: 15 }, (_, index) => `${index + 1}s`)
export const SEEDANCE_RATIO_OPTIONS = ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9']

export function normalizeImageRatio(ratio) {
  return ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9'].includes(ratio) ? ratio : '9:16'
}

export function normalizeSeedanceRatio(ratio) {
  if (SEEDANCE_RATIO_OPTIONS.includes(ratio)) {
    return ratio
  }

  return '9:16'
}

export function normalizeSeedanceDuration(duration) {
  const seconds = Number.parseInt(String(duration || ''), 10)

  if (!Number.isFinite(seconds)) {
    return 10
  }

  return Math.min(Math.max(seconds, 1), 15)
}

export function getModelParamOptions(model, paramName) {
  const schema = parseParamsSchema(model?.params_schema ?? model?.paramsSchema)
  const fields = Array.isArray(schema?.fields) ? schema.fields : []
  const field = fields.find((item) => item?.name === paramName)

  return Array.isArray(field?.options) ? field.options : []
}

export function isModelDurationSupported(model, duration) {
  const durationOptions = getModelParamOptions(model, 'duration')
    .map((option) => Number.parseInt(String(option), 10))
    .filter((option) => Number.isFinite(option))

  if (!durationOptions.length) {
    return true
  }

  return durationOptions.includes(normalizeSeedanceDuration(duration))
}

function parseParamsSchema(schema) {
  if (!schema) {
    return null
  }

  if (typeof schema !== 'string') {
    return schema
  }

  try {
    return JSON.parse(schema)
  } catch {
    return null
  }
}
