/** 等待视频定位到目标时间并确认对应画面已经完成解码，供 Canvas 安全截帧。 */

interface FrameCallbackMetadataLike {
  mediaTime?: number
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: DOMHighResTimeStamp, metadata: FrameCallbackMetadataLike) => void,
  ) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

export interface SeekVideoFrameOptions {
  signal?: AbortSignal
  seekTimeoutMs?: number
  frameTimeoutMs?: number
  frameTimeToleranceSec?: number
}

export interface CaptureVideoFrameFromUrlOptions extends SeekVideoFrameOptions {
  metadataTimeoutMs?: number
}

const abortError = () => {
  if (typeof DOMException === 'function') return new DOMException('视频截帧已取消', 'AbortError')
  const error = new Error('视频截帧已取消')
  error.name = 'AbortError'
  return error
}

/** 旧浏览器没有 requestVideoFrameCallback 时，seeked 后至少等待两次绘制机会。 */
const waitForTwoAnimationFrames = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    let firstFrame = 0
    let secondFrame = 0
    let settled = false

    const cleanup = () => {
      if (firstFrame) window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortError())
    }

    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    firstFrame = window.requestAnimationFrame(() => {
      firstFrame = 0
      secondFrame = window.requestAnimationFrame(finish)
    })
  })

/** 在不支持逐帧回调的浏览器中等待一次 seek 完成。 */
const seekWithoutFrameCallback = (
  video: HTMLVideoElement,
  targetTime: number,
  seekTimeoutMs: number,
  signal?: AbortSignal,
) =>
  new Promise<void>((resolve, reject) => {
    let timer = 0
    let settled = false

    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onSeeked = () => finish()
    const onAbort = () => fail(abortError())

    if (signal?.aborted) {
      onAbort()
      return
    }
    video.addEventListener('seeked', onSeeked)
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = window.setTimeout(() => fail(new Error('视频定位超时')), seekTimeoutMs)
    try {
      video.currentTime = targetTime
    } catch (error) {
      fail(error)
    }
  })

/**
 * 先登记逐帧回调、再修改 currentTime，并同时等待 seeked 与目标 mediaTime。
 * 这样不会把 seek 前已经排队的旧画面误当成目标画面写入时间轴。
 */
export async function seekVideoToDecodedFrame(
  video: HTMLVideoElement,
  targetTime: number,
  options: SeekVideoFrameOptions = {},
): Promise<void> {
  const target = Math.max(0, Number(targetTime) || 0)
  const signal = options.signal
  const seekTimeoutMs = Math.max(1, options.seekTimeoutMs ?? 5000)
  const frameTimeoutMs = Math.max(1, options.frameTimeoutMs ?? 1200)
  const tolerance = Math.max(0.01, options.frameTimeToleranceSec ?? 0.35)

  if (signal?.aborted) throw abortError()
  if (!video.seeking && Number.isFinite(video.currentTime) && Math.abs(video.currentTime - target) <= 0.001) {
    await waitForTwoAnimationFrames(signal)
    return
  }

  const frameVideo = video as FrameCallbackVideo
  const requestFrame = frameVideo.requestVideoFrameCallback
  if (typeof requestFrame !== 'function') {
    await seekWithoutFrameCallback(video, target, seekTimeoutMs, signal)
    await waitForTwoAnimationFrames(signal)
    return
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let seekCompleted = false
    let frameConfirmed = false
    let seekTimer = 0
    let frameTimer = 0
    let frameHandle: number | null = null

    const cleanup = () => {
      window.clearTimeout(seekTimer)
      window.clearTimeout(frameTimer)
      video.removeEventListener('seeked', onSeeked)
      signal?.removeEventListener('abort', onAbort)
      if (frameHandle !== null && typeof frameVideo.cancelVideoFrameCallback === 'function') {
        try {
          frameVideo.cancelVideoFrameCallback(frameHandle)
        } catch {
          // 部分旧浏览器在回调已经进入队列后取消会抛错，不影响资源清理。
        }
      }
      frameHandle = null
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const finishIfReady = () => {
      if (settled || !seekCompleted || !frameConfirmed) return
      settled = true
      cleanup()
      resolve()
    }
    const requestNextFrame = () => {
      if (settled || frameConfirmed) return
      try {
        frameHandle = requestFrame.call(frameVideo, (_now, metadata) => {
          frameHandle = null
          if (settled) return
          const mediaTime = Number(metadata?.mediaTime)
          if (Number.isFinite(mediaTime) && Math.abs(mediaTime - target) <= tolerance) {
            frameConfirmed = true
            finishIfReady()
            return
          }
          requestNextFrame()
        })
      } catch (error) {
        fail(error)
      }
    }
    const onSeeked = () => {
      seekCompleted = true
      window.clearTimeout(seekTimer)
      if (!frameConfirmed) {
        frameTimer = window.setTimeout(() => fail(new Error('目标视频帧解码超时')), frameTimeoutMs)
      }
      finishIfReady()
    }
    const onAbort = () => fail(abortError())

    video.addEventListener('seeked', onSeeked)
    signal?.addEventListener('abort', onAbort, { once: true })
    seekTimer = window.setTimeout(() => fail(new Error('视频定位超时')), seekTimeoutMs)

    // 必须在 currentTime 变化前登记；否则暂停视频可能已提交完目标帧，后注册的回调只能等到超时。
    requestNextFrame()
    try {
      video.currentTime = target
    } catch (error) {
      fail(error)
    }
  })
}

