import type { ReactNode } from 'react'
import styles from './CanvasNodeFailure.module.css'

/** 节点预览统一失败态；原因放在悬停提示和详情里，保持预览简洁。 */
export default function CanvasNodeFailure({ reason, children }: { reason?: string; children?: ReactNode }) {
  return (
    <div className={styles.failure} role="alert" title={reason || undefined}>
      <div className={styles.message}>
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
        <strong>生成失败</strong>
      </div>
      {children && <div className={styles.details}>{children}</div>}
    </div>
  )
}
