import { useCallback, useEffect, useRef, useState } from 'react'

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
  // 记住当前正在播放的背景视频，供组件卸载时停掉它。
  const activeVideoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const syncPreference = (event: StorageEvent) => {
      if (event.key !== BACKGROUND_VIDEO_MUTED_KEY) return
      const nextMuted = event.newValue === 'true'
      setPreferenceMuted(nextMuted)
      setAutoplayBlocked(false)
      // 与 toggleVideoSound 一样直接同步到元素属性,不等下一次渲染:
      // 跨标签页静音是「立刻别出声」的诉求,渲染被后台节流时不能让视频多响一拍。
      const video = activeVideoRef.current
      if (video) {
        try {
          video.muted = nextMuted
        } catch {
          // 元素可能已被回收;同步失败无副作用,忽略。
        }
      }
    }
    window.addEventListener('storage', syncPreference)
    return () => window.removeEventListener('storage', syncPreference)
  }, [])

  // 页面卸载时显式停掉背景视频：从 DOM 移除 <video> 并不会停止播放——只要还有 JS 引用（ref/闭包）
  // 指着它，被摘掉的元素会继续放声，直到被 GC。于是登录页/开屏页卸载后，声音会漏到导航后的页面
  // （如画布）。这里 pause + 兜底静音，确保离开页面即停。
  useEffect(() => {
    return () => {
      const video = activeVideoRef.current
      activeVideoRef.current = null
      if (!video) return
      try {
        video.pause()
        video.muted = true
      } catch {
        // 元素可能已被浏览器回收；停不了也无副作用，忽略。
      }
    }
  }, [])

  // muted 是界面真相，必须把它同步到「当前视频的 muted 属性」上——不能只靠 JSX 的 <video muted={muted}>：
  // React 对 muted 只可靠地设「特性」，而浏览器出不出声看的是「属性」，二者会脱钩；且有些状态变更
  // （自动播放降级 autoplayBlocked、跨标签页 storage 同步偏好）不经过 play/toggle 的命令式设置。
  // 于是会出现「界面显示已静音、视频却仍有声」。这里在 muted 变化时统一把属性同步过去。
  useEffect(() => {
    const video = activeVideoRef.current
    if (!video) return
    try {
      video.muted = muted
    } catch {
      // 元素可能已被回收；同步失败无副作用，忽略。
    }
  }, [muted])

  const playVideo = useCallback(
    async (video: HTMLVideoElement | null) => {
      if (!video) return
      activeVideoRef.current = video
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
      activeVideoRef.current = video
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