/** 截帧位置。首帧用来接续上一个镜头，尾帧用来给下一个镜头当起点。 */
export type VideoFramePosition = 'current' | 'first' | 'last'

/**
 * 末帧不能直接取 duration。
 * 正好落在结尾时多数浏览器不会解码出新帧，还会顺带触发 ended；
 * 往回退约一帧（按 20fps 算）既能拿到画面，视觉上仍是最后一帧。
 */
const LAST_FRAME_BACKOFF_SEC = 0.05

/**
 * 把 video 当前画面画进离屏 canvas，返回 JPEG dataURL。
 *
 * 画布素材走同源 /download，canvas 不会被污染；万一取到的是跨域直链导致污染，
 * toDataURL 会抛错，这里返回空串由调用方提示，而不是让异常冒到渲染层。
 */
export function captureVideoFrameDataUrl(video: HTMLVideoElement | null): string {
  if (!video) return ''
  const width = video.videoWidth
  const height = video.videoHeight
  if (!(width > 0) || !(height > 0)) return ''
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return ''
    context.drawImage(video, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    return ''
  }
}

/** 求某个截帧位置对应的时刻；时长未知时返回 null，交由调用方提示而不是画出一张黑图。 */
export function resolveFrameTimeSec(position: VideoFramePosition, durationSec: number): number | null {
  if (position === 'current') return null
  const duration = Number(durationSec)
  if (!Number.isFinite(duration) || duration <= 0) return null
  return position === 'first' ? 0 : Math.max(0, duration - LAST_FRAME_BACKOFF_SEC)
}

/**
 * 取指定位置的一帧。
 *
 * current 直接画当前画面；first/last 先定位过去、确认该帧已解码再画，
 * 画完把播放位置与播放状态还原——截帧是旁路动作，不该把用户正在看的位置带走。
 * 定位失败（超时/取消/时长未知）返回空串，由调用方提示。
 */
export async function captureVideoFrame(
  video: HTMLVideoElement | null,
  position: VideoFramePosition = 'current',
  options: SeekVideoFrameOptions = {},
): Promise<string> {
  if (!video) return ''
  const target = resolveFrameTimeSec(position, video.duration)
  if (target === null) return position === 'current' ? captureVideoFrameDataUrl(video) : ''

  const previousTime = Number(video.currentTime) || 0
  const wasPlaying = !video.paused
  if (wasPlaying) video.pause()

  try {
    await seekVideoToDecodedFrame(video, target, options)
    return captureVideoFrameDataUrl(video)
  } catch {
    return ''
  } finally {
    // 还原不该影响截帧结果：即便回不到原位置，已经拿到的那一帧照常返回
    try {
      await seekVideoToDecodedFrame(video, previousTime, options)
    } catch {
      /* 回不去就算了，用户可以自己拖回来 */
    }
    if (wasPlaying) {
      const played = video.play()
      if (played && typeof played.catch === 'function') played.catch(() => undefined)
    }
  }
}

/**
 * 从一个可跳转的视频地址创建临时播放器并截帧。
 *
 * 画布的 /download 源可能不支持 Range，直接在正在展示的播放器上跳到尾部会被抹回 0。
 * 调用方可先把源转换为本地 blob URL，再交给这里；临时播放器不会改动用户当前的播放位置。
 */
export async function captureVideoFrameFromUrl(
  sourceUrl: string,
  position: VideoFramePosition,
  options: CaptureVideoFrameFromUrlOptions = {},
): Promise<string> {
  const source = String(sourceUrl || '').trim()
  if (!source) return ''

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  const metadataTimeoutMs = Math.max(1, options.metadataTimeoutMs ?? 10000)
  try {
    await new Promise<void>((resolve, reject) => {
      let timer = 0
      let settled = false
      const signal = options.signal

      const cleanup = () => {
        window.clearTimeout(timer)
        video.removeEventListener('loadeddata', onReady)
        video.removeEventListener('error', onError)
        signal?.removeEventListener('abort', onAbort)
      }
      const finish = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const onReady = () => finish()
      const onError = () => fail(new Error('视频元数据加载失败'))
      const onAbort = () => fail(abortError())

      if (signal?.aborted) {
        onAbort()
        return
      }
      // 首帧恰好是 0 秒，只有 metadata 还不够：必须等第一帧真正解码，videoWidth 才可用于绘制。
      video.addEventListener('loadeddata', onReady)
      video.addEventListener('error', onError)
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = window.setTimeout(() => fail(new Error('视频元数据加载超时')), metadataTimeoutMs)
      video.src = source
      video.load()
      if (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        Number.isFinite(video.duration) &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      )
        finish()
    })
    return await captureVideoFrame(video, position, options)
  } catch {
    return ''
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
}
