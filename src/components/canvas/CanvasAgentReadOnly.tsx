import { Button } from 'antd'
import { useState } from 'react'
import type { CanvasAgentLock } from '@/composables/useCanvasNodeLocks'
import './CanvasAgentReadOnly.css'

export default function CanvasAgentReadOnly({
  owner,
  lock,
  onUnlock,
}: {
  owner: string
  lock?: CanvasAgentLock
  onUnlock: (id: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function unlock() {
    if (!lock || lock.running || busy) return
    setBusy(true)
    setError('')
    try {
      await onUnlock(lock.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '解锁失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <aside className="canvas-agent-readonly" aria-label="画布只读状态">
      <span role="status">{owner} 已锁定画布 · 当前只读，可平移、缩放查看</span>
      {lock?.can_unlock && (
        <Button size="small" disabled={lock.running} loading={busy} onClick={() => void unlock()}>
          管理员解锁
        </Button>
      )}
      {error && <span role="alert">{error}</span>}
    </aside>
  )
}
