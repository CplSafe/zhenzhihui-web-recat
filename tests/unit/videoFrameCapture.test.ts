import { seekVideoToDecodedFrame } from '@/utils/videoFrameCapture'
import { describe, expect, it, vi } from 'vitest'

type FrameCallback = (now: DOMHighResTimeStamp, metadata: { mediaTime?: number }) => void

describe('seekVideoToDecodedFrame', () => {
  it('registers the frame callback before seeking and ignores stale decoded frames', async () => {
    const video = document.createElement('video')
    const events: string[] = []
    const callbacks = new Map<number, FrameCallback>()
    let callbackId = 0
    let currentTime = 0

    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        events.push(`seek:${value}`)
        currentTime = value
      },
    })
    Object.defineProperty(video, 'seeking', { configurable: true, get: () => false })
    Object.defineProperty(video, 'requestVideoFrameCallback', {
      configurable: true,
      value: vi.fn((callback: FrameCallback) => {
        const id = ++callbackId
        events.push('frame-request')
        callbacks.set(id, callback)
        return id
      }),
    })
    Object.defineProperty(video, 'cancelVideoFrameCallback', {
      configurable: true,
      value: vi.fn((id: number) => callbacks.delete(id)),
    })

    const capture = seekVideoToDecodedFrame(video, 1.5, {
      seekTimeoutMs: 1000,
      frameTimeoutMs: 1000,
      frameTimeToleranceSec: 0.1,
    })

    expect(events.slice(0, 2)).toEqual(['frame-request', 'seek:1.5'])

    const staleFrame = callbacks.get(1)
    expect(staleFrame).toBeTypeOf('function')
    callbacks.delete(1)
    staleFrame?.(0, { mediaTime: 0.5 })
    expect(events).toEqual(['frame-request', 'seek:1.5', 'frame-request'])

    video.dispatchEvent(new Event('seeked'))
    let completed = false
    void capture.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)

    const targetFrame = callbacks.get(2)
    expect(targetFrame).toBeTypeOf('function')
    callbacks.delete(2)
    targetFrame?.(0, { mediaTime: 1.49 })

    await expect(capture).resolves.toBeUndefined()
  })

  it('rejects instead of treating an unconfirmed old frame as a successful capture', async () => {
    vi.useFakeTimers()
    try {
      const video = document.createElement('video')
      let currentTime = 0
      Object.defineProperty(video, 'currentTime', {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => {
          currentTime = value
        },
      })
      Object.defineProperty(video, 'seeking', { configurable: true, get: () => false })
      Object.defineProperty(video, 'requestVideoFrameCallback', {
        configurable: true,
        value: vi.fn(() => 1),
      })
      Object.defineProperty(video, 'cancelVideoFrameCallback', {
        configurable: true,
        value: vi.fn(),
      })

      const capture = seekVideoToDecodedFrame(video, 2.5, {
        seekTimeoutMs: 1000,
        frameTimeoutMs: 50,
      })
      video.dispatchEvent(new Event('seeked'))
      const rejection = expect(capture).rejects.toThrow('目标视频帧解码超时')

      await vi.advanceTimersByTimeAsync(50)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })
})
