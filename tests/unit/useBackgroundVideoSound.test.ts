import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundVideoSound } from '@/composables/useBackgroundVideoSound'

/** 造一个够用的假 <video>：play/pause/load/removeAttribute 可被断言，muted 可读写。 */
function fakeVideo() {
  return {
    muted: false,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
  } as unknown as HTMLVideoElement & {
    play: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    load: ReturnType<typeof vi.fn>
    removeAttribute: ReturnType<typeof vi.fn>
  }
}

afterEach(() => {
  try {
    window.localStorage.removeItem('zzh-background-video-muted')
  } catch {
    /* ignore */
  }
})

describe('useBackgroundVideoSound 卸载时停掉背景视频', () => {
  it('播放过的背景视频在组件卸载时被 pause 并静音，避免声音漏到下个页面', async () => {
    const video = fakeVideo()
    const { result, unmount } = renderHook(() => useBackgroundVideoSound())

    await act(async () => {
      await result.current.playVideo(video)
    })
    expect(video.play).toHaveBeenCalledTimes(1)
    expect(video.pause).not.toHaveBeenCalled()

    unmount()

    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(video.muted).toBe(true)
    // 光 pause 不够：卸掉 src 再 load() 才是把媒体管线整个关掉，被摘掉的元素不会再出声
    expect(video.removeAttribute).toHaveBeenCalledWith('src')
    expect(video.load).toHaveBeenCalledTimes(1)
  })

  it('有声自动播放被拦截后，后续 canplay 再触发 playVideo 也保持静音，不会「界面静音却突然出声」', async () => {
    const video = fakeVideo()
    // 第一次有声 play 被浏览器拦截；之后（页面已有用户手势）play 都会成功
    video.play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError')).mockResolvedValue(undefined)
    const { result } = renderHook(() => useBackgroundVideoSound())

    await act(async () => {
      await result.current.playVideo(video)
    })
    expect(video.muted).toBe(true)
    expect(result.current.muted).toBe(true)
    expect(result.current.needsInteraction).toBe(true)

    // 换幻灯片 / 卡顿后重新缓冲：canplay 再次触发
    await act(async () => {
      await result.current.playVideo(video)
    })
    expect(video.muted).toBe(true)
    expect(result.current.muted).toBe(true)

    // 只有用户点喇叭才恢复声音
    act(() => {
      result.current.toggleVideoSound(video)
    })
    expect(video.muted).toBe(false)
    expect(result.current.muted).toBe(false)
  })

  it('从未播放过视频时，卸载不报错也不误调 pause', () => {
    const { unmount } = renderHook(() => useBackgroundVideoSound())
    expect(() => unmount()).not.toThrow()
  })

  it('静音偏好在别处变化（跨标签页同步）时，当前视频的 muted 属性同步跟上，避免「显示静音却有声」', async () => {
    const video = fakeVideo()
    const { result } = renderHook(() => useBackgroundVideoSound())
    await act(async () => {
      await result.current.playVideo(video)
    })
    expect(video.muted).toBe(false) // 初始偏好非静音：尝试有声播放

    // 模拟另一个标签页把偏好改成静音（不经过 play/toggle 的命令式设置）
    act(() => {
      window.localStorage.setItem('zzh-background-video-muted', 'true')
      window.dispatchEvent(new StorageEvent('storage', { key: 'zzh-background-video-muted', newValue: 'true' }))
    })
    expect(video.muted).toBe(true) // 界面静音 → 视频属性必须同步为静音
  })

  it('通过声音开关接触到的视频，卸载时同样被停掉', () => {
    const video = fakeVideo()
    const { result, unmount } = renderHook(() => useBackgroundVideoSound())

    act(() => {
      result.current.toggleVideoSound(video)
    })
    unmount()

    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(video.muted).toBe(true)
  })
})
