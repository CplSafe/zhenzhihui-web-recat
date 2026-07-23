/**
 * AppToast — 全局 Toast 通知组件
 * 支持 success/error/info 类型，自动消失，挂载在顶层供全局调用。
 */
import { useUiStore } from '../stores/ui'
import './AppToast.css'

/** 渲染全局唯一的通知条，并根据消息类型设置屏幕阅读器语义。 */
export default function AppToast() {
  const { visible, message, type } = useUiStore((s) => s.toast)

  if (!visible) return null

  return (
    <div className={`toast-message ${type}`} role={type === 'error' ? 'alert' : 'status'} aria-live="polite">
      <span className="toast-icon" aria-hidden="true">
        {type === 'error' ? (
          <svg viewBox="0 0 20 20">
            <path d="M10 1.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Zm2.8 11-1 1L10 11.9l-1.8 1.9-1-1L9 10 7.2 7.2l1-1L10 8.1l1.8-1.9 1 1L11 10l1.8 2.8Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20">
            <path d="M10 1.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Zm-1 11.3L5.8 9.9l1-1L9 11.1l4.5-4.6 1 1L9 13.1Z" />
          </svg>
        )}
      </span>
      <span>{message}</span>
    </div>
  )
}
