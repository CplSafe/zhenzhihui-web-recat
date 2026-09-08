/**
 * AppToast — 全局 Toast 通知组件
 * 支持 success/error/info 类型，自动消失，挂载在顶层供全局调用。
 * 三种类型有独立的配色与图标（此前 info 复用 success 的绿色对勾，中性提示看起来像成功）；
 * 隐藏时先播放一段退场动画再卸载，可手动点击关闭。
 */
import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../stores/ui'
import './AppToast.css'

/** 退场动画时长（毫秒），与 CSS 的 toast-leave 保持一致。 */
const TOAST_LEAVE_MS = 180

/** 渲染全局唯一的通知条，并根据消息类型设置屏幕阅读器语义。 */
export default function AppToast() {
  const { visible, message, type } = useUiStore((s) => s.toast)
  const clearToast = useUiStore((s) => s.clearToast)

  // 退场动画：store 置为不可见后，保留最后一条内容多渲染一小段时间播放退场
  const [leaving, setLeaving] = useState(false)
  const lastShownRef = useRef({ message: '', type })
  if (visible) lastShownRef.current = { message, type }

  useEffect(() => {
    if (visible) {
      setLeaving(false)
      return
    }
    if (!lastShownRef.current.message) return
    setLeaving(true)
    const timer = window.setTimeout(() => setLeaving(false), TOAST_LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [visible])

  if (!visible && !leaving) return null

  const shown = visible ? { message, type } : lastShownRef.current

  return (
    <div
      className={`toast-message ${shown.type}${visible ? '' : ' is-leaving'}`}
      role={shown.type === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className="toast-icon" aria-hidden="true">
        {shown.type === 'error' ? (
          <svg viewBox="0 0 20 20">
            <path d="M10 1.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Zm2.8 11-1 1L10 11.9l-1.8 1.9-1-1L9 10 7.2 7.2l1-1L10 8.1l1.8-1.9 1 1L11 10l1.8 2.8Z" />
          </svg>
        ) : shown.type === 'success' ? (
          <svg viewBox="0 0 20 20">
            <path d="M10 1.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Zm-1 11.3L5.8 9.9l1-1L9 11.1l4.5-4.6 1 1L9 13.1Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20">
            <path d="M10 1.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4ZM9.1 8.2h1.8v6H9.1v-6Zm.9-3.1a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z" />
          </svg>
        )}
      </span>
      <span className="toast-text">{shown.message}</span>
      <button type="button" className="toast-close" aria-label="关闭提示" onClick={clearToast}>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="m2 2 8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </svg>
      </button>
    </div>
  )
}
