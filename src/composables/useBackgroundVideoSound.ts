import { useCallback, useEffect, useState } from 'react'

const BACKGROUND_VIDEO_MUTED_KEY = 'zzh-background-video-muted'

function readMutedPreference(): boolean {
  try {
    return window.localStorage.getItem(BACKGROUND_VIDEO_MUTED_KEY) === 'true'
  } catch {
    return false
  }
}

function writeMutedPreference(muted: boolean) {
  try {
    window.localStorage.setItem(BACKGROUND_VIDEO_MUTED_KEY, String(muted))
  } catch {
    // 隐私模式或存储空间不可用时，当前页面内的声音切换仍然有效。
  }
}

/**
 * 统一管理开屏页与登录页背景视频声音。
 * 用户主动选择会持久化；浏览器拦截有声自动播放时只做本次页面的临时静音降级。
 */
export function useBackgroundVideoSound() {
  const [preferenceMuted, setPreferenceMuted] = useState(readMutedPreference)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const muted = preferenceMuted || autoplayBlocked

  useEffect(() => {
    const syncPreference = (event: StorageEvent) => {
      if (event.key !== BACKGROUND_VIDEO_MUTED_KEY) return
      setPreferenceMuted(event.newValue === 'true')
      setAutoplayBlocked(false)
    }
    window.addEventListener('storage', syncPreference)
    return () => window.removeEventListener('storage', syncPreference)
  }, [])

  const playVideo = useCallback(
    async (video: HTMLVideoElement | null) => {
      if (!video) return
      video.muted = preferenceMuted
      try {
        await video.play()
        setAutoplayBlocked(false)
      } catch {
        if (preferenceMuted) return

        // 浏览器通常会拦截首次有声自动播放。先静音保证画面继续播放，
        // 等用户点击喇叭后再在用户手势中恢复声音。
        video.muted = true
        setAutoplayBlocked(true)
        try {
          await video.play()
        } catch {
          // 媒体加载失败由页面自身的 onError 处理。
        }
      }
    },
    [preferenceMuted],
  )

  const toggleVideoSound = useCallback(
    (video: HTMLVideoElement | null) => {
      const nextMuted = !muted
      setAutoplayBlocked(false)
      setPreferenceMuted(nextMuted)
      writeMutedPreference(nextMuted)

      if (!video) return
      video.muted = nextMuted
      if (!nextMuted) {
        try {
          const playResult = video.play()
          void playResult?.catch(() => setAutoplayBlocked(true))
        } catch {
          setAutoplayBlocked(true)
        }
      }
    },
    [muted],
  )

  return {
    muted,
    needsInteraction: autoplayBlocked && !preferenceMuted,
    playVideo,
    toggleVideoSound,
  }
}
