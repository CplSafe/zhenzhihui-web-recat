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
  // playVideo 会被 canplay 反复触发（换幻灯片、卡顿后重新缓冲都会再来一次）。
  // 有声自动播放已被拦截过一次后，后面这些触发不能再擅自把 muted 关掉：
  // 那时页面往往已经有过用户手势，第二次 play() 会成功，界面还显示着静音，声音却突然出来了。
  // 恢复声音只走用户点喇叭这一条路（toggleVideoSound）。
  const autoplayBlockedRef = useRef(false)

  useEffect(() => {
    const syncPreference = (event: StorageEvent) => {
      if (event.key !== BACKGROUND_VIDEO_MUTED_KEY) return
      const nextMuted = event.newValue === 'true'
      setPreferenceMuted(nextMuted)
      autoplayBlockedRef.current = false
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
        // pause 只是停在当前帧，媒体管线还挂着：某些浏览器上被摘掉的元素若还有引用，
        // 网络/解码线程会继续跑，个别版本甚至还会继续出声（用户反馈「换了页面还在响」）。
        // 卸掉 src 再 load() 是规范里彻底重置媒体元素的办法，等价于把这条视频关掉。
        if (typeof video.removeAttribute === 'function') video.removeAttribute('src')
        if (typeof video.load === 'function') video.load()
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
      video.muted = preferenceMuted || autoplayBlockedRef.current
      try {
        await video.play()
        if (!autoplayBlockedRef.current) setAutoplayBlocked(false)
      } catch {
        if (preferenceMuted) return

        // 浏览器通常会拦截首次有声自动播放。先静音保证画面继续播放，
        // 等用户点击喇叭后再在用户手势中恢复声音。
        video.muted = true
        autoplayBlockedRef.current = true
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
      autoplayBlockedRef.current = false
      setAutoplayBlocked(false)
      setPreferenceMuted(nextMuted)
      writeMutedPreference(nextMuted)

      if (!video) return
      activeVideoRef.current = video
      video.muted = nextMuted
      if (!nextMuted) {
        const markBlocked = () => {
          autoplayBlockedRef.current = true
          setAutoplayBlocked(true)
        }
        try {
          const playResult = video.play()
          void playResult?.catch(markBlocked)
        } catch {
          markBlocked()
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
