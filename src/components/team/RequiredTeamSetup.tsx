import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Modal } from 'antd'
import { completeTeamSetup, getBusinessErrorMessage } from '@/api/business'
import { getAuthenticatedSession, resetAuthenticatedSession } from '@/api/auth'
import { useAuth } from '@/auth/AuthContext'

/** Server-backed onboarding: no local dismissal flag; reload keeps the gate open. */
export default function RequiredTeamSetup({ userId }: { userId: number }) {
  const { handleLoginSuccess } = useAuth()
  const nameId = useId()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  async function submit() {
    if (submitting.current || !name.trim()) return
    submitting.current = true
    setBusy(true)
    setError('')
    let completed = false
    try {
      await completeTeamSetup({ name })
      if (!active.current) return
      resetAuthenticatedSession()
      const session = await getAuthenticatedSession()
      if (!active.current) return
      if (String(session?.user?.id) !== String(userId) || session?.user?.team_setup_required !== false) {
        throw new Error('团队状态尚未确认，请重试或刷新页面')
      }
      completed = true
      handleLoginSuccess(session)
    } catch (cause) {
      if (active.current) setError(getBusinessErrorMessage(cause, '团队创建未完成，请重试'))
    } finally {
      if (!completed) {
        submitting.current = false
        if (active.current) setBusy(false)
      }
    }
  }

  return (
    <Modal
      open
      aria-label="创建你的团队空间"
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={null}
      centered
      zIndex={10000}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <label htmlFor={nameId} style={{ display: 'block', marginBottom: 8 }}>
            团队名称（必填）
          </label>
          <Input
            id={nameId}
            required
            aria-label="团队名称"
            autoFocus
            maxLength={128}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            placeholder="请输入团队名称"
          />
        </div>
        {error && (
          <p role="alert" style={{ color: '#b42318', marginBottom: 16 }}>
            {error}
          </p>
        )}
        <Button type="primary" htmlType="submit" block loading={busy} disabled={!name.trim()}>
          创建团队并继续
        </Button>
      </form>
    </Modal>
  )
}
