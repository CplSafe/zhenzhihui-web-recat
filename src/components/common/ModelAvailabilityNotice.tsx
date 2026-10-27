import { useEffect, useState } from 'react'
import { getSubscription } from '@/api/business'
import { useModelAvailabilityAccess } from './ModelAvailabilityProvider'
import { openMemberCenter } from '@/stores/ui'
import { emptyModelMessage, membershipAction, teamModelMessage } from '@/utils/modelAvailability'
import styles from './ModelAvailabilityNotice.module.css'

export function useModelNotice(message: string) {
  const { canPurchase, team } = useModelAvailabilityAccess()
  return {
    message: team ? teamModelMessage(message, canPurchase) : message,
    action: canPurchase ? membershipAction(message) : null,
  }
}

/** 供独立的音频、超分和图片工具空状态查询当前空间订阅；失败不推断付费原因。 */
export function EmptyModelNotice({
  workspaceId,
  label,
  onReload,
}: {
  workspaceId: number
  label: string
  onReload?: () => void
}) {
  const [result, setResult] = useState<{ workspaceId: number; subscription: any } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const subscription = await getSubscription(workspaceId)
        if (alive) setResult({ workspaceId, subscription })
      } catch {
        if (alive) setResult({ workspaceId, subscription: undefined })
      }
    })()
    return () => {
      alive = false
    }
  }, [workspaceId, attempt])
  const message = emptyModelMessage(label, result?.workspaceId === workspaceId ? result.subscription : undefined)
  return (
    <ModelAvailabilityPanel
      message={message}
      onReload={() => {
        setAttempt((value) => value + 1)
        onReload?.()
      }}
    />
  )
}

export function ModelAvailabilityPanel({ message, onReload }: { message: string; onReload?: () => void }) {
  return (
    <div role="status" className={styles.notice}>
      <ModelAvailabilityNotice message={message} />
      {onReload && (
        <button type="button" onClick={onReload}>
          刷新权益与模型
        </button>
      )}
    </div>
  )
}

export default function ModelAvailabilityNotice({ message }: { message: string }) {
  const notice = useModelNotice(message)
  return (
    <span className={styles.content}>
      <span>{notice.message}</span>
      {notice.action && (
        <button type="button" onClick={() => openMemberCenter()}>
          {notice.action === 'renew' ? '续费 / 购买会员' : '查看会员'}
        </button>
      )}
    </span>
  )
}
