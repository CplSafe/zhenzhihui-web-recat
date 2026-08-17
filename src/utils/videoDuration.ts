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
