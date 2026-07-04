/**
 * 草稿箱工具 — 生成视频后自动保存到 localStorage，项目管理页草稿箱直接读取。
 */
export interface DraftVideo {
  id: number
  title: string
  videoUrl: string
}

const DRAFT_KEY = 'zzh_draft_videos'

export function loadDraftVideos(): DraftVideo[] {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addToDraftBox(video: DraftVideo): void {
  const list = loadDraftVideos()
  // 去重：同 projectId + 同 videoUrl 不重复保存
  if (list.some((v) => v.id === video.id && v.videoUrl === video.videoUrl)) return
  list.unshift(video)
  localStorage.setItem(DRAFT_KEY, JSON.stringify(list))
}

export function removeFromDraftBox(video: { id: number; videoUrl: string }): void {
  const list = loadDraftVideos()
  const next = list.filter((v) => !(v.id === video.id && v.videoUrl === video.videoUrl))
  localStorage.setItem(DRAFT_KEY, JSON.stringify(next))
}
