import { Button, Modal } from 'antd'
import { useState } from 'react'
import type { CanvasAgentLock } from '@/composables/useCanvasNodeLocks'
import { useNavigate } from 'react-router-dom'

export default function CanvasAgentReadOnly({
  owner,
  lock,
  onUnlock,
}: {
  owner: string
  lock?: CanvasAgentLock
  onUnlock: (id: string) => Promise<void>
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function unlock() {
    if (!lock || busy) return
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
    <Modal
      open
      centered
      closable={false}
      keyboard={false}
      maskClosable={false}
      zIndex={3000}
      title={`${owner} 已锁定画布`}
      footer={
        <>
          <Button onClick={() => navigate('/canvas?manage=1')}>返回画布列表</Button>
          {lock?.can_unlock && (
            <Button disabled={lock.running} loading={busy} onClick={() => void unlock()}>
              管理员解锁
            </Button>
          )}
        </>
      }
    >
      <p>画布和会话已锁定，需由锁定人或管理员明确解锁后才能继续创作。</p>
      {lock?.running && <p>Agent 仍在运行，请先暂停或等待本轮结束后解锁。</p>}
      {error && <p role="alert">{error}</p>}
    </Modal>
  )
}
