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

const REAL_PERSON_IDENTITY_PROMPT_MARKER = '【真人身份强约束'

const REAL_PERSON_IDENTITY_INSTRUCTION = [
  '第一张参考图是已授权真人的唯一身份基准',
  '生成结果必须是参考图中的同一个人，并在所有镜头中保持身份一致',
  '必须严格保留其脸型、头骨轮廓、五官比例、眼睛、鼻子、嘴唇、眉形、肤色、发际线和可识别身份特征',
  '保持真实自然的人脸纹理与年龄特征，不做美型、网红脸或卡通化处理',
  '只允许改变场景、服装、姿势、光线和镜头构图',
  '禁止换脸、混合其他人的脸、身份漂移、改变年龄、改变性别或重新设计五官',
].join('；')

/**
 * 视频侧的标记与图片侧刻意不同，且互不为子串：
 * 两段约束的分句数不同，去重时必须各认各的标记，否则会截错段落。
 */
const REAL_PERSON_VIDEO_IDENTITY_PROMPT_MARKER = '【真人出镜身份强约束'

/**
 * 视频版身份约束。视频的身份来自参考帧而非参考图，且漂移发生在运动过程中
 * （转头、大幅动作、长时长尤其明显），因此措辞针对"整片每一帧都得是同一个人"。
 */
const REAL_PERSON_VIDEO_IDENTITY_INSTRUCTION = [
  '参考帧中的人物是已授权真人，是本片唯一的身份基准',
  '整片从第一帧到最后一帧必须始终是同一个人，镜头切换、转头、走动、表情变化时身份都不能改变',
  '必须严格保留其脸型、头骨轮廓、五官比例、眼睛、鼻子、嘴唇、眉形、肤色、发际线和可识别身份特征',
  '保持真实自然的人脸纹理与年龄特征，不做美型、网红脸或卡通化处理',
  '只允许改变场景、服装、姿势、动作、光线和镜头运动',
  '禁止换脸、混合其他人的脸、中途换人、身份漂移、改变年龄、改变性别或重新设计五官',
  '不得凭空新增其他出镜人物的正脸',
].join('；')

/**
 * 去掉 prompt 里已有的同类约束，避免多次注入越叠越长。
 * 按「标记 → 约束正文结尾」整段切除，不按分句计数：图片侧用「；」拼接、视频侧用换行拼接，
 * 计数法会在换行处把用户内容一起吃掉。约束正文被改写过（找不到原文）时保持原样，宁可重复也不误删。
 */
function stripExistingConstraint(prompt: string, marker: string, instruction: string): string {
  const markerIndex = prompt.indexOf(marker)
  if (markerIndex < 0) return prompt
  const instructionIndex = prompt.indexOf(instruction, markerIndex)
  if (instructionIndex < 0) return prompt
  const head = prompt.slice(0, markerIndex).trim()
  const tail = prompt
    .slice(instructionIndex + instruction.length)
    .replace(/^[\s；;]+/, '')
    .trim()
  return [head, tail].filter(Boolean).join('；')
}

/** 真人成片的视频提示词身份约束正文（不含用户内容），供整片生成直接前置。 */
export function buildRealPersonVideoIdentityConstraint(personName?: string): string {
  const identityLabel = String(personName || '').trim()
  return `【真人出镜身份强约束${identityLabel ? `：${identityLabel}` : ''}】${REAL_PERSON_VIDEO_IDENTITY_INSTRUCTION}`
}

/**
 * 给视频提示词（整片生成 / 视频修改）注入身份约束。
 * 放在最前面：修改意见里常出现"换个发型""换套衣服"这类容易把脸一起带走的表述，
 * 约束必须先于它们出现。
 */
export function buildRealPersonVideoIdentityPrompt(prompt: string, personName?: string): string {
  const originalPrompt = String(prompt || '').trim()
  return [
    buildRealPersonVideoIdentityConstraint(personName),
    stripExistingConstraint(
      originalPrompt,
      REAL_PERSON_VIDEO_IDENTITY_PROMPT_MARKER,
      REAL_PERSON_VIDEO_IDENTITY_INSTRUCTION,
    ),
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 真人图必须始终占据参考图第一位。模型通常按输入顺序分配参考权重；若真人素材
 * 已经出现在后续位置，也必须先移除再置顶，避免被场景图或上一帧稀释身份特征。
 */
export function prioritizeRealPersonReferenceAssetIds(assetIds: number[], realPersonAssetId: number): number[] {
  const identityId = Number(realPersonAssetId || 0)
  const normalized = Array.from(
    new Set(assetIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0 && id !== identityId)),
  )
  return identityId > 0 ? [identityId, ...normalized] : normalized
}

/** 为真人图生图注入不可被普通润色覆盖的身份保持约束。 */
export function buildRealPersonIdentityPrompt(prompt: string, personName?: string): string {
  const identityLabel = String(personName || '').trim()
  const originalPrompt = String(prompt || '').trim()
  return [
    `【真人身份强约束${identityLabel ? `：${identityLabel}` : ''}】${REAL_PERSON_IDENTITY_INSTRUCTION}`,
    stripExistingConstraint(originalPrompt, REAL_PERSON_IDENTITY_PROMPT_MARKER, REAL_PERSON_IDENTITY_INSTRUCTION),
  ]
    .filter(Boolean)
    .join('；')
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
