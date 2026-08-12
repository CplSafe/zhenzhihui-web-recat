/**
 * 视频生成模型的效果分类，以及唯一一条前端屏蔽规则。
 *
 * 分类用于按效果适配请求参数（例如爆款复制的 Seedance 参数兜底）。
 * 展示哪些模型原则上完全由后端 `/api/v1/ai/models` 决定，后端新增模型前端即可直接显示；
 * 这里**不维护白名单**，只保留 `isHiddenCreativeVideoModel` 一条明确的屏蔽规则。
 *
 * 优先读取后端明确的 capability/effect/model_family/operation 元数据；只有这些字段
 * 无法给出具体效果时，才兼容机器名称和展示名称。
 */
import type { BackendGenerationModel } from './generationModelCatalog'

export type CreativeVideoModelKind = 'reference-video' | 'seedance-2.0' | 'traditional-video' | 'other' | 'conflict'

const EXPLICIT_CAPABILITY_KEYS = [
  'capability',
  'capabilities',
  'capability_code',
  'capabilityCode',
  'effect',
  'effects',
  'effect_code',
  'effectCode',
  'effect_type',
  'effectType',
  'video_effect',
  'videoEffect',
  'generation_type',
  'generationType',
  'generation_mode',
  'generationMode',
  'model_family',
  'modelFamily',
  'family',
  'operation_codes',
  'operationCodes',
  'operation_code',
  'operationCode',
  'operations',
] as const

const FALLBACK_IDENTITY_KEYS = [
  'model_code',
  'modelCode',
  'code',
  'slug',
  'model',
  'model_name',
  'modelName',
  'display_name',
  'displayName',
  'name',
  'version_name',
  'versionName',
  'version',
] as const

const PROVIDER_IDENTITY_KEYS = [
  'provider',
  'provider_name',
  'providerName',
  'vendor',
  'vendor_name',
  'vendorName',
] as const

function collectTexts(value: unknown, result: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTexts(item, result))
    return
  }
  if (value && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>
    const preferred = [
      record.code,
      record.value,
      record.type,
      record.name,
      record.key,
      record.family,
      record.operation_code,
      record.operationCode,
    ]
    if (preferred.some((item) => item !== undefined)) preferred.forEach((item) => collectTexts(item, result))
    return
  }
  if (typeof value !== 'string' && typeof value !== 'number') return
  const text = String(value).trim().toLocaleLowerCase()
  if (text) result.push(text)
}

function textsFromKeys(model: BackendGenerationModel, keys: readonly string[]): string[] {
  const result: string[] = []
  keys.forEach((key) => collectTexts(model[key], result))
  return Array.from(new Set(result))
}

function compactIdentity(value: string): string {
  return value.normalize('NFKC').replace(/[\s._\-/]+/g, '')
}

function kindOfText(identity: string): Exclude<CreativeVideoModelKind, 'other' | 'conflict'> | null {
  const compact = compactIdentity(identity)
  const isReferenceVideo =
    identity.includes('参考生视频') ||
    compact.includes('referencevideo') ||
    compact.includes('referencetovideo') ||
    compact.includes('referenceimagetovideo') ||
    compact.includes('referenceimage2video') ||
    compact.includes('ref2video') ||
    compact === 'r2v'
  if (isReferenceVideo) return 'reference-video'

  if (compact.includes('seedance20') || compact.includes('seedancev20')) return 'seedance-2.0'

  const isTraditionalVideo =
    identity.includes('图生视频') ||
    identity.includes('文生视频') ||
    compact.includes('imagetovideo') ||
    compact.includes('image2video') ||
    compact === 'i2v' ||
    compact.includes('texttovideo') ||
    compact.includes('text2video') ||
    compact === 't2v'
  return isTraditionalVideo ? 'traditional-video' : null
}

function classifyTexts(texts: readonly string[]): CreativeVideoModelKind {
  const kinds = new Set(
    texts
      .map(kindOfText)
      .filter((kind): kind is Exclude<CreativeVideoModelKind, 'other' | 'conflict'> => Boolean(kind)),
  )
  if (kinds.size > 1) return 'conflict'
  return kinds.values().next().value || 'other'
}

/**
 * 返回模型效果分类。显式能力元数据只要能识别就具有最高优先级，避免展示名称
 * 与真实 capability 冲突时按错误效果编译参数。
 */
export function getCreativeVideoModelKind(model: BackendGenerationModel | null | undefined): CreativeVideoModelKind {
  if (!model) return 'other'
  const explicitKind = classifyTexts(textsFromKeys(model, EXPLICIT_CAPABILITY_KEYS))
  if (explicitKind !== 'other') return explicitKind
  return classifyTexts(textsFromKeys(model, FALLBACK_IDENTITY_KEYS))
}

/**
 * 唯一被前端屏蔽的模型：HappyHorse 图生视频 / HappyHorse 文生视频。
 *
 * 规则刻意收窄为「HappyHorse 且效果为图生视频/文生视频」，其他厂商的同类效果模型
 * 以及 HappyHorse 参考生视频都照常展示；后端下架这两个模型后，删除本函数及其调用即可。
 */
export function isHiddenCreativeVideoModel(model: BackendGenerationModel | null | undefined): boolean {
  if (!model || getCreativeVideoModelKind(model) !== 'traditional-video') return false
  return textsFromKeys(model, [...EXPLICIT_CAPABILITY_KEYS, ...FALLBACK_IDENTITY_KEYS, ...PROVIDER_IDENTITY_KEYS]).some(
    (identity) => compactIdentity(identity).includes('happyhorse'),
  )
}

/** 版本字段单独声明 2.5 时（display_name 只写 Seedance）也要能识别。 */
const VERSION_IDENTITY_KEYS = ['version_name', 'versionName', 'version'] as const

/**
 * 智能成片入口暂不开放的模型：Seedance 2.5。
 *
 * 与 isHiddenCreativeVideoModel 分开维护：那条对所有流程生效，这条**只作用于智能成片**，
 * 画布等其他入口照常展示 2.5。后端确认 2.5 可在智能成片开放后，删除本函数及其调用即可。
 */
export function isHiddenSmartVideoModel(model: BackendGenerationModel | null | undefined): boolean {
  if (!model) return false
  const identities = textsFromKeys(model, [...FALLBACK_IDENTITY_KEYS, ...PROVIDER_IDENTITY_KEYS]).map(compactIdentity)
  if (identities.some((identity) => identity.includes('seedance25') || identity.includes('seedancev25'))) return true
  // 名称与版本分列两个字段：Seedance + 2.5 / v2.5.1 同样视为 2.5 线。
  return (
    identities.some((identity) => identity.includes('seedance')) &&
    textsFromKeys(model, VERSION_IDENTITY_KEYS).some((version) => /^v?2\.5(\.|$)/.test(version.trim()))
  )
}
