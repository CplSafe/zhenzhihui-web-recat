/**
 * 视频生成选项常量与规范化
 * 时长选项、画面比例选项、Seedance 比例映射等。
 */
import { parseParamsSchema } from './modelSchema.js'

export const SEEDANCE_DURATION_OPTIONS = Array.from({ length: 15 }, (_, index) => `${index + 1}s`)
export const SEEDANCE_RATIO_OPTIONS = ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9']
// 入口/图片对话的比例选项(SmartEntry、ImageChat 共用,顺序与 Seedance 列表不同,单独维护)
export const ENTRY_RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4']

export function normalizeImageRatio(ratio) {
  return ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9'].includes(ratio) ? ratio : '9:16'
}

// 按比例值（如 16:9 / 9:16）生成下拉菜单比例图标的宽高，便于直观展示比例差异。
export function getRatioIconStyle(value: string): { width: string; height: string } {
  const [rwRaw, rhRaw] = String(value || '').split(':')
  const rw = Number.parseFloat(rwRaw)
  const rh = Number.parseFloat(rhRaw)
  if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) {
    return { width: '22px', height: '14px' }
  }
  const maxWidth = 26
  const maxHeight = 14
  const scale = Math.min(maxWidth / rw, maxHeight / rh)
  const width = Math.max(8, Math.round(rw * scale))
  const height = Math.max(8, Math.round(rh * scale))
  return { width: `${width}px`, height: `${height}px` }
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
