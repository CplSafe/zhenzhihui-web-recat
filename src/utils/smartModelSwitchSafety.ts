import type { GenerationModelSelectionMap, GenerationOperationCode } from './generationModelCatalog'

export type SmartImageOperationCode = Extract<GenerationOperationCode, 'image.text_to_image' | 'image.image_to_image'>

export type SmartModelSwitchRecoveryPhase = 'script' | 'subjects' | 'shots'
export type SmartModelSwitchRecoveryStatus = 'checkpoint' | 'running' | 'failed'

/**
 * Persisted before model-switch regeneration starts.  It intentionally contains
 * only durable identifiers, so a refresh can explain (or safely resume) the
 * exact batch without guessing from the currently selected model.
 */
export interface SmartModelSwitchRecoveryDescriptor {
  version: 1
  id: string
  operationCode: GenerationOperationCode
  status: SmartModelSwitchRecoveryStatus
  phase: SmartModelSwitchRecoveryPhase
  workspaceId: number
  projectId: number
  fromModelId: number
  toModelId: number
  previousGenerationModels: GenerationModelSelectionMap
  nextGenerationModels: GenerationModelSelectionMap
  pendingSubjectNames: string[]
  pendingShotIds: Array<string | number>
  completedSubjectNames: string[]
  completedShotIds: Array<string | number>
  createdAt: number
  updatedAt: number
  error?: string
}

export interface SmartSubjectAssetVersionRegistry {
  versions?: string[]
  prompt?: string
  sources?: Record<string, 'ai' | 'upload' | 'manual'>
  ids?: Record<string, number>
  operations?: Record<string, SmartImageOperationCode>
  modelVersionIds?: Record<string, number>
}

export interface SmartShotImageVersion {
  url?: string
  assetId?: number
  refs?: string[]
  operationCode?: SmartImageOperationCode
  modelVersionId?: number
  dependsOnPrevious?: boolean
}

export interface SmartModelSwitchShotLike {
  id: string | number
  image?: string
  imageAssetId?: number
  imageOperationCode?: SmartImageOperationCode
  imageModelVersionId?: number
  imageVersions?: SmartShotImageVersion[]
  selectedRefs?: string[]
  subjects?: Array<{ tag?: string; image?: string; assetId?: number }>
}

export interface SmartImageModelRegenerationPlan {
  operationCode: SmartImageOperationCode
  subjectNames: string[]
  directShotIds: Array<string | number>
  shotIds: Array<string | number>
  dependencyShotIds: Array<string | number>
  firstAffectedShotIndex: number
  firstAffectedShotOperation: SmartImageOperationCode | null
  subjectTaskCount: number
  shotTaskCount: number
  totalTaskCount: number
}

const isSmartImageOperation = (value: unknown): value is SmartImageOperationCode =>
  value === 'image.text_to_image' || value === 'image.image_to_image'

const stripAt = (value: unknown): string =>
  String(value || '')
    .replace(/^@/, '')
    .trim()

const sameImage = (
  version: SmartShotImageVersion,
  shot: Pick<SmartModelSwitchShotLike, 'image' | 'imageAssetId'>,
): boolean => {
  const currentAssetId = Number(shot.imageAssetId || 0) || 0
  const versionAssetId = Number(version.assetId || 0) || 0
  if (currentAssetId > 0 && versionAssetId > 0) return currentAssetId === versionAssetId
  const currentUrl = String(shot.image || '').trim()
  const versionUrl = String(version.url || '').trim()
  return Boolean(currentUrl && versionUrl && currentUrl === versionUrl)
}

/** Resolve the operation that produced the currently selected shot image. */
export function resolveSmartShotImageOperation(shot: SmartModelSwitchShotLike, index: number): SmartImageOperationCode {
  if (isSmartImageOperation(shot.imageOperationCode)) return shot.imageOperationCode
  const versions = Array.isArray(shot.imageVersions) ? shot.imageVersions : []
  const currentVersion = versions.find((version) => sameImage(version, shot)) || versions[versions.length - 1]
  if (isSmartImageOperation(currentVersion?.operationCode)) return currentVersion.operationCode

  // Legacy drafts did not persist operationCode.  Explicit references are
  // authoritative; later automatically generated frames used the previous
  // frame as a continuity reference.
  const hasExplicitReference =
    Boolean(currentVersion?.refs?.length) ||
    Boolean(shot.selectedRefs?.length) ||
    Boolean(shot.subjects?.some((subject) => subject.image || Number(subject.assetId || 0) > 0))
  return hasExplicitReference || index > 0 ? 'image.image_to_image' : 'image.text_to_image'
}

function selectedSubjectImage(shots: SmartModelSwitchShotLike[], name: string): string {
  for (const shot of shots) {
    const subject = (shot.subjects || []).find((item) => stripAt(item.tag) === name)
    if (subject?.image) return subject.image
  }
  return ''
}

function currentAiSubjectVersion(
  shots: SmartModelSwitchShotLike[],
  name: string,
  asset: SmartSubjectAssetVersionRegistry,
): string {
  const selected = selectedSubjectImage(shots, name)
  if (selected) return asset.sources?.[selected] === 'ai' ? selected : ''
  return [...(asset.versions || [])].reverse().find((url) => asset.sources?.[url] === 'ai') || ''
}

/**
 * Determine the smallest paid image regeneration set for one switched image
 * operation.  Directly affected subjects/shots are regenerated, then only
 * already-existing downstream shot images are replayed for previous-frame
 * continuity.  Unaffected leading frames are never charged again.
 */
