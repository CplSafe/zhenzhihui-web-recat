import { snapTimelineTime } from './timelineClips'

/** 同步音轨移动只改变起始位置；保留裁剪、音量和源素材。 */
export function resolveAudioTrackStart(value: number, duration: number, points: number[] = [], threshold = 0): number {
  const max = Math.max(0, duration - 0.1)
  const bounded = Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0))
  return Math.round(Math.max(0, Math.min(max, snapTimelineTime(bounded, points, threshold))) * 100) / 100
}
