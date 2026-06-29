/**
 * 「待归类」视频的归类记录(纯前端 localStorage 占位 —— 后端暂无"未归类/归类"概念)。
 * 记录哪些视频已被用户拖入具体项目,使其从「待归类」中隐藏。后端就绪后改为真实接口。
 */

import { readJson, writeJson } from '@/utils/storage'

const KEY = (workspaceId: number) => `zzh_classified_videos_${workspaceId}`

/** 视频的稳定标识:来源项目 id + 草稿里的视频 URL(签名会变,但草稿存的原始 URL 稳定) */
export function videoKeyOf(projectId: number, videoUrl: string): string {
  return `${projectId}::${String(videoUrl || '').trim()}`
}

export function loadClassifiedKeys(workspaceId: number): Set<string> {
  const arr = readJson<unknown[]>(KEY(workspaceId), [])
  return new Set(Array.isArray(arr) ? arr.map(String) : [])
}

export function markVideoClassified(workspaceId: number, videoKey: string): void {
  const set = loadClassifiedKeys(workspaceId)
  set.add(videoKey)
  writeJson(KEY(workspaceId), [...set])
}
