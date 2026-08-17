import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFilmstrip, clearFilmstripCache, filmstripFrameTimes, getCachedFilmstrip } from '@/utils/videoFilmstrip'

describe('filmstripFrameTimes', () => {
  it('按段取中点，而不是端点', () => {
    // 端点常常是转场黑帧，中点更能代表这一段的画面
    expect(filmstripFrameTimes(10, 5)).toEqual([1, 3, 5, 7, 9])
    expect(filmstripFrameTimes(6, 3)).toEqual([1, 3, 5])
  })

  it('取样点都落在片长之内', () => {
    const times = filmstripFrameTimes(4, 6)
    expect(times).toHaveLength(6)
    expect(Math.min(...times)).toBeGreaterThan(0)
    expect(Math.max(...times)).toBeLessThan(4)
  })

  it('时长非法时不产生取样点', () => {
    expect(filmstripFrameTimes(0, 6)).toEqual([])
    expect(filmstripFrameTimes(Number.NaN, 6)).toEqual([])
    expect(filmstripFrameTimes(Number.POSITIVE_INFINITY, 6)).toEqual([])
  })
})

describe('buildFilmstrip', () => {
  beforeEach(() => {
    clearFilmstripCache()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,THUMB')
    vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }) as typeof requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', (() => undefined) as typeof cancelAnimationFrame)

    // jsdom 不加载媒体：让 video 一被赋 src 就宣称元数据就绪，并对每次 seek 同步回派 seeked
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, value: 1 })
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, value: 10 })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, value: 1920 })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, value: 1080 })
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() {
        return (this as { _t?: number })._t ?? 0
      },
      set(next: number) {
        ;(this as { _t?: number })._t = next
        queueMicrotask(() => (this as HTMLMediaElement).dispatchEvent(new Event('seeked')))
      },
    })
  })

  it('抽出与取样点数量一致的缩略帧', async () => {
    const frames = await buildFilmstrip('/api/v1/assets/1/download?workspace_id=21', 4)
    expect(frames).toHaveLength(4)
    expect(frames.every((frame) => frame.startsWith('data:image/jpeg'))).toBe(true)
  })

  it('按素材地址缓存，重复请求不再解码', async () => {
    const url = '/api/v1/assets/2/download?workspace_id=21'
    expect(getCachedFilmstrip(url, 3)).toBeNull()

    const first = await buildFilmstrip(url, 3)
    expect(getCachedFilmstrip(url, 3)).toEqual(first)
    // 命中缓存时返回的就是同一个数组引用
    expect(await buildFilmstrip(url, 3)).toBe(first)
  })

  it('并发请求同一条素材时只解一次', async () => {
    const url = '/api/v1/assets/3/download?workspace_id=21'
    const [a, b] = await Promise.all([buildFilmstrip(url, 3), buildFilmstrip(url, 3)])
    expect(a).toBe(b)
  })

  it('地址为空时直接返回空数组，不去建 video 元素', async () => {
    expect(await buildFilmstrip('', 4)).toEqual([])
  })

  it('时长读不出来时返回空数组，由调用方回落到纯色块', async () => {
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, value: Number.NaN })
    expect(await buildFilmstrip('/api/v1/assets/4/download?workspace_id=21', 4)).toEqual([])
  })
})
