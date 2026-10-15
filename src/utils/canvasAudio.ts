/** 音频只持久化素材 ID、编辑参数和来源；播放地址运行时解析。 */
export type AudioLane = 'voice' | 'bgm' | 'sfx'
export interface AudioSettings {
  lane: AudioLane
  durationSec: number
  inSec: number
  outSec: number
  startSec: number
  volume: number
  muted: boolean
  loop: boolean
  fadeInSec: number
  fadeOutSec: number
  origin: 'upload' | 'generated' | 'licensed' | 'unknown'
}
export interface TimelineAudioClip extends AudioSettings {
  sourceNodeId: string
  assetId: number
  title: string
}
const finite = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
export function normalizeAudioSettings(value: unknown): AudioSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<AudioSettings>
  const durationSec = Math.max(0, finite(v.durationSec))
  const inSec = Math.min(durationSec, Math.max(0, finite(v.inSec)))
  const outSec = Math.min(durationSec, Math.max(inSec, finite(v.outSec, durationSec)))
  const lane = v.lane === 'bgm' || v.lane === 'sfx' ? v.lane : 'voice'
  return {
    lane,
    durationSec,
    inSec,
    outSec,
    startSec: Math.max(0, finite(v.startSec)),
    volume: Math.max(0, Math.min(1, finite(v.volume, lane === 'bgm' ? 0.3 : 1))),
    muted: v.muted === true,
    loop: lane === 'bgm' && v.loop !== false,
    fadeInSec: Math.max(0, finite(v.fadeInSec)),
    fadeOutSec: Math.max(0, finite(v.fadeOutSec)),
    origin: ['upload', 'generated', 'licensed'].includes(String(v.origin)) ? v.origin! : 'unknown',
  }
}
export function parseTimelineAudio(value: unknown): TimelineAudioClip[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const v = raw as TimelineAudioClip
    if (!Number.isSafeInteger(v.assetId) || v.assetId <= 0 || !v.sourceNodeId) return []
    return [
      {
        ...normalizeAudioSettings(v),
        assetId: v.assetId,
        sourceNodeId: String(v.sourceNodeId),
        title: String(v.title || '音频'),
      },
    ]
  })
}
/** 保留混音台自己的编辑；同一源素材换成新资产时才更新裁剪元数据。 */
export function syncTimelineAudio(current: TimelineAudioClip[], sources: TimelineAudioClip[]): TimelineAudioClip[] {
  return sources.map((source) => {
    const old = current.find((clip) => clip.sourceNodeId === source.sourceNodeId && clip.assetId === source.assetId)
    return old
      ? {
          ...old,
          title: source.title,
          ...(old.durationSec <= 0 && source.durationSec > 0
            ? { durationSec: source.durationSec, inSec: source.inSec, outSec: source.outSec }
            : {}),
        }
      : source
  })
}
export function audioGainAt(clip: AudioSettings, elapsed: number, outputDuration: number): number {
  const available = Math.max(0, clip.outSec - clip.inSec)
  const end = clip.loop ? outputDuration : Math.min(outputDuration, available)
  if (clip.muted || elapsed < 0 || elapsed >= end || available <= 0) return 0
  const fadeIn = clip.fadeInSec > 0 ? Math.min(1, elapsed / clip.fadeInSec) : 1
  const fadeOut = clip.fadeOutSec > 0 ? Math.min(1, (end - elapsed) / clip.fadeOutSec) : 1
  return clip.volume * Math.max(0, Math.min(fadeIn, fadeOut))
}
export function isAudioFile(file: Pick<File, 'name' | 'type'>): boolean {
  return /^audio\//i.test(file.type) || /\.(mp3|wav|m4a|aac)$/i.test(file.name)
}
export async function readAudioDuration(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio')
    const finish = (error?: Error) => {
      clearTimeout(timer)
      audio.onloadedmetadata = null
      audio.onerror = null
      const duration = audio.duration
      audio.removeAttribute('src')
      audio.load()
      if (error || !Number.isFinite(duration) || duration <= 0) reject(error || new Error('无法读取音频时长'))
      else resolve(duration)
    }
    const timer = setTimeout(() => finish(new Error('读取音频超时')), 15000)
    audio.onloadedmetadata = () => finish()
    audio.onerror = () => finish(new Error('无法解码此音频，请使用 MP3、WAV、M4A 或 AAC'))
    audio.preload = 'metadata'
    audio.src = src
  })
}
