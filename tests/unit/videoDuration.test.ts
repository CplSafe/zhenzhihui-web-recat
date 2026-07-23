import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readVideoDurationSec } from '@/utils/videoDuration'

interface FakeVideo {
  duration: number
  preload: string
  muted: boolean
  src: string
  onloadedmetadata: (() => void) | null
  onerror: (() => void) | null
  removeAttribute: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
}

describe('readVideoDurationSec', () => {
  const realCreateElement = document.createElement.bind(document)
  let created: FakeVideo[]

  beforeEach(() => {
    vi.useFakeTimers()
    created = []
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() !== 'video') return realCreateElement(tagName, options)
      const video: FakeVideo = {
        duration: 0,
        preload: '',
        muted: false,
        src: '',
        onloadedmetadata: null,
        onerror: null,
        removeAttribute: vi.fn(),
        load: vi.fn(),
      }
      created.push(video)
      return video as unknown as HTMLVideoElement
    }) as typeof document.createElement)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns zero immediately without creating media for an empty URL', async () => {
    await expect(readVideoDurationSec('')).resolves.toBe(0)
    expect(created).toEqual([])
  })

  it('rounds a positive metadata duration and releases the media source once', async () => {
    const result = readVideoDurationSec('https://cdn.example.com/video.mp4', 100)
    const video = created[0]
    expect(video).toMatchObject({ preload: 'metadata', muted: true, src: 'https://cdn.example.com/video.mp4' })

    video.duration = 4.6
    video.onloadedmetadata?.()

    await expect(result).resolves.toBe(5)
    expect(video.removeAttribute).toHaveBeenCalledWith('src')
    expect(video.load).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(100)
    expect(video.load).toHaveBeenCalledOnce()
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns zero for invalid metadata duration %p',
    async (duration) => {
      const result = readVideoDurationSec('/video.mp4')
      const video = created[0]
      video.duration = duration
      video.onloadedmetadata?.()
      await expect(result).resolves.toBe(0)
    },
  )

  it('returns zero on a media error', async () => {
    const result = readVideoDurationSec('/broken.mp4')
    const video = created[0]
    video.onerror?.()
    await expect(result).resolves.toBe(0)
    expect(video.load).toHaveBeenCalledOnce()
  })

  it('uses the best duration available when metadata times out', async () => {
    const result = readVideoDurationSec('/slow.mp4', 250)
    const video = created[0]
    video.duration = 7.4

    await vi.advanceTimersByTimeAsync(249)
    let settled = false
    void result.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe(7)
    expect(video.load).toHaveBeenCalledOnce()
  })
})
