/**
 * 申请接单弹窗（需求详情「申请接单」）。
 * 提交 message / 报价 / 预计天数到 POST /market/demands/{id}/applications。
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { applyToDemand, type MarketDemand } from '@/api/market'
import { useToast } from '@/composables/useToast'
import styles from './ApplyDemandModal.module.css'

interface ApplyDemandModalProps {
  demand: MarketDemand | null
  onClose: () => void
  onApplied?: () => void
}

export default function ApplyDemandModal({ demand, onClose, onApplied }: ApplyDemandModalProps) {
  const { showToast } = useToast()
  const [message, setMessage] = useState('')
  const [quote, setQuote] = useState('')
  const [days, setDays] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!demand) return
    setMessage('')
    setQuote('')
    setDays('')
    setSubmitting(false)
  }, [demand])

  const handleSubmit = useCallback(async () => {
    if (!demand || submitting || !message.trim()) return
    setSubmitting(true)
    try {
      await applyToDemand(demand.id, {
        message,
        quoteYuan: Math.max(0, Number(quote) || 0),
        estimatedDays: Math.max(0, Number(days) || 0),
      })
      showToast('接单申请已提交，等待发布者确认', 'success')
      onApplied?.()
      onClose()
    } catch (error: any) {
      showToast(error?.message || '申请提交失败，请稍后重试', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [days, demand, message, onApplied, onClose, quote, showToast, submitting])

  if (!demand) return null

  return createPortal(
    <div className={styles.mask} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`申请接单：${demand.title}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 className={styles.title}>申请接单</h3>
        <p className={styles.demandTitle}>{demand.title}</p>
        <textarea
          className={styles.message}
          value={message}
          maxLength={500}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="向发布者介绍你的优势与制作思路..."
          aria-label="申请留言"
        />
        <div className={styles.row}>
          <label>
            <span>报价</span>
            <span className={styles.suffixInput}>
              <input
                type="number"
                min={0}
                value={quote}
                onChange={(event) => setQuote(event.target.value)}
                placeholder="0"
              />
              <em>元</em>
            </span>
          </label>
          <label>
            <span>预计天数</span>
            <span className={styles.suffixInput}>
              <input
                type="number"
                min={0}
                value={days}
                onChange={(event) => setDays(event.target.value)}
                placeholder="3"
              />
              <em>天</em>
            </span>
          </label>
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={styles.submit}
            disabled={!message.trim() || submitting}
            onClick={handleSubmit}
          >
            {submitting ? '提交中…' : '提交申请'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
