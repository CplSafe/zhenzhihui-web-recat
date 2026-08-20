/**
 * 创作台模型选择器的展示层投影。
 *
 * 后端模型记录的字段命名在不同 operation / 供应商之间并不统一（snake_case 与 camelCase 混用），
 * 这里按候选字段名依次探测，取到第一个非空值即可，避免页面写死某一个 key。
 * 纯函数：不发请求、不读全局状态。
 */
import type { GenerationModelOption } from './generationModelCatalog'
import { buildModelRestrictionSummary, type GenerationModelConstraints } from './modelRestrictions'

/** 模型 logo 的候选字段名（后端不同版本命名不一致）。 */
const LOGO_FIELDS = [
  'logo',
  'logo_url',
  'logoUrl',
  'icon',
  'icon_url',
  'iconUrl',
  'avatar',
  'avatar_url',
  'avatarUrl',
  'image',
  'image_url',
  'imageUrl',
  'provider_logo',
  'providerLogo',
  'provider_icon',
  'providerIcon',
  'brand_logo',
  'brandLogo',
  'cover',
  'cover_url',
  'coverUrl',
]

const DESCRIPTION_FIELDS = [
  'description',
  'display_description',
  'displayDescription',
  'model_description',
  'modelDescription',
  'summary',
  'intro',
]

const PROVIDER_FIELDS = ['provider_name', 'providerName', 'provider', 'vendor', 'vendor_name', 'vendorName']
const VERSION_FIELDS = ['version_name', 'versionName', 'version', 'model_version', 'modelVersion']

/** 从后端记录里按候选字段名取第一个非空字符串。 */
function readText(source: Record<string, any> | undefined, fields: readonly string[]): string {
  if (!source) return ''
  for (const field of fields) {
    const value = source[field]
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim()
      if (text) return text
    }
    // provider 有时是对象：{ name, logo }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value.name ?? value.title ?? value.label
      if (typeof nested === 'string' && nested.trim()) return nested.trim()
    }
  }
  return ''
}

/** 只接受 http(s) 与 data: 图片地址，避免把任意字符串塞进 img src。 */
function sanitizeLogoUrl(value: string): string {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  if (/^data:image\//i.test(value)) return value
  if (value.startsWith('//')) return `https:${value}`
  if (value.startsWith('/')) return value
  return ''
}

/** 从模型记录（含嵌套 provider 对象）里解析 logo 地址。 */
export function readModelLogo(source: Record<string, any> | undefined): string {
  if (!source) return ''
  const direct = sanitizeLogoUrl(readText(source, LOGO_FIELDS))
  if (direct) return direct
  // provider / vendor 作为对象时，logo 常挂在它下面。
  for (const key of ['provider', 'vendor', 'brand', 'model', 'meta', 'extra']) {
    const nested = source[key]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const found = sanitizeLogoUrl(readText(nested, LOGO_FIELDS))
      if (found) return found
    }
  }
  return ''
}

/** 模型名首字母，作为没有 logo 时的占位。 */
export function modelInitial(name: string): string {
  const text = String(name || '').trim()
  return text ? text.slice(0, 1).toUpperCase() : 'AI'
}

/** 创作台模型选择器直接渲染所需的一条模型。 */
export interface StudioModelChoice {
  id: number
  name: string
  description: string
  logo: string
  provider: string
  version: string
  /** 该模型声明的参数约束，用于推导比例 / 分辨率 / 时长档位。 */
  constraints: GenerationModelConstraints
  /** 该模型的限制说明，展示在下拉项里。 */
  restrictions: string[]
  /** 后端原始记录，提交任务时回传。 */
  source: any
}

/** 把目录里的模型选项投影为选择器可直接渲染的数据。 */
export function toStudioModelChoice(option: GenerationModelOption): StudioModelChoice {
  const source = (option.source || {}) as Record<string, any>
  const summary = buildModelRestrictionSummary(source)
  return {
    id: option.modelVersionId,
    name: option.displayName,
    description: readText(source, DESCRIPTION_FIELDS),
    logo: readModelLogo(source),
    provider: readText(source, PROVIDER_FIELDS),
    version: readText(source, VERSION_FIELDS),
    constraints: summary.constraints,
    restrictions: summary.messages,
    source,
  }
}
