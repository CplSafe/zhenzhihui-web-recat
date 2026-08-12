/**
 * 视频生成选项常量与规范化
 * 时长选项、画面比例选项、Seedance 比例映射等。
 */
import { matchModelParamOptionValue, parseParamsSchema } from './modelSchema.js'

/** Seedance 模型允许的画面比例。 */
export const SEEDANCE_RATIO_OPTIONS = ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9']
// 入口/图片对话的比例选项(SmartEntry、ImageChat 共用,顺序与 Seedance 列表不同,单独维护)
export const ENTRY_RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4']

/** 将入口图片比例限制在支持列表内，非法值回退竖屏。 */
export function normalizeImageRatio(ratio) {
  return ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9'].includes(ratio) ? ratio : '9:16'
}

/** 将 Seedance 视频比例限制在模型支持列表内。 */
export function normalizeSeedanceRatio(ratio) {
  if (SEEDANCE_RATIO_OPTIONS.includes(ratio)) {
    return ratio
  }

  return '9:16'
}

/** 将 Seedance 时长规范化为支持的秒数。 */
export function normalizeSeedanceDuration(duration) {
  const seconds = Number.parseInt(String(duration || ''), 10)

  if (!Number.isFinite(seconds)) {
    return 10
  }

  return Math.min(Math.max(seconds, 1), 15)
}

/** 模型未声明分辨率 schema 时，入口展示的默认档位。 */
export const DEFAULT_VIDEO_RESOLUTIONS = ['480p', '720p', '1080p']
/** 历史默认分辨率；模型支持时继续沿用，保证老项目的出片规格不变。 */
export const LEGACY_DEFAULT_VIDEO_RESOLUTION = '720p'

/**
 * 将分辨率收敛到当前模型支持的档位内。
 * 已选值仍受支持时保留该档位（采用模型声明的原始拼写，如 720P）；否则优先回退到 720p，再退回首个可选档位。
 */
export function normalizeVideoResolution(resolution, options) {
  const current = String(resolution || '').trim()
  const supported = (Array.isArray(options) ? options : []).map((option) => String(option || '').trim()).filter(Boolean)

  if (!supported.length) return current || LEGACY_DEFAULT_VIDEO_RESOLUTION
  // 档位比较忽略大小写：模型写 720P、入口存 720p 时属于同一档，不应被判为不支持而回退。
  return (
    matchModelParamOptionValue(current, supported) ??
    matchModelParamOptionValue(LEGACY_DEFAULT_VIDEO_RESOLUTION, supported) ??
    supported[0]
  )
}

/** 从模型参数 schema 中读取指定字段的可选值。 */
export function getModelParamOptions(model, paramName) {
  const schema = parseParamsSchema(model?.params_schema ?? model?.paramsSchema)
  const fields = Array.isArray(schema?.fields) ? schema.fields : []
  const field = fields.find((item) => item?.name === paramName)

  return Array.isArray(field?.options) ? field.options : []
}
