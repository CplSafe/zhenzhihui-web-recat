/**
 * 生成完成 / 失败的桌面通知与提示音。
 *
 * 视频一跑几分钟，用户多半切去干别的了；节点上的进度条只对盯着画布的人有用。
 * 浏览器通知走 Notification API（需要用户授权一次），提示音用 WebAudio 现场合成——
 * 不引音频文件，也就没有资源加载与 bundle 预算的事。
 *
 * 全部是薄封装，jsdom 里没有的能力一律静默跳过，不抛错。
 */

export function canUseNotifications(): boolean {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined'
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!canUseNotifications()) return 'unsupported'
  return Notification.permission
}

/** 申请通知权限；已授权/已拒绝直接返回当前状态，不重复弹窗 */
export async function ensureNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!canUseNotifications()) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

/** 用户没在看这个页面：切了标签页、最小化、或焦点在别的窗口 */
export function isPageInBackground(): boolean {
  if (typeof document === 'undefined') return false
  if (document.hidden) return true
  return typeof document.hasFocus === 'function' ? !document.hasFocus() : false
}

export interface GenerationNotificationOptions {
  title: string
  body?: string
  /** 同 tag 的通知会互相替换，避免一次批量生成刷出十几条 */
  tag?: string
  /** 点击通知时回调（通常是聚焦窗口并定位到节点） */
  onClick?: () => void
}

/** 发一条桌面通知；未授权或不支持时返回 null */
export function showGenerationNotification(options: GenerationNotificationOptions): Notification | null {
  if (!canUseNotifications() || Notification.permission !== 'granted') return null
  try {
    const notification = new Notification(options.title, {
      body: options.body,
      tag: options.tag,
      silent: true,
    })
    notification.onclick = () => {
      try {
        window.focus()
      } catch {
        /* 某些浏览器不允许脚本抢焦点 */
      }
      options.onClick?.()
      notification.close()
    }
    return notification
  } catch {
    return null
  }
}

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!audioContext) {
    try {
      audioContext = new Ctor()
    } catch {
      return null
    }
  }
  return audioContext
}

/**
 * 两声短促的提示音：成功是上行（低→高），失败是下行。
 * 音量很低、总长不到半秒——它的作用是「叫一声」，不是闹铃。
 */
export function playNotificationSound(kind: 'success' | 'failure' = 'success'): void {
  const ctx = getAudioContext()
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') void ctx.resume()
    const notes = kind === 'success' ? [660, 880] : [520, 380]
    const now = ctx.currentTime
    notes.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      const start = now + index * 0.16
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.16)
    })
  } catch {
    // 音频设备不可用时静默
  }
}
