/** 编辑器恢复项目成片时使用的稳定版本信息。 */
export interface SmartVideoVersion {
  url: string
  assetId: number
  createdAt?: string
  id?: string
}

/** 项目管理通过路由传给对应编辑器的视频选择。 */
export interface RequestedProjectVideoSelection {
  videoId: string
  assetId: number
  /** 只允许来自 history state，避免把临时签名 URL 暴露到地址栏。 */
  url: string
}

/** 忽略签名参数和媒体片段，比较同一个资源的不同临时 URL。 */
export function stableMediaUrlKey(value: unknown): string {
  return String(value || '')
    .trim()
    .split('#', 1)[0]
    .split('?', 1)[0]
    .replace(/\/+$/, '')
}

/** 从 query 和兼容的 history state 中读取稳定视频标识。 */
export function readRequestedProjectVideoSelection(search: string, state: any): RequestedProjectVideoSelection | null {
  const params = new URLSearchParams(String(search || ''))
  const nested = state?.projectVideoSelection || state?.selectedProjectVideo || state?.videoSelection || {}
  const videoId = String(
    params.get('video_id') || nested?.videoId || nested?.video_id || state?.videoId || state?.video_id || '',
  ).trim()
  const assetId =
    Number(
      params.get('video_asset_id') ||
        nested?.assetId ||
        nested?.asset_id ||
        nested?.videoAssetId ||
        nested?.video_asset_id ||
        state?.videoAssetId ||
        state?.video_asset_id ||
        0,
    ) || 0
  const url = String(nested?.url || nested?.videoUrl || nested?.video_url || '').trim()
  return videoId || assetId > 0 || url ? { videoId, assetId, url } : null
}

/** 按 assetId/URL 去重合并视频版本，并保留首个来源的顺序和稳定元数据。 */
export function mergeVideoVersionLists(
  ...groups: Array<Array<SmartVideoVersion | null | undefined> | null | undefined>
): SmartVideoVersion[] {
  const seen = new Set<string>()
  const merged: SmartVideoVersion[] = []
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const url = String(item?.url || '').trim()
      const assetId = Number(item?.assetId || 0) || 0
      if (!url && !assetId) continue
      const key = assetId > 0 ? `a:${assetId}` : `u:${stableMediaUrlKey(url)}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({
        url,
        assetId,
        ...(item?.createdAt ? { createdAt: item.createdAt } : {}),
        ...(item?.id ? { id: item.id } : {}),
      })
    }
  }
  return merged
}

/**
 * 让主播放器与历史列表使用同一条记录：显式路由选择优先，其次草稿当前值，最后最新版本。
 * 只有 assetId 的记录也保留，后续可按 assetId 重新取得播放 URL。
 */
export function resolveRestoredVideoSelection(
  current: SmartVideoVersion,
  versions: SmartVideoVersion[],
  requested: RequestedProjectVideoSelection | null,
): { current: SmartVideoVersion; versions: SmartVideoVersion[] } {
  const requestedRaw: any = requested?.videoId
    ? versions.find((version: any) =>
        [version?.id, version?.videoId, version?.video_id, version?.generationId, version?.generation_id]
          .map((value) => String(value || '').trim())
          .includes(requested.videoId),
      )
    : null
  const effectiveRequested = requested
    ? {
        ...requested,
        assetId: Number(requested.assetId || requestedRaw?.assetId || requestedRaw?.asset_id || 0) || 0,
        url: String(requested.url || requestedRaw?.url || requestedRaw?.src || '').trim(),
      }
    : null
  let merged = mergeVideoVersionLists(versions, [current])
  const requestedUrlKey = stableMediaUrlKey(effectiveRequested?.url)
  let selected = effectiveRequested
    ? merged.find((version: any) => {
        if (effectiveRequested.assetId > 0 && Number(version.assetId || 0) === effectiveRequested.assetId) return true
        if (
          effectiveRequested.videoId &&
          [version.id, version.videoId, version.video_id, version.generationId, version.generation_id]
            .map((value) => String(value || '').trim())
            .includes(effectiveRequested.videoId)
        ) {
          return true
        }
        return Boolean(requestedUrlKey && stableMediaUrlKey(version.url) === requestedUrlKey)
      })
    : undefined

  if (!selected && effectiveRequested && (effectiveRequested.assetId > 0 || effectiveRequested.url)) {
    const requestedVersion = { url: effectiveRequested.url, assetId: effectiveRequested.assetId }
    merged = mergeVideoVersionLists(merged, [requestedVersion])
    selected = merged.find((version) =>
      effectiveRequested.assetId > 0
        ? Number(version.assetId || 0) === effectiveRequested.assetId
        : stableMediaUrlKey(version.url) === requestedUrlKey,
    )
  }

  if (!selected) {
    const currentUrlKey = stableMediaUrlKey(current.url)
    selected = merged.find((version) =>
      current.assetId > 0
        ? Number(version.assetId || 0) === Number(current.assetId || 0)
        : Boolean(currentUrlKey && stableMediaUrlKey(version.url) === currentUrlKey),
    )
  }
  selected = selected || merged[merged.length - 1] || { url: '', assetId: 0 }
  return {
    current: { url: String(selected.url || ''), assetId: Number(selected.assetId || 0) || 0 },
    versions: merged,
  }
}
