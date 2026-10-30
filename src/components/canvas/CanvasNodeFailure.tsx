import type { ReactNode } from 'react'
import CanvasNodeStatus from './CanvasNodeStatus'
import { useToast } from '@/composables/useToast'
import styles from './CanvasNodeStatus.module.css'

/** 节点失败态直接展示原因，并支持复制本次请求编号。 */
export default function CanvasNodeFailure({
  reason,
  children,
  zoom,
  requestId,
  title = '生成失败',
  failedAt,
}: {
  reason?: string
  children?: ReactNode
  zoom?: number
  requestId?: string
  title?: string
  failedAt?: string
}) {
  const { showToast } = useToast()
  const copyRequestId = async () => {
    try {
      await navigator.clipboard.writeText(requestId!)
      showToast('复制成功', 'success')
    } catch {
      showToast('复制失败，请稍后重试', 'error')
    }
  }
  return (
    <CanvasNodeStatus failure zoom={zoom} label={reason ? `${title}：${reason}` : title}>
      <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path
          d="M20.6 7.8a4 4 0 0 1 6.8 0l16 27.4a4 4 0 0 1-3.4 6H8a4 4 0 0 1-3.4-6l16-27.4Z"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path d="M24 17v10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <circle cx="24" cy="33" r="1.8" fill="currentColor" />
      </svg>
      <strong>{title}</strong>
      {reason && (
        <p className={styles.failureReason} data-failure-info>
          {reason}
        </p>
      )}
      {failedAt && Number.isFinite(Date.parse(failedAt)) && (
        <small data-failure-info>失败时间：{new Date(failedAt).toLocaleString()}</small>
      )}
      {/CONCURRENCY|并发|任务正在生成/i.test(reason || '') && (
        <p className={styles.failureReason} data-failure-info>
          这是上次请求返回的并发限制，不代表当前仍有任务运行。请查看详情核对。
        </p>
      )}
      {requestId && (
        <button
          type="button"
          className={`${styles.requestId} nodrag nopan`}
          data-failure-info
          aria-label={`复制 RequestID：${requestId}`}
          title="点击复制 RequestID"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            void copyRequestId()
          }}
        >
          RequestID：{requestId}
        </button>
      )}
      {children && <div data-status-details>{children}</div>}
    </CanvasNodeStatus>
  )
}
