/**
 * 读取视频真实时长(秒)—— 用隐藏 <video> 加载元数据取 duration。
 * 用于提交前预估积分 / 计费:含输入视频的任务(video.edit / video.replicate / 爆款做同款)
 * 按源视频真实时长计费(source_video_duration),优先于固定 duration。
 * 读不到(跨域无元数据 / 解码失败 / 超时)返回 0,调用方回退到默认 duration。
 */
export function readVideoDurationSec(url: string, timeoutMs = 8000): Promise<number> {
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
      resolve(Number.isFinite(sec) && sec > 0 ? Math.round(sec) : 0)
    }
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => finish(v.duration)
    v.onerror = () => finish(0)
    window.setTimeout(() => finish(v.duration || 0), timeoutMs)
    v.src = url
  })
}
