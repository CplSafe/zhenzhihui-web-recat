/**
 * 抽取视频的缩略帧，拼成时间线上的胶片条。
 *
 * 片段在轨道上画成纯色块时，看不出这一段拍的是什么，只能靠序号认；
 * 铺上按时间均匀取样的几帧之后，扫一眼就知道哪段是哪段——这是剪辑器时间轴的常规做法。
 *
 * 抽帧要 seek + 解码，代价不低，因此按素材地址缓存，并对并发请求去重：
 * 同一条素材在多个时间线节点里出现时只解一次。
 */
import { acquireSeekableSource } from '@/utils/seekableMediaSource'
import { seekVideoToDecodedFrame } from '@/utils/videoFrameCapture'

/** 缩略帧的像素高度。轨道上只有几十像素高，取 72 足够清晰又不占内存。 */
const FRAME_HEIGHT_PX = 72
/** 单个片段默认抽几帧。太多会让解码时间线性增长，太少则拼不出「胶片」的感觉。 */
const DEFAULT_FRAME_COUNT = 6
/** 抽帧整体超时：坏素材不该让轨道一直空着。 */
const FILMSTRIP_TIMEOUT_MS = 15000

/**
 * 均匀取样的时间点。
 *
 * 取每段的中点而不是端点：端点常常是转场黑帧，取中点更能代表这一段的画面。
 */
export function filmstripFrameTimes(durationSec: number, count = DEFAULT_FRAME_COUNT): number[] {
  const duration = Number(durationSec)
  const total = Math.max(1, Math.floor(Number(count) || 0))
  if (!Number.isFinite(duration) || duration <= 0) return []
  return Array.from({ length: total }, (_, index) => (duration * (index + 0.5)) / total)
}

/** 缓存键：同一条素材、同样的帧数只解一次。 */
function cacheKey(url: string, count: number): string {
  return `${url}|${count}`
}

const filmstripCache = new Map<string, string[]>()
const filmstripInflight = new Map<string, Promise<string[]>>()

/** 仅供测试重置模块级缓存。 */
export function clearFilmstripCache(): void {
  filmstripCache.clear()
  filmstripInflight.clear()
}

/** 已缓存的胶片条；没有则返回 null，由调用方决定是否发起抽取。 */
export function getCachedFilmstrip(url: string, count = DEFAULT_FRAME_COUNT): string[] | null {
  return filmstripCache.get(cacheKey(url, count)) ?? null
}

function loadMetadata(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve()
      return
    }
    let timer = 0
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
    }
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('视频加载失败'))
    }
    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('error', onError)
    timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('视频加载超时'))
    }, timeoutMs)
  })
}

function drawFrame(video: HTMLVideoElement): string {
  const ratio = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9
  const canvas = document.createElement('canvas')
  canvas.height = FRAME_HEIGHT_PX
  canvas.width = Math.max(1, Math.round(FRAME_HEIGHT_PX * ratio))
  const context = canvas.getContext('2d')
  if (!context) return ''
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.72)
}

/**
 * 抽取一条素材的缩略帧。
 *
 * 用一个离屏 video 顺序 seek 取帧；任一帧失败就整体放弃并返回空数组，
 * 让调用方回落到纯色块，而不是画出一条缺口斑驳的胶片。
 */
export async function buildFilmstrip(url: string, count = DEFAULT_FRAME_COUNT): Promise<string[]> {
  const source = String(url || '')
  if (!source) return []
  const key = cacheKey(source, count)

  const cached = filmstripCache.get(key)
  if (cached) return cached
  const pending = filmstripInflight.get(key)
  if (pending) return pending

  const task = (async () => {
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    /*
     * 必须先换成可跳转的本地副本。
     *
     * 抽帧是「seek 到第 N 秒再截一张」，而 /download 不支持 Range——直接拿它当 src，
     * 每次 seek 都会被抹回 0，最后要么全是首帧要么整体超时返回空数组，胶片条永远是纯色块。
     * 走共用缓存，同一条素材与播放器那边只下载一次。
     */
    const handle = acquireSeekableSource(source)
    try {
      const { url } = await handle.ready
      // 同源 /download 地址，设置 crossOrigin 反而会因缺少 CORS 响应头而失败
      video.src = url
      await loadMetadata(video, FILMSTRIP_TIMEOUT_MS)
      const times = filmstripFrameTimes(video.duration, count)
      if (!times.length) return []
      const frames: string[] = []
      for (const time of times) {
        await seekVideoToDecodedFrame(video, time, { seekTimeoutMs: 5000, frameTimeoutMs: 2000 })
        const frame = drawFrame(video)
        if (!frame) return []
        frames.push(frame)
      }
      filmstripCache.set(key, frames)
      return frames
    } catch {
      return []
    } finally {
      video.removeAttribute('src')
      video.load()
      handle.release()
      filmstripInflight.delete(key)
    }
  })()

  filmstripInflight.set(key, task)
  return task
}
