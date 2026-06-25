/**
 * 「待归类」视频的归类记录(纯前端 localStorage 占位 —— 后端暂无"未归类/归类"概念)。
 * 记录哪些视频已被用户拖入具体项目,使其从「待归类」中隐藏。后端就绪后改为真实接口。
 */

const KEY = (workspaceId: number) => `zzh_classified_videos_${workspaceId}`

/** 视频的稳定标识:来源项目 id + 草稿里的视频 URL(签名会变,但草稿存的原始 URL 稳定) */
export function videoKeyOf(projectId: number, videoUrl: string): string {
  return `${projectId}::${String(videoUrl || '').trim()}`
}

export function loadClassifiedKeys(workspaceId: number): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(KEY(workspaceId))
    const arr = JSON.parse(raw || '[]')
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

export function markVideoClassified(workspaceId: number, videoKey: string): void {
  if (typeof window === 'undefined') return
  try {
    const set = loadClassifiedKeys(workspaceId)
    set.add(videoKey)
    window.localStorage.setItem(KEY(workspaceId), JSON.stringify([...set]))
  } catch {
    /* 忽略存储失败(隐私模式等) */
  }
}
