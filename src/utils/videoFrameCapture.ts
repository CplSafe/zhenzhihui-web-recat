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
