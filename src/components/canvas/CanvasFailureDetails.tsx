import { useState } from 'react'
import { Modal } from 'antd'
import { useToast } from '@/composables/useToast'
import { FAILURE_STAGE_LABELS, formatGenerationFailure, nodeGenerationFailure } from '@/utils/generationFailure'
import type { GenerationFailure } from '@/utils/generationFailure'
import styles from './CanvasFailureDetails.module.css'

export default function CanvasFailureDetails({ data }: { data: Record<string, any> }) {
  const [open, setOpen] = useState(false)
  const { showToast } = useToast()
  const current = nodeGenerationFailure(data)
  const history: GenerationFailure[] = Array.isArray(data.taskFailureHistory) ? data.taskFailureHistory : []
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制排查信息', 'success')
    } catch {
      showToast('复制失败，请选中详情中的编号手动复制', 'error')
    }
  }
  const renderDetails = (details: GenerationFailure) => (
    <div className={styles.details}>
      <p className={styles.reason}>{details.message}</p>
      <dl>
        <dt>任务状态</dt>
        <dd>{FAILURE_STAGE_LABELS[details.stage]}</dd>
        <dt>TaskID</dt>
        <dd>
          {details.taskId || '未取得任务编号'}
          {details.taskId && (
            <button type="button" onClick={() => void copy(details.taskId!)}>
              复制 TaskID
            </button>
          )}
        </dd>
        {details.requestId && (
          <>
            <dt>RequestID</dt>
            <dd>{details.requestId}</dd>
          </>
        )}
        {details.submissionId && (
          <>
            <dt>提交编号</dt>
            <dd>
              {details.submissionId}
              <small>用于核对同一次提交，不是 TaskID</small>
            </dd>
          </>
        )}
        {details.code && (
          <>
            <dt>错误码</dt>
            <dd>{details.code}</dd>
          </>
        )}
        {details.httpStatus && (
          <>
            <dt>HTTP 状态</dt>
            <dd>{details.httpStatus}</dd>
          </>
        )}
        <dt>失败时间</dt>
        <dd>{new Date(details.failedAt).toLocaleString()}</dd>
      </dl>
      <button type="button" onClick={() => void copy(formatGenerationFailure(details))}>
        复制排查信息
      </button>
    </div>
  )
  return (
    <span
      className={`${styles.wrapper} nodrag nopan`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button className={styles.trigger} type="button" onClick={() => setOpen(true)}>
        查看详情
      </button>
      <Modal title="生成失败详情" open={open} onCancel={() => setOpen(false)} footer={null} zIndex={3200}>
        {renderDetails(current)}
        {history.length > 0 && (
          <details className={styles.history}>
            <summary>之前的失败记录（{history.length}）</summary>
            {history.map((entry, index) => (
              <section key={`${entry.failedAt}-${index}`}>{renderDetails(entry)}</section>
            ))}
          </details>
        )}
      </Modal>
    </span>
  )
}
