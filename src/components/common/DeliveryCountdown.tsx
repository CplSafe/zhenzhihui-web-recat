import { useEffect, useState } from 'react'
import { deliveryDeadline, deliveryTimeParts, formatDeliveryTime } from '@/utils/deliveryCountdown'
import styles from './DeliveryCountdown.module.css'

export function DeliveryCountdown({
  kind,
  createdAt,
  deadlineAt,
  promisedDate,
  compact = false,
}: {
  kind: 't1' | 't5'
  createdAt?: string | null
  deadlineAt?: string | null
  promisedDate?: string | null
  compact?: boolean
}) {
  const deadline = deliveryDeadline(kind, createdAt, deadlineAt, promisedDate)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (deadline === null) return
    const update = () => setNow(Date.now())
    update()
    const timer = window.setInterval(update, 1000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [deadline])
  if (deadline === null) return <span className={styles.pending}>交付时间待确认</span>
  const time = deliveryTimeParts(deadline, now)
  const parts = formatDeliveryTime(kind, time)
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(deadline)
  return (
    <span className={`${styles.countdown} ${compact ? styles.compact : ''}`} role="timer" aria-live="off">
      <span className={time.overdue ? styles.overdue : undefined}>{time.overdue ? '已逾期' : '成片将于'}</span>
      <span className={styles.units}>
        {parts.map((part, index) =>
          /^\d+$/.test(part) ? (
            <span className={styles.number} key={index}>
              {part}
            </span>
          ) : (
            <span key={index}>{part}</span>
          ),
        )}
      </span>
      {!time.overdue && <span>之内完成交付</span>}
      {!compact && <span className={styles.deadline}>截止时间：{date}（北京时间）</span>}
    </span>
  )
}
