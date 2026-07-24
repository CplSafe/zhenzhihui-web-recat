/**
 * 智能成片与爆款复制当前开放的视频生成模型识别规则。
 *
 * 优先读取后端明确的 capability/effect/model_family/operation 元数据；只有这些字段
 * 无法给出具体效果时，才兼容机器名称和展示名称。展示文案仍完全来自后端。
 */
import {
  getBackendGenerationModelConfigurationError,
  getBackendGenerationModelName,
  getBackendGenerationModelVersionId,
  isBackendGenerationModelEnabled,
  type BackendGenerationModel,
} from './generationModelCatalog'

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
 * 与真实 capability 冲突时把错误模型提交给后端。
 */
export function getCreativeVideoModelKind(model: BackendGenerationModel | null | undefined): CreativeVideoModelKind {
  if (!model) return 'other'
  const explicitKind = classifyTexts(textsFromKeys(model, EXPLICIT_CAPABILITY_KEYS))
  if (explicitKind !== 'other') return explicitKind
  return classifyTexts(textsFromKeys(model, FALLBACK_IDENTITY_KEYS))
}

function isHappyHorseReferenceVideoModel(model: BackendGenerationModel): boolean {
  if (getCreativeVideoModelKind(model) !== 'reference-video') return false
  return textsFromKeys(model, [...EXPLICIT_CAPABILITY_KEYS, ...FALLBACK_IDENTITY_KEYS, ...PROVIDER_IDENTITY_KEYS]).some(
    (identity) => compactIdentity(identity).includes('happyhorse'),
  )
}

function featuredSlotOf(model: BackendGenerationModel): 'happyhorse-reference-video' | 'seedance-2.0' | null {
  const kind = getCreativeVideoModelKind(model)
  if (kind === 'seedance-2.0') return 'seedance-2.0'
  return isHappyHorseReferenceVideoModel(model) ? 'happyhorse-reference-video' : null
}

/** 只允许 HappyHorse 参考生视频与 Seedance 2.0 系列进入视频生成下拉。 */
export function isFeaturedCreativeVideoModel(model: BackendGenerationModel | null | undefined): boolean {
  return Boolean(model && featuredSlotOf(model))
}

/** 智能成片不展示传统图生视频、文生视频和元数据互相冲突的记录。 */
export function isHiddenSmartVideoModel(model: BackendGenerationModel | null | undefined): boolean {
  const kind = getCreativeVideoModelKind(model)
  return kind === 'traditional-video' || kind === 'conflict'
}

/**
 * 找出同一个规范化 model version ID 被标成不同视频效果的目录冲突。
 * 未能识别效果的重复记录不参与冲突判断。
 */
export function getConflictingCreativeVideoModelIds<T extends BackendGenerationModel>(
  models: readonly T[] | null | undefined,
): number[] {
  const kindsById = new Map<number, Set<CreativeVideoModelKind>>()
  const conflicts = new Set<number>()

  for (const model of Array.isArray(models) ? models : []) {
    const id = getBackendGenerationModelVersionId(model)
    const kind = getCreativeVideoModelKind(model)
    if (id === null || kind === 'other') continue
    if (kind === 'conflict') {
      conflicts.add(id)
      continue
    }
    const kinds = kindsById.get(id) ?? new Set<CreativeVideoModelKind>()
    kinds.add(kind)
    kindsById.set(id, kinds)
    if (kinds.size > 1) conflicts.add(id)
  }

  return Array.from(conflicts).sort((left, right) => left - right)
}

function featuredCandidatePriority(model: BackendGenerationModel): number {
  const hasDisplayName = Boolean(getBackendGenerationModelName(model))
  const hasValidId = getBackendGenerationModelVersionId(model) !== null
  const enabled = isBackendGenerationModelEnabled(model)
  const configured = !getBackendGenerationModelConfigurationError(model)
  return (hasDisplayName ? 0 : 8) + (hasValidId ? 0 : 4) + (enabled ? 0 : 2) + (configured ? 0 : 1)
}

/**
 * 每个开放效果最多保留一个后端记录。
 * 同类模型优先选择拥有后端名称、有效版本 ID、已启用且 schema 配置有效的记录；同优先级保持后端原顺序。
 */
export function filterFeaturedCreativeVideoModels<T extends BackendGenerationModel>(
  models: readonly T[] | null | undefined,
): T[] {
  const list = Array.isArray(models) ? models : []
  const conflictingIds = new Set(getConflictingCreativeVideoModelIds(list))
  const selectedBySlot = new Map<'happyhorse-reference-video' | 'seedance-2.0', T>()

  list.forEach((model) => {
    const id = getBackendGenerationModelVersionId(model)
    if (id !== null && conflictingIds.has(id)) return
    const slot = featuredSlotOf(model)
    if (!slot) return
    const selected = selectedBySlot.get(slot)
    if (!selected || featuredCandidatePriority(model) < featuredCandidatePriority(selected)) {
      selectedBySlot.set(slot, model)
    }
  })

  const selected = new Set(selectedBySlot.values())
  return list.filter((model) => selected.has(model))
}
