/**
 * 爆款复制云端草稿清洗：把媒体引用收敛为素材 ID 或可长期使用的安全地址。
 * 每次合并最新草稿后再次执行，防止并发回调把过期签名或临时 URL 带回云端。
 */
import { sanitizeHotCopyEntryInitial } from '@/utils/hotCopyDraft'
import { sanitizeTelemetryText } from '@/utils/observabilitySanitizer'
import { sanitizePersistentMediaUrl, sanitizePersistentProjectVideoStore } from '@/utils/persistentMediaUrl'

/** 清洗单条媒体记录，并优先保留能够重新换取地址的素材 ID。 */
function sanitizeMediaRecord(value: any, workspaceId: number): any | null {
  if (!value || typeof value !== 'object') return null
  const assetId = Number(value.assetId ?? value.asset_id ?? value.videoAssetId ?? 0) || 0
  const rawUrl = value.url ?? value.videoUrl ?? ''
  const url = sanitizePersistentMediaUrl(rawUrl, { assetId, workspaceId })
  if (!assetId && !url) return null
  const next = { ...value }
  delete next.videoUrl
  return { ...next, assetId, url }
}

/** 在云端 PUT 前统一清洗全部媒体引用；合并最新草稿后也必须执行，以阻止旧数据带回过期地址。 */
export function sanitizeHotCopyPersistentDraft(value: any, workspaceId: number): any {
  const draft = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
  if (Object.prototype.hasOwnProperty.call(draft, 'projectVideoStore')) {
    draft.projectVideoStore = sanitizePersistentProjectVideoStore(draft.projectVideoStore, workspaceId)
  }
  const generatedAssetId = Number(draft.generatedVideoAssetId || 0) || 0
  draft.generatedVideoUrl = sanitizePersistentMediaUrl(draft.generatedVideoUrl, {
    assetId: generatedAssetId,
    workspaceId,
  })
  if (Array.isArray(draft.videoHistoryList)) {
    draft.videoHistoryList = draft.videoHistoryList
      .map((item: any) => sanitizeMediaRecord(item, workspaceId))
      .filter(Boolean)
  }

  const smartSource = draft.smart && typeof draft.smart === 'object' ? draft.smart : null
  if (!smartSource) return draft
  const smart = { ...smartSource }
  const sourceVideo = sanitizeMediaRecord(smart.sourceVideo, workspaceId)
  smart.sourceVideo = sourceVideo || { assetId: 0, url: '' }
  const fullVideoAssetId = Number(smart.fullVideoAssetId || 0) || 0
  smart.fullVideoUrl = sanitizePersistentMediaUrl(smart.fullVideoUrl, {
    assetId: fullVideoAssetId,
    workspaceId,
  })
  if (Array.isArray(smart.videoVersions)) {
    smart.videoVersions = smart.videoVersions.map((item: any) => sanitizeMediaRecord(item, workspaceId)).filter(Boolean)
  }
  if (smart.entryInitial && typeof smart.entryInitial === 'object') {
    smart.entryInitial = sanitizeHotCopyEntryInitial(smart.entryInitial, workspaceId)
  }
  if (Array.isArray(smart.videoGenerations)) {
    smart.videoGenerations = smart.videoGenerations.map((generation: any) => ({
      ...generation,
      ...(generation?.error
        ? { error: sanitizeTelemetryText(String(generation.error)).slice(0, 500) }
        : { error: undefined }),
    }))
  }
  draft.smart = smart
  return draft
}
