/**
 * 视频生成选项常量与规范化
 * 时长选项、画面比例选项、Seedance 比例映射等。
 */
import { parseParamsSchema } from './modelSchema.js'

export const SEEDANCE_RATIO_OPTIONS = ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9']
// 入口/图片对话的比例选项(SmartEntry、ImageChat 共用,顺序与 Seedance 列表不同,单独维护)
export const ENTRY_RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4']

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
