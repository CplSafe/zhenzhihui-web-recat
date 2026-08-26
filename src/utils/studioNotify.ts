/**
 * 创作台的浏览器通知：生成成功后，在用户已经切走的情况下把他叫回来。
 *
 * 触发口径（用户决策 2026-08-26）：
 *   - 只在**成功**时通知，失败不打扰（页面内已有 toast 说明原因）；
 *   - 只在**页面不可见**时通知。页面就在眼前时用户自己看得到，再弹系统通知是噪音。
 *
 * 权限只在「第一次真的要通知」时申请，不在进页面时就弹权限框——没产出任何价值
 * 就索要权限，通过率低且打断创作。用户拒绝后不再重复申请。
 */

/** 通知点击后回到页面时，用于定位到对应批次。 */
export interface StudioNotifyOptions {
  /** 成品数量，用于文案「已生成 N 个作品」。 */
  count: number
  /** 图片 / 视频，决定文案措辞。 */
  kind: 'image' | 'video'
  /** 提示词，作为通知正文，过长会被截断。 */
  prompt?: string
  /** 点击通知后的回调，通常用于滚动到该批次。 */
  onClick?: () => void
}

/** 通知正文里提示词的最大展示长度。 */
const MAX_BODY_LENGTH = 60

/** 同一批次重复通知时用同一个 tag 覆盖，避免通知中心堆叠。 */
const NOTIFICATION_TAG = 'studio-generation'

/** 运行环境是否支持 Notification API（SSR、旧浏览器、非安全上下文下都可能没有）。 */
function isSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.Notification !== 'undefined'
}

/** 页面当前是否不可见（后台标签页 / 最小化）。 */
export function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * 确保拿到通知权限，返回是否可以发通知。
 *
 * 已授权直接放行；已拒绝直接返回 false（浏览器也不会再弹框）；未决定时才申请。
 */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (!isSupported()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    // 老版本 Safari 的回调式 API 会抛，视作不可用即可，不影响生成主流程。
    return false
  }
}

/** 截断过长提示词，保留可读的开头。 */
function toBody(prompt?: string): string {
  const text = String(prompt || '').trim()
  if (!text) return '点击查看生成结果'
  return text.length > MAX_BODY_LENGTH ? `${text.slice(0, MAX_BODY_LENGTH)}…` : text
}

/**
 * 生成成功后尝试发一条系统通知。
 *
 * 页面可见、不支持、未授权时都安静跳过——通知只是锦上添花，任何一步失败都不该
 * 影响创作流程，所以整个函数不抛错。
 */
export async function notifyGenerationDone(options: StudioNotifyOptions): Promise<boolean> {
  if (!isSupported() || !isPageHidden()) return false
  if (!(await ensureNotifyPermission())) return false
  // 申请权限期间用户可能已经切回页面，这时就不必再弹了。
  if (!isPageHidden()) return false

  try {
    const label = options.kind === 'video' ? '视频' : '图片'
    const notification = new Notification(`${label}生成完成`, {
      body: toBody(options.prompt),
      tag: NOTIFICATION_TAG,
      icon: '/favicon.ico',
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
      options.onClick?.()
    }
    return true
  } catch {
    // 部分浏览器（如未注册 Service Worker 的移动端 Chrome）会在构造时抛。
    return false
  }
}
