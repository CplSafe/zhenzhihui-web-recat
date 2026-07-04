/**
 * CreateTeamDialog — 创建团队弹窗
 * 创建新工作空间/团队，填写名称，创建成功后展示邀请码供成员加入。
 */
import { useEffect, useMemo, useState } from 'react'
import envelopeImg from '@/img/xinfeng.png'
import copyIcon from '@/img/image.png'
import { useToast } from '@/composables/useToast'
import './CreateTeamDialog.css'

interface CreateTeamGeneratePayload {
  name: string
}

interface CreateTeamDialogProps {
  open?: boolean
  loading?: boolean
  inviteCode?: string
  onClose?: () => void
  onGenerateInvite?: (payload: CreateTeamGeneratePayload) => void
  onSubmit?: () => void
}

function formatInviteCodeForDisplay(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.includes(' ') || raw.includes('-')) return raw
  const upper = raw.toUpperCase()
  if (/^[A-Z0-9]{8}$/.test(upper)) return `${upper.slice(0, 4)} ${upper.slice(4)}`
  return raw
}

export default function CreateTeamDialog(props: CreateTeamDialogProps) {
  const { open = false, loading = false, inviteCode = '' } = props
  const { showToast } = useToast()

  const [teamName, setTeamName] = useState('')
  const [inviteCodeDisplay, setInviteCodeDisplay] = useState('')

  const teamNameTrimmed = useMemo(() => teamName.trim(), [teamName])
  const teamNameCount = teamName.length
  const inviteCodePlain = useMemo(() => inviteCodeDisplay.replace(/\s+/g, '').trim(), [inviteCodeDisplay])
  const canSubmit = Boolean(teamNameTrimmed) && Boolean(inviteCodePlain) && !loading

  // 打开时重置名称与显示邀请码。
  useEffect(() => {
    if (!open) return
    setTeamName('')
    setInviteCodeDisplay('')
  }, [open])

  // 父级传入 inviteCode 变化时，格式化显示。
  useEffect(() => {
    const value = String(inviteCode || '').trim()
    setInviteCodeDisplay(value ? formatInviteCodeForDisplay(value) : '')
  }, [inviteCode])

  // Esc 关闭。
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) props.onClose?.()
    }
    document.addEventListener('keydown', onKeydown)
    return () => document.removeEventListener('keydown', onKeydown)
  }, [open, props])

  function requestInviteCode() {
    if (loading) return
    if (!teamNameTrimmed) {
      showToast('请输入团队名称', 'error')
      return
    }
    props.onGenerateInvite?.({
      name: teamNameTrimmed,
    })
  }

  async function copyInviteCode() {
    const value = String(inviteCode || '').replace(/\s+/g, '').trim() || inviteCodePlain
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      showToast('复制成功', 'success')
    } catch {
      showToast('复制失败，请手动复制', 'error')
    }
  }

  function submit() {
    if (!canSubmit) return
    props.onSubmit?.()
  }

  if (!open) return null

  return (
    <div className="ct-scrim" onClick={() => props.onClose?.()}>
      <section
        className="ct-panel"
        role="dialog"
        aria-modal="true"
        aria-label="创建团队"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ct-head">
          <strong>创建团队</strong>
          <p>创建您的团队，邀请成员一起协作</p>
        </header>

        <div className="ct-body">
          <div className="ct-form">
            <div className="ct-field">
              <span>团队名称</span>
              <div className="ct-input">
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  type="text"
                  disabled={loading}
                  maxLength={20}
                  placeholder="为你的团队起个名字"
                />
                <em>{teamNameCount}/20</em>
              </div>
            </div>

            <div className="ct-invite-card" aria-label="邀请码区域">
              <img className="ct-envelope-img" src={envelopeImg} alt="" />
              {!inviteCodeDisplay ? (
                <button
                  type="button"
                  className="ct-invite-overlay"
                  disabled={loading}
                  onClick={requestInviteCode}
                >
                  点击生成邀请码 →
                </button>
              ) : (
                <span className="ct-envelope-code">{inviteCodeDisplay}</span>
              )}
            </div>

            {inviteCodeDisplay && (
              <div className="ct-invite-result" aria-label="已生成邀请码">
                <div className="ct-invite-hint">您的团队邀请码已生成</div>
                <div className="ct-invite-row">
                  <strong>{inviteCodeDisplay}</strong>
                  <button
                    type="button"
                    className="ct-copy-btn"
                    aria-label="复制邀请码"
                    onClick={copyInviteCode}
                  >
                    <img className="ct-copy-icon" src={copyIcon} alt="" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="ct-foot">
          <button type="button" className="ct-submit" disabled={!canSubmit} onClick={submit}>
            {loading ? '创建中…' : '确定创建'}
          </button>
        </footer>
      </section>
    </div>
  )
}
