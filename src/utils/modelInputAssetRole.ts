/**
 * 解析后端模型为 input_assets 声明的素材角色。
 *
 * 各创作入口（智能成片、无限画布）都要按同一口径下发 role：角色由模型 schema 决定，
 * 前端不自行猜测。写死 role 会在模型声明了非 image 角色时被后端按
 * INPUT_ASSET_ROLE_NOT_ALLOWED 拒绝，或者更糟——素材被当成另一种输入读进去。
 */
import {
  findModelParamField,
  getModelParamFields,
  getModelParamOptionValues,
  normalizeModelParamName,
} from './modelSchema'

/** 后端 schema 中用于声明输入素材角色的字段名。 */
const INPUT_ASSET_ROLE_FIELD_NAMES = [
  'input_asset_role',
  'inputAssetRole',
  'input_role',
  'inputRole',
  'image_input_role',
  'imageInputRole',
  'reference_image_role',
  'referenceImageRole',
]

/** 读取 input_assets 数组项里的标准 JSON Schema role 声明。 */
function readNestedInputAssetRoleField(fields: unknown[]): Record<string, unknown> | null {
  const inputAssetsField = findModelParamField(fields, ['input_assets', 'inputAssets']) as
    | Record<string, unknown>
    | undefined
    | null
  const rawItems = inputAssetsField?.items
  const items = rawItems && typeof rawItems === 'object' ? (rawItems as Record<string, unknown>) : null
  const rawProperties = items?.properties
  const properties =
    rawProperties && typeof rawProperties === 'object' ? (rawProperties as Record<string, unknown>) : null
  const rawRole = properties?.role
  const role = rawRole && typeof rawRole === 'object' ? (rawRole as Record<string, unknown>) : null
  if (!role) return null
  const required = Array.isArray(items?.required)
    ? (items.required as unknown[]).some((name) => normalizeModelParamName(name) === 'role')
    : false
  return { ...role, name: 'role', ...(required ? { required: true } : {}) }
}

function readInputRoleText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

/**
 * 只在后端 schema 明确声明输入角色时采用该声明。
 * 未声明时继续使用历史 role:'image'；多种非 image 角色且无默认值时不猜测，付费任务前拦截。
 */
export function resolveModelInputAssetRole(model: unknown): string {
  const fields = getModelParamFields(model)
  const field = (findModelParamField(fields, INPUT_ASSET_ROLE_FIELD_NAMES) ||
    readNestedInputAssetRoleField(fields)) as Record<string, unknown> | null
  if (!field) return 'image'

  const options = Array.from(new Set(getModelParamOptionValues(field).map(readInputRoleText).filter(Boolean)))
  const defaultRole = readInputRoleText(field.default ?? field.default_value ?? field.defaultValue)
  if (defaultRole) {
    if (options.length && !options.includes(defaultRole)) {
      throw new Error('所选视频模型的输入素材角色默认值不在允许范围内，请联系管理员检查模型配置')
    }
    return defaultRole
  }

  const imageRole = options.find((role) => normalizeModelParamName(role) === 'image')
  if (imageRole) return imageRole
  if (options.length === 1) return options[0]
  if (options.length > 1 || field.required === true) {
    throw new Error('所选视频模型声明了输入素材角色，但未提供唯一可用角色，请联系管理员检查模型配置')
  }
  return 'image'
}

/**
 * 与上面同源，但配置有歧义时不抛错而是退回 'image'。
 *
 * 供渲染期使用（画布面板的估价在 useMemo 里算）：那里抛错会直接把面板炸掉，
 * 而模型配置本身的问题应该在提交时由 resolveModelInputAssetRole 报出来。
 */
export function resolveModelInputAssetRoleSafe(model: unknown): string {
  try {
    return resolveModelInputAssetRole(model)
  } catch {
    return 'image'
  }
}
