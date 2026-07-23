/**
 * 收藏的视频(纯前端 localStorage 占位 —— 后端暂无"收藏"概念)。
 * 案例库里点爱心收藏的视频存这里,素材市场「我收藏的」从这里读取展示。
 */
import { readJson, writeJson } from '@/utils/storage'
import { sanitizePersistentMediaUrl } from '@/utils/persistentMediaUrl'

/** 收藏视频在本地存储中的稳定结构。 */
export interface FavoriteVideo {
  key: string
  title: string
  /** 可稳定换取当前工作空间下载地址的资产 ID；旧收藏可从 `key` 兼容恢复。 */
  videoAssetId?: number
  videoUrl: string
  thumbnailUrl: string
  ratio: string
  ts: number
}

/** 当前登录用户作用域，确保同一浏览器的不同账号互不读取收藏。 */
let favoriteUserScope = ''

/**
 * 收藏属于用户而不是工作空间。会话层在账号变化时同步此 scope，
 * 避免同一浏览器内两个团队成员互相看到对方的「我收藏的」。
 */
export function setFavoriteVideoUserScope(userId: unknown): void {
  favoriteUserScope = String(userId || '').trim()
}

/** 将工作区 ID 规范化为可用于存储键的整数。 */
const normalizedWorkspaceId = (workspaceId: number) => Math.floor(Number(workspaceId) || 0)
/** 旧版本仅按工作区隔离的存储键，用于一次性兼容迁移。 */
const legacyKeyOf = (workspaceId: number) => `zzh_favorite_videos_${normalizedWorkspaceId(workspaceId)}`
/** 新版按用户和工作区双重隔离的收藏存储键。 */
const scopedKeyOf = (workspaceId: number, userScope = favoriteUserScope) =>
  `zzh_favorite_videos_v2_u${encodeURIComponent(userScope || 'anon')}_ws${normalizedWorkspaceId(workspaceId)}`

/** 视频的稳定标识:assetId 优先,否则用视频 URL */
export function favoriteKeyOf(videoAssetId: number, videoUrl: string): string {
  return videoAssetId ? `a${videoAssetId}` : `u${String(videoUrl || '').trim()}`
}

/** 兼容读取旧收藏：历史数据未保存 videoAssetId，但 asset 收藏的 key 中已经包含它。 */
export function favoriteVideoAssetIdOf(item: Pick<FavoriteVideo, 'key' | 'videoAssetId'>): number {
  const explicitId = Number(item?.videoAssetId || 0)
  if (Number.isSafeInteger(explicitId) && explicitId > 0) return explicitId

  const match = /^a([1-9]\d*)$/.exec(String(item?.key || '').trim())
  if (!match) return 0
  const keyId = Number(match[1])
  return Number.isSafeInteger(keyId) && keyId > 0 ? keyId : 0
}

/** 清洗单条收藏数据，并将可恢复的素材 ID 转为当前工作区地址。 */
function normalizeFavorite(item: FavoriteVideo, workspaceId: number): FavoriteVideo | null {
  const videoAssetId = favoriteVideoAssetIdOf(item)
  const videoUrl = sanitizePersistentMediaUrl(item?.videoUrl, {
    assetId: videoAssetId,
    workspaceId,
  })
  if (!videoAssetId && !videoUrl) return null
  const thumbnailUrl = sanitizePersistentMediaUrl(item?.thumbnailUrl)
  return {
    ...item,
    key: videoAssetId ? `a${videoAssetId}` : favoriteKeyOf(0, videoUrl),
    ...(videoAssetId ? { videoAssetId } : {}),
    videoUrl,
    thumbnailUrl,
  }
}

/** 读取当前用户在指定工作区的收藏，并兼容迁移旧键数据。 */
export function loadFavorites(workspaceId: number): FavoriteVideo[] {
  const ws = normalizedWorkspaceId(workspaceId)
  if (!ws) return []

  const scopedKey = scopedKeyOf(ws)
  let arr = readJson<FavoriteVideo[] | null>(scopedKey, null)
  if (!Array.isArray(arr)) {
    // 旧键只有 workspace，没有所属用户。认证账号绝不能自动继承这份
    // 无法确认归属的数据；仅匿名会话可迁移到自己的 anon scope。
    if (favoriteUserScope) return []
    const legacy = readJson<FavoriteVideo[] | null>(legacyKeyOf(ws), null)
    if (!Array.isArray(legacy)) return []
    arr = legacy
    writeJson(scopedKey, legacy)
    try {
      window.localStorage?.removeItem(legacyKeyOf(ws))
    } catch {
      /* 忽略存储失败 */
    }
  }
  if (!Array.isArray(arr)) return []
  const normalized = arr
    .map((item) => normalizeFavorite(item, ws))
    .filter((item): item is FavoriteVideo => Boolean(item))
  if (JSON.stringify(normalized) !== JSON.stringify(arr)) {
    saveFavorites(workspaceId, normalized)
  }
  return normalized
}

/** 清洗后写入当前用户作用域，避免持久化临时或危险媒体地址。 */
function saveFavorites(workspaceId: number, list: FavoriteVideo[]): void {
  const ws = normalizedWorkspaceId(workspaceId)
  if (!ws) return
  writeJson(scopedKeyOf(ws), list)
}

/** 返回收藏视频的稳定键集合，供列表快速判断收藏态。 */
export function loadFavoriteKeys(workspaceId: number): Set<string> {
  return new Set(loadFavorites(workspaceId).map((f) => f.key))
}

/** 切换收藏状态,返回切换后的状态(true = 已收藏) */
export function toggleFavorite(workspaceId: number, item: FavoriteVideo): boolean {
  const list = loadFavorites(workspaceId)
  const normalized = normalizeFavorite(item, normalizedWorkspaceId(workspaceId))
  if (!normalized) return false
  const idx = list.findIndex((f) => f.key === normalized.key)
  if (idx >= 0) {
    list.splice(idx, 1)
    saveFavorites(workspaceId, list)
    return false
  }
  // 即使调用方仍是旧签名，也会从稳定 key 恢复并持久化 assetId。
  list.unshift(normalized)
  saveFavorites(workspaceId, list)
  return true
}
