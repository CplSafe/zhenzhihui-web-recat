/**
 * 读取视频真实时长(秒)—— 用隐藏 <video> 加载元数据取 duration。
 * 用于提交前预估积分 / 计费:含输入视频的任务(video.edit / video.replicate / 爆款做同款)
 * 按源视频真实时长计费(source_video_duration),优先于固定 duration。
 * 读不到(跨域无元数据 / 解码失败 / 超时)返回 0,调用方回退到默认 duration。
 */
/**
 * 将秒数格式化为视频角标时长(mm:ss)。
 * 读不到时长(0 / NaN / Infinity)返回空串,调用方据此不渲染角标。
 */
export function formatVideoDurationLabel(seconds: number): string {
  const total = Math.round(Number(seconds) || 0)
  if (!Number.isFinite(total) || total <= 0) return ''
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/**
 * 将播放进度秒数格式化为 mm:ss。
 * 与时长角标不同:向下取整(播到 4.9s 仍显示 00:04,不会提前跳到总时长),
 * 非法值按 0 处理,始终返回可展示文本。
 */
export function formatVideoTimeLabel(seconds: number): string {
  const raw = Number(seconds)
  const total = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/**
 * 读取未取整的真实时长(秒)。
 *
 * 剪辑时间线要用它:按秒取整会把 5.4 秒的片子当成 5 秒,末尾 0.4 秒直接丢掉。
 * 计费场景仍用 readVideoDurationSec(整秒),两者共用同一段加载逻辑。
 */
export function readVideoDurationSecExact(url: string, timeoutMs = 8000): Promise<number> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(0)
      return
    }
    const v = document.createElement('video')
    let done = false
    const finish = (sec: number) => {
      if (done) return
      done = true
      v.removeAttribute('src')
      v.load()
      resolve(Number.isFinite(sec) && sec > 0 ? sec : 0)
    }
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => finish(v.duration)
    v.onerror = () => finish(0)
    window.setTimeout(() => finish(v.duration || 0), timeoutMs)
    v.src = url
  })
}

export async function readVideoDurationSec(url: string, timeoutMs = 8000): Promise<number> {
  const seconds = await readVideoDurationSecExact(url, timeoutMs)
  return seconds > 0 ? Math.round(seconds) : 0
}

export interface VideoMetadata {
  durationSec: number
  width: number
  height: number
}

/** 读取视频真实时长与像素尺寸；读取失败时返回全零，调用方可安全回退草稿参数。 */
export function readVideoMetadata(url: string, timeoutMs = 8000): Promise<VideoMetadata> {
  return new Promise((resolve) => {
    if (!url) return resolve({ durationSec: 0, width: 0, height: 0 })
    const video = document.createElement('video')
    let done = false
    const finish = () => {
      if (done) return
      done = true
      const durationSec = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
      const width = Number.isFinite(video.videoWidth) && video.videoWidth > 0 ? video.videoWidth : 0
      const height = Number.isFinite(video.videoHeight) && video.videoHeight > 0 ? video.videoHeight : 0
      video.removeAttribute('src')
      video.load()
      resolve({ durationSec, width, height })
    }
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = finish
    video.onerror = finish
    window.setTimeout(finish, timeoutMs)
    video.src = url
  })
}

/** 按视频短边推导模型常用的分辨率档位。 */
export function videoResolutionFromDimensions(width: number, height: number): string {
  const shortEdge = Math.min(Number(width) || 0, Number(height) || 0)
  if (shortEdge >= 2160) return '4k'
  if (shortEdge >= 1080) return '1080p'
  if (shortEdge >= 768) return '768p'
  if (shortEdge >= 720) return '720p'
  return shortEdge > 0 ? `${Math.round(shortEdge)}p` : ''
}

/** 判断输出视频是否在任一像素维度上低于原片；缺少尺寸时不误判。 */
export function isVideoResolutionLower(source: VideoMetadata, output: VideoMetadata): boolean {
  if (source.width <= 0 || source.height <= 0 || output.width <= 0 || output.height <= 0) return false
  return output.width < source.width || output.height < source.height
}
