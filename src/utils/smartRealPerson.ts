import type { RealPerson, RealPersonAsset } from '@/api/realPeople'
import type { SmartSubjectAssetVersionRegistry } from './smartModelSwitchSafety'

export interface SmartRealPersonReference {
  realPersonId: number
  mappingId: number
  localAssetId: number
  personName: string
  verificationStatus: string
  assetStatus: string
}

const VERIFIED_PERSON_STATUSES = new Set(['verified', 'approved', 'succeeded', 'success'])
const READY_ASSET_STATUSES = new Set(['ready', 'active', 'verified', 'approved', 'succeeded', 'success', 'completed'])

export function isVerifiedRealPerson(person: RealPerson): boolean {
  return (
    Boolean(person.verified_at) ||
    VERIFIED_PERSON_STATUSES.has(
      String(person.status || '')
        .trim()
        .toLowerCase(),
    )
  )
}

export function isReadyRealPersonAsset(asset: RealPersonAsset): boolean {
  const localAssetId = Number(asset.local_asset_id || 0)
  return (
    localAssetId > 0 &&
    READY_ASSET_STATUSES.has(
      String(asset.status || '')
        .trim()
        .toLowerCase(),
    )
  )
}

export function createSmartRealPersonReference(person: RealPerson, asset: RealPersonAsset): SmartRealPersonReference {
  return {
    realPersonId: Number(person.id || 0),
    mappingId: Number(asset.id || 0),
    localAssetId: Number(asset.local_asset_id || 0),
    personName: String(person.name || '已认证真人'),
    verificationStatus: String(person.status || (person.verified_at ? 'verified' : '')),
    assetStatus: String(asset.status || ''),
  }
}

export function findRealPersonReference(
  registry: Record<string, SmartSubjectAssetVersionRegistry>,
  subjectName: string,
  imageUrl: string,
): SmartRealPersonReference | null {
  const ref = registry[subjectName]?.realPersonRefs?.[imageUrl]
  if (!ref || !Number(ref.realPersonId) || !Number(ref.localAssetId)) return null
  return ref
}

export function registerRealPersonReference(
  registry: Record<string, SmartSubjectAssetVersionRegistry>,
  subjectNames: Iterable<string>,
  imageUrl: string,
  reference: SmartRealPersonReference,
): Record<string, SmartSubjectAssetVersionRegistry> {
  const next = { ...registry }
  for (const name of subjectNames) {
    const existing = next[name] || { versions: [] }
    next[name] = {
      ...existing,
      versions: Array.from(new Set([imageUrl, ...(existing.versions || [])])),
      ids: { ...existing.ids, [imageUrl]: reference.localAssetId },
      sources: { ...existing.sources, [imageUrl]: 'upload' },
      realPersonRefs: { ...existing.realPersonRefs, [imageUrl]: reference },
    }
  }
  return next
}

export function isRealPersonReferenceStillAuthorized(
  reference: SmartRealPersonReference,
  people: RealPerson[],
): boolean {
  const person = people.find((item) => Number(item.id) === Number(reference.realPersonId))
  if (!person || !isVerifiedRealPerson(person)) return false
  return (person.assets || []).some(
    (asset) =>
      Number(asset.id) === Number(reference.mappingId) &&
      Number(asset.local_asset_id) === Number(reference.localAssetId) &&
      isReadyRealPersonAsset(asset),
  )
}

/**
 * 仅为“单一人物主体且其当前素材来自已认证真人”的镜头跳过整图脱敏。
 * 多人物/来源不明时保持原脱敏策略，避免把路人或未授权人物一并放行。
 */
export function resolveShotRealPersonPreservation(
  shot: { subjects?: Array<{ tag?: string; kind?: string; image?: string }> },
  registry: Record<string, SmartSubjectAssetVersionRegistry>,
): SmartRealPersonReference | null {
  const people = (shot.subjects || []).filter((subject) =>
    /人物|人像|角色|person|portrait|model/i.test(subject.kind || ''),
  )
  if (people.length !== 1) return null
  const subject = people[0]
  const name = String(subject.tag || '')
    .replace(/^@/, '')
    .trim()
  const imageUrl = String(subject.image || '')
  if (!name || !imageUrl) return null
  return findRealPersonReference(registry, name, imageUrl)
}

/**
 * 真人成片进入视频生成前必须逐镜头保留同一个已认证真人引用。
 * 任一镜头缺失引用都直接阻断，避免部分镜头在无真人约束下继续生成。
 */
export function requireRealPersonPreservationForShots(
  shots: Array<{ no?: string; subjects?: Array<{ tag?: string; kind?: string; image?: string }> }>,
  registry: Record<string, SmartSubjectAssetVersionRegistry>,
): SmartRealPersonReference[] {
  return shots.map((shot, index) => {
    const reference = resolveShotRealPersonPreservation(shot, registry)
    if (!reference) {
      throw new Error(`${shot.no || `分镜 ${index + 1}`}缺少唯一且有效的真人素材，请重新选择真人素材后再生成`)
    }
    return reference
  })
}
