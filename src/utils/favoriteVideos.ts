/**
 * 收藏的视频(纯前端 localStorage 占位 —— 后端暂无"收藏"概念)。
 * 模板库里点爱心收藏的视频存这里,素材市场「我收藏的」从这里读取展示。
 */
export interface FavoriteVideo {
  key: string
  title: string
  videoUrl: string
  thumbnailUrl: string
  ratio: string
  ts: number
}

const KEY = (workspaceId: number) => `zzh_favorite_videos_${workspaceId}`

/** 视频的稳定标识:assetId 优先,否则用视频 URL */
export function favoriteKeyOf(videoAssetId: number, videoUrl: string): string {
  return videoAssetId ? `a${videoAssetId}` : `u${String(videoUrl || '').trim()}`
}

export function loadFavorites(workspaceId: number): FavoriteVideo[] {
  if (typeof window === 'undefined') return []
  try {
    const arr = JSON.parse(window.localStorage.getItem(KEY(workspaceId)) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveFavorites(workspaceId: number, list: FavoriteVideo[]): void {
  try {
    window.localStorage.setItem(KEY(workspaceId), JSON.stringify(list))
  } catch {
    /* 忽略存储失败(隐私模式等) */
  }
}

export function loadFavoriteKeys(workspaceId: number): Set<string> {
  return new Set(loadFavorites(workspaceId).map((f) => f.key))
}

/** 切换收藏状态,返回切换后的状态(true = 已收藏) */
export function toggleFavorite(workspaceId: number, item: FavoriteVideo): boolean {
  const list = loadFavorites(workspaceId)
  const idx = list.findIndex((f) => f.key === item.key)
  if (idx >= 0) {
    list.splice(idx, 1)
    saveFavorites(workspaceId, list)
    return false
  }
  list.unshift(item)
  saveFavorites(workspaceId, list)
  return true
}
