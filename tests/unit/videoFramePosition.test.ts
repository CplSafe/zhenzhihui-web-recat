import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureVideoFrame, captureVideoFrameDataUrl, resolveFrameTimeSec } from '@/utils/videoFrameCapture'

/**
 * 首帧 / 当前帧 / 尾帧的截取行为。
 *
 * seekVideoToDecodedFrame 自身的逐帧回调时序在 videoFrameCapture.test.ts 里覆盖，
 * 这里只关心「定位到哪一时刻、画完有没有还原、播放状态有没有保住」。
 */
function fakeVideo(options: { duration?: number; currentTime?: number; paused?: boolean } = {}) {
  const listeners = new Map<string, Set<() => void>>()
  let time = options.currentTime ?? 3
  const video = {
    duration: options.duration ?? 10,
    paused: options.paused ?? true,
    seeking: false,
    videoWidth: 1920,
    videoHeight: 1080,
    /** 每次 seek 的目标时刻，按顺序记录 */
    seeks: [] as number[],
    playCalls: 0,
    pauseCalls: 0,
    addEventListener(type: string, handler: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(handler)
    },
    removeEventListener(type: string, handler: () => void) {
      listeners.get(type)?.delete(handler)
    },
    play() {
      video.playCalls += 1
      return Promise.resolve()
    },
    pause() {
      video.pauseCalls += 1
      video.paused = true
    },
  }

  // 写 currentTime 即视作一次 seek，并异步派发 seeked（真实浏览器也是异步的）
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => time,
    set: (next: number) => {
      time = next
      video.seeks.push(next)
      queueMicrotask(() => listeners.get('seeked')?.forEach((handler) => handler()))
    },
  })

  return video as unknown as HTMLVideoElement & { seeks: number[]; playCalls: number; pauseCalls: number }
}

beforeEach(() => {
  // 不提供 requestVideoFrameCallback，走 seeked + 两帧 rAF 的兜底路径
  vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }) as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', (() => undefined) as typeof cancelAnimationFrame)
  // setup.ts 里 getContext 返回 null，这里给一个可用的桩才能走到 toDataURL
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,FRAME')
})

describe('resolveFrameTimeSec', () => {
  it('首帧取 0，尾帧从结尾回退一小段', () => {
    expect(resolveFrameTimeSec('first', 10)).toBe(0)
    // 直接取 duration 多数浏览器不会解码新帧，还会触发 ended
    expect(resolveFrameTimeSec('last', 10)).toBeCloseTo(9.98, 5)
    // 比回退量还短的视频，尾帧退到 0 而不是负数
    expect(resolveFrameTimeSec('last', 0.02)).toBe(0)
  })

  it('可以指定回退量，供尾帧逐级重试使用', () => {
    expect(resolveFrameTimeSec('last', 10, 0.2)).toBeCloseTo(9.8, 5)
  })

  it('当前帧不需要定位；时长未知时拒绝给出时刻', () => {
    expect(resolveFrameTimeSec('current', 10)).toBeNull()
    expect(resolveFrameTimeSec('first', 0)).toBeNull()
    expect(resolveFrameTimeSec('last', Number.NaN)).toBeNull()
    expect(resolveFrameTimeSec('last', Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('captureVideoFrameDataUrl', () => {
  it('画出当前画面', () => {
    expect(captureVideoFrameDataUrl(fakeVideo())).toBe('data:image/jpeg;base64,FRAME')
  })

  it('元素缺失或元数据未就绪时返回空串而不是抛错', () => {
    expect(captureVideoFrameDataUrl(null)).toBe('')
    const noMeta = fakeVideo()
    Object.defineProperty(noMeta, 'videoWidth', { value: 0, configurable: true })
    expect(captureVideoFrameDataUrl(noMeta)).toBe('')
  })
})

describe('captureVideoFrame', () => {
  it('当前帧直接画，不动播放位置', async () => {
    const video = fakeVideo({ currentTime: 4 })
    expect(await captureVideoFrame(video, 'current')).toBe('data:image/jpeg;base64,FRAME')
    expect(video.seeks).toEqual([])
  })

  it('首帧先定位到 0，画完还原到原来的位置', async () => {
    const video = fakeVideo({ currentTime: 4, duration: 10 })
    expect(await captureVideoFrame(video, 'first')).toBe('data:image/jpeg;base64,FRAME')
    expect(video.seeks).toEqual([0, 4])
  })

  it('尾帧从结尾回退一小段，画完同样还原', async () => {
    const video = fakeVideo({ currentTime: 2, duration: 10 })
    expect(await captureVideoFrame(video, 'last')).toBe('data:image/jpeg;base64,FRAME')
    expect(video.seeks[0]).toBeCloseTo(9.98, 5)
    expect(video.seeks[video.seeks.length - 1]).toBe(2)
  })

  it('尾帧解不出帧时逐级往回退，而不是直接放弃', async () => {
    /*
     * 回归：MP4 的 duration 元数据常比实际可解码内容长几十毫秒，
     * 贴着结尾的第一档会 seek 过去解不出帧。旧实现只试一次就返回空串，
     * 表现为「截尾帧点了没反应」。
     */
    const video = fakeVideo({ currentTime: 2, duration: 10 })
    // 只有退到 9.916（第三档 0.084）以内才认为解得出画面
    const decodableFrom = 9.917
    Object.defineProperty(video, 'videoWidth', {
      configurable: true,
      get: () => (video.currentTime < decodableFrom ? 1920 : 0),
    })

    const frame = await captureVideoFrame(video, 'last')
    const seekedPastEnd = video.seeks.filter((time) => time >= decodableFrom).length

    expect(frame).toBe('data:image/jpeg;base64,FRAME')
    // 前两档都落在解不出的区间，第三档才成功
    expect(seekedPastEnd).toBeGreaterThanOrEqual(2)
    expect(video.seeks.some((time) => time < decodableFrom)).toBe(true)
    // 无论试了几档，最后都要还原回用户原来的位置
    expect(video.seeks[video.seeks.length - 1]).toBe(2)
  })

  it('尾帧所有档位都失败时返回空串，交由调用方提示', async () => {
    const video = fakeVideo({ currentTime: 2, duration: 10 })
    Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => 0 })
    expect(await captureVideoFrame(video, 'last')).toBe('')
  })

  it('原本在播时先暂停、截完继续播', async () => {
    const video = fakeVideo({ currentTime: 1, duration: 10, paused: false })
    await captureVideoFrame(video, 'first')
    expect(video.pauseCalls).toBe(1)
    expect(video.playCalls).toBe(1)
  })

  it('原本暂停就保持暂停', async () => {
    const video = fakeVideo({ currentTime: 1, duration: 10, paused: true })
    await captureVideoFrame(video, 'first')
    expect(video.playCalls).toBe(0)
  })

  it('时长未知时取不到首尾帧，返回空串交由调用方提示', async () => {
    const video = fakeVideo({ duration: 0 })
    expect(await captureVideoFrame(video, 'first')).toBe('')
    expect(await captureVideoFrame(video, 'last')).toBe('')
    expect(video.seeks).toEqual([])
  })

  it('没有元素时返回空串', async () => {
    expect(await captureVideoFrame(null, 'first')).toBe('')
  })
})
