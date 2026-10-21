export interface VoiceSampleEntry {
  assetId: number
  title: string
  lastUsedAt: number
}

function storageKey(userId: string, workspaceId: number): string {
  if (!userId.trim() || !Number.isSafeInteger(workspaceId) || workspaceId <= 0)
    throw new Error('请登录并选择工作空间后使用声音样本库')
  return `zzh:voice-samples:${encodeURIComponent(userId)}:${workspaceId}`
}

export function readVoiceLibrary(userId: string, workspaceId: number): VoiceSampleEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(userId, workspaceId)) || '[]')
    if (!Array.isArray(raw)) return []
    const unique = new Map<number, VoiceSampleEntry>()
    for (const item of raw) {
      if (!Number.isSafeInteger(item?.assetId) || item.assetId <= 0) continue
      unique.set(item.assetId, {
        assetId: item.assetId,
        title: String(item.title || '声音样本').slice(0, 60),
        lastUsedAt: Number.isFinite(item.lastUsedAt) ? item.lastUsedAt : 0,
      })
    }
    return [...unique.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 100)
  } catch {
    return []
  }
}

export function saveVoiceSample(userId: string, workspaceId: number, assetId: number, title: string): void {
  if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error('声音样本尚未入库')
  const entries = readVoiceLibrary(userId, workspaceId).filter((item) => item.assetId !== assetId)
  entries.unshift({ assetId, title: title.trim().slice(0, 60) || '声音样本', lastUsedAt: Date.now() })
  localStorage.setItem(storageKey(userId, workspaceId), JSON.stringify(entries.slice(0, 100)))
}

export function removeVoiceSample(userId: string, workspaceId: number, assetId: number): void {
  localStorage.setItem(
    storageKey(userId, workspaceId),
    JSON.stringify(readVoiceLibrary(userId, workspaceId).filter((item) => item.assetId !== assetId)),
  )
}

export function renameVoiceSample(userId: string, workspaceId: number, assetId: number, title: string): void {
  const entries = readVoiceLibrary(userId, workspaceId)
  const entry = entries.find((item) => item.assetId === assetId)
  if (!entry) throw new Error('样本收藏不存在，请重新打开样本库')
  entry.title = title.trim().slice(0, 60) || '声音样本'
  localStorage.setItem(storageKey(userId, workspaceId), JSON.stringify(entries))
}
