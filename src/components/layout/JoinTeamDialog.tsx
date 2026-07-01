/**
 * JoinTeamDialog — 加入团队弹窗
 * 输入邀请码加入已有工作空间/团队。
 */
import { useEffect, useMemo, useState } from 'react'
import joinTeamIcon from '@/img/image copy.png'
import './JoinTeamDialog.css'

interface JoinTeamSubmitPayload {
  inviteCode: string
}

interface JoinTeamDialogProps {
  open?: boolean
  loading?: boolean
  onClose?: () => void
  onSubmit?: (payload: JoinTeamSubmitPayload) => void
}

export default function JoinTeamDialog(props: JoinTeamDialogProps) {
  const { open = false, loading = false } = props

  const [inviteCode, setInviteCode] = useState('')

  const inviteCodeTrimmed = useMemo(() => inviteCode.trim(), [inviteCode])
  const canSubmit = Boolean(inviteCodeTrimmed) && !loading

  // 打开时重置输入。
  useEffect(() => {
    if (!open) return
    setInviteCode('')
  }, [open])

  // Esc 关闭。
  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && open) props.onClose?.()
    }
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [open, props])

  function submit() {
    if (!canSubmit) return
    props.onSubmit?.({
      inviteCode: inviteCodeTrimmed.replace(/\s+/g, ''),
    })
  }

  if (!open) return null

  return (
    <div className="jt-scrim" onClick={() => props.onClose?.()}>
      <section
        className="jt-panel"
        role="dialog"
        aria-modal="true"
        aria-label="加入新团队"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="jt-head">
          <img className="jt-icon" src={joinTeamIcon} alt="" />
          <div className="jt-heading">
            <h3>加入新团队</h3>
            <p>输入团队协作码即可加入团队空间</p>
          </div>
        </header>

        <div className="jt-body">
          <label className="jt-field">
            <span className="jt-label">邀请码</span>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="jt-input"
              type="text"
              disabled={loading}
              maxLength={32}
              placeholder="输入团队邀请码"
            />
          </label>

          <div className="jt-note">
            <p>团队邀请码通常由团队创建者分享给你</p>
            <p>加入后你可以查看团队项目、素材及成员</p>
          </div>
        </div>

        <footer className="jt-actions">
          <button
            type="button"
            className="jt-btn jt-btn-cancel"
            disabled={loading}
            onClick={() => props.onClose?.()}
          >
            取消
          </button>
          <button type="button" className="jt-btn jt-btn-confirm" disabled={!canSubmit} onClick={submit}>
            {loading ? '加入中...' : '确认加入'}
          </button>
        </footer>
      </section>
    </div>
  )
}
