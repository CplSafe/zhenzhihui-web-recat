import { useState } from 'react'
import { leaveAccountSwitch } from '@/api/viewAsUser'

export default function AccountSwitchBanner({ name, expired = false }: { name?: string; expired?: boolean }) {
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')

  const leave = async () => {
    setLeaving(true)
    setError('')
    try {
      await leaveAccountSwitch()
    } catch {
      setError('暂时无法退出切换，请重试。')
      setLeaving(false)
    }
  }

  return (
    <section
      className={`account-switch-banner${expired ? ' account-switch-banner--expired' : ''}`}
      aria-label="用户身份切换"
    >
      <div className="account-switch-banner__identity">
        <strong>{expired ? '用户身份切换已失效' : name ? `当前以 ${name} 的身份操作` : '用户身份切换'}</strong>
        {error && <span role="alert">{error}</span>}
      </div>
      <button type="button" onClick={() => void leave()} disabled={leaving}>
        {leaving ? '正在退出…' : '退出身份切换'}
      </button>
    </section>
  )
}
