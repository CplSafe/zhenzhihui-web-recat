import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundVideoSound } from '@/composables/useBackgroundVideoSound'

/** 造一个够用的假 <video>：play/pause 可被断言，muted 可读写。 */
function fakeVideo() {
  return {
    muted: false,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  } as unknown as HTMLVideoElement & { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }
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