export function planSmartImageModelRegeneration(args: {
  operationCode: SmartImageOperationCode
  shots: SmartModelSwitchShotLike[]
  subjectAssets: Record<string, SmartSubjectAssetVersionRegistry>
  subjectHasReference: (name: string) => boolean
  subjectIsManual?: (name: string) => boolean
}): SmartImageModelRegenerationPlan {
  const shots = Array.isArray(args.shots) ? args.shots : []
  const subjectNames = Object.entries(args.subjectAssets || {})
    .filter(([name, asset]) => {
      if (args.subjectIsManual?.(name)) return false
      const url = currentAiSubjectVersion(shots, name, asset)
      if (!url) return false
      const persistedOperation = asset.operations?.[url]
      const operation = isSmartImageOperation(persistedOperation)
        ? persistedOperation
        : args.subjectHasReference(name)
          ? 'image.image_to_image'
          : 'image.text_to_image'
      return operation === args.operationCode
    })
    .map(([name]) => name)
  const affectedSubjects = new Set(subjectNames)

  const directIndexes: number[] = []
  shots.forEach((shot, index) => {
    const hasImage = Boolean(shot.image || Number(shot.imageAssetId || 0) > 0)
    if (!hasImage) return
    const directOperationMatch = resolveSmartShotImageOperation(shot, index) === args.operationCode
    const usesChangedSubject = (shot.subjects || []).some((subject) => affectedSubjects.has(stripAt(subject.tag)))
    if (directOperationMatch || usesChangedSubject) directIndexes.push(index)
  })

  const firstAffectedShotIndex = directIndexes.length ? Math.min(...directIndexes) : -1
  const lastExistingShotIndex = shots.reduce(
    (last, shot, index) => (shot.image || Number(shot.imageAssetId || 0) > 0 ? index : last),
    -1,
  )
  const directIndexSet = new Set(directIndexes)
  const selectedShotIndexes =
    firstAffectedShotIndex >= 0
      ? shots
          .map((shot, index) => ({ shot, index }))
          .filter(
            ({ shot, index }) =>
              index >= firstAffectedShotIndex &&
              index <= lastExistingShotIndex &&
              Boolean(shot.image || Number(shot.imageAssetId || 0) > 0),
          )
          .map(({ index }) => index)
      : []
  const shotIds = selectedShotIndexes.map((index) => shots[index].id)
  const directShotIds = selectedShotIndexes.filter((index) => directIndexSet.has(index)).map((index) => shots[index].id)
  const dependencyShotIds = selectedShotIndexes
    .filter((index) => !directIndexSet.has(index))
    .map((index) => shots[index].id)

  return {
    operationCode: args.operationCode,
    subjectNames,
    directShotIds,
    shotIds,
    dependencyShotIds,
    firstAffectedShotIndex,
    firstAffectedShotOperation:
      firstAffectedShotIndex >= 0
        ? resolveSmartShotImageOperation(shots[firstAffectedShotIndex], firstAffectedShotIndex)
        : null,
    subjectTaskCount: subjectNames.length,
    shotTaskCount: shotIds.length,
    totalTaskCount: subjectNames.length + shotIds.length,
  }
}

/**
 * Keep only user-provided subject versions that still exist in a newly
 * generated script and apply the last retained upload to matching subjects.
 */
export function mergeTransactionalScriptResult<TShot extends SmartModelSwitchShotLike>(args: {
  nextShots: TShot[]
  previousShots: SmartModelSwitchShotLike[]
  subjectAssets: Record<string, SmartSubjectAssetVersionRegistry>
}): {
  shots: TShot[]
  subjectAssets: Record<string, SmartSubjectAssetVersionRegistry>
} {
  const validNames = new Set(
    args.nextShots.flatMap((shot) => (shot.subjects || []).map((subject) => stripAt(subject.tag)).filter(Boolean)),
  )
  const retained: Record<string, SmartSubjectAssetVersionRegistry> = {}
  const selectedByName = new Map<string, { url: string; assetId: number }>()

  for (const [name, asset] of Object.entries(args.subjectAssets || {})) {
    if (!validNames.has(name)) continue
    const versions = (asset.versions || []).filter((url) => {
      const source = asset.sources?.[url]
      return source === 'upload' || source === 'manual'
    })
    if (!versions.length) continue
    const versionSet = new Set(versions)
    const filterRecord = <TValue>(record?: Record<string, TValue>): Record<string, TValue> => {
      const next: Record<string, TValue> = {}
      for (const [url, value] of Object.entries(record || {})) if (versionSet.has(url)) next[url] = value
      return next
    }
    const previousSelected = selectedSubjectImage(args.previousShots, name)
    const selectedUrl = versionSet.has(previousSelected) ? previousSelected : versions[versions.length - 1]
    retained[name] = {
      ...asset,
      versions,
      sources: filterRecord(asset.sources),
      ids: filterRecord(asset.ids),
      operations: filterRecord(asset.operations),
      modelVersionIds: filterRecord(asset.modelVersionIds),
    }
    selectedByName.set(name, {
      url: selectedUrl,
      assetId: Number(asset.ids?.[selectedUrl] || 0) || 0,
    })
  }

  const shots = args.nextShots.map((shot) => ({
    ...shot,
    subjects: (shot.subjects || []).map((subject) => {
      const retainedVersion = selectedByName.get(stripAt(subject.tag))
      return retainedVersion ? { ...subject, image: retainedVersion.url, assetId: retainedVersion.assetId } : subject
    }),
  }))
  return { shots, subjectAssets: retained }
}
