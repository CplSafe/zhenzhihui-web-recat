/**
 * AuthActionModal — 登录页的三个认证弹窗(复用一套表单):
 *  - register     注册新用户:手机号 + 密码 + 验证码(purpose=register)。已注册(code 10401)→ 引导直接登录。
 *  - forgot       重置密码:手机号 + 新密码 + 验证码(purpose=reset_password)→ 成功后重新登录。
 *  - sms-register 验证码登录时手机号未注册:仅要求设置密码(可不填),复用登录时输入的验证码完成注册并登录。
 *
 * 成功后由父级接管:register/sms-register → onAuthed(走 OAuth 桥接登录);forgot → onResetDone(切回登录)。
 */
import { useEffect, useRef, useState } from 'react'
import {
  getAuthErrorMessage,
  getCaptcha,
  isCaptchaChallengeError,
  registerAccount,
  resetPassword,
  sendAuthSms,
} from '@/api/auth'
import { useToast } from '@/composables/useToast'
import { getInviteCode, getInviteType, clearInviteCode } from '@/utils/inviteCode'
import './AuthActionModal.css'

/** 弹窗支持的注册、找回密码和短信登录补注册三种业务模式。 */
export type AuthActionMode = 'register' | 'forgot' | 'sms-register'

/** 不同认证模式共用的输入上下文和完成回调。 */
interface AuthActionModalProps {
  mode: AuthActionMode
  /** 覆盖默认标题(如登录态下「修改密码」复用 forgot 流程) */
  title?: string
  /** 父级共享的 authStart 获取(注册/重置用其 client_id/return_to,并供后续 OAuth 桥接) */
  ensureAuthStart: () => Promise<any>
  /** sms-register:复用登录时已生成的 authStart(其 state 与登录一致),以及预填手机号/验证码 */
  authStart?: any
  prefill?: { mobile?: string; smsCode?: string }
  /** 锁定手机号为只读(登录态下「修改密码」已知手机号,不允许改) */
  lockMobile?: boolean
  onClose: () => void
  /** 注册/补全注册成功 → 父级走登录流程(OAuth 桥接);forgot 模式不需要 */
  onAuthed?: (authStart: any, result: any) => void
  /** 重置密码成功 → 父级切回登录并预填手机号 */
  onResetDone?: (mobile: string) => void
  /** 注册时发现已注册 → 父级引导直接登录(切到密码登录并预填手机号) */
  onAlreadyRegistered?: (mobile: string) => void
}

/** 各认证模式的弹窗标题。 */
const TITLES: Record<AuthActionMode, string> = {
  register: '注册新用户',
  forgot: '重置密码',
  'sms-register': '完善账号信息',
}

// 密码可不填(sms-register)时,后台仍要求密码字段:生成一个满足复杂度的随机密码,用户后续可用「忘记密码」重置。
/** 为短信补注册生成满足后端规则的临时密码，避免要求用户重复输入。 */
function randomPassword(): string {
  const s = Math.random().toString(36).slice(2, 10)
  return `Zzh${s.charAt(0).toUpperCase()}${s.slice(1)}8`
}

/** 根据认证模式复用手机号、验证码和密码表单，并把认证成功结果交还登录页。 */
export default function AuthActionModal({
  mode,
  title,
  ensureAuthStart,
  authStart,
  prefill,
  lockMobile,
  onClose,
  onAuthed,
  onResetDone,
  onAlreadyRegistered,
}: AuthActionModalProps) {
  const { showToast } = useToast()
  const [mobile, setMobile] = useState(prefill?.mobile || '')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [captcha, setCaptcha] = useState({ id: '', image: '', answer: '' })
  const [resendAfter, setResendAfter] = useState<Record<string, number>>({})
  const [clock, setClock] = useState(Date.now)
  const [sentMobile, setSentMobile] = useState('')
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [err, setErr] = useState('')
  const [alreadyReg, setAlreadyReg] = useState(false) // 注册时发现手机号已注册 → 红字提示+去登录
  const aliveRef = useRef(true)
  const sendingRef = useRef(false)
  const submittingRef = useRef(false)
  const mobileInputRef = useRef<HTMLInputElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const needsMobileInput = mode !== 'sms-register'
  const mobileLocked = mode === 'sms-register' || !!lockMobile // 只读手机号
  const needsCodeInput = mode !== 'sms-register' // sms-register 复用登录时的验证码
  const pwdRequired = mode !== 'sms-register' // sms-register 密码可不填
  const smsPurpose = mode === 'forgot' ? 'reset_password' : 'register'
  const pwdLabel = mode === 'forgot' ? '新密码' : mode === 'sms-register' ? '设置密码(可不填)' : '密码'
  const submitLabel = mode === 'forgot' ? '重置密码' : mode === 'sms-register' ? '完成并登录' : '注册'
  const isRegistration = mode === 'register'
  const normalizedMobile = mobile.replace(/\s/g, '')
  const mobileValid = /^1\d{10}$/.test(normalizedMobile)
  const cooldownKey = isRegistration ? normalizedMobile : ''
  const resendDeadline = resendAfter[cooldownKey] || 0
  const countdown = Math.max(0, Math.ceil((resendDeadline - clock) / 1000))
  const canRegister =
    mobileValid && sentMobile === normalizedMobile && !!password.trim() && !!code.trim() && !alreadyReg
  const registrationBlocked = isRegistration && (sending || !canRegister)

  useEffect(() => {
    aliveRef.current = true
    ;(mobileLocked ? passwordInputRef : mobileInputRef).current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      aliveRef.current = false
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [mobileLocked])

  const coolingDown = countdown > 0
  useEffect(() => {
    if (!coolingDown) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [coolingDown, resendDeadline])

  const refreshCaptcha = async () => {
    try {
      const c: any = await getCaptcha()
      if (!aliveRef.current) return
      setCaptcha({ id: c?.id || '', image: c?.image || '', answer: '' })
    } catch {
      /* ignore */
    }
  }
  const handleCaptchaErr = async (e: any) => {
    if (!isCaptchaChallengeError(e)) return false
    await refreshCaptcha()
    if (!aliveRef.current) return true
    setErr('请输入图形验证码')
    return true
  }

  const sendCode = async () => {
    if (resendDeadline > Date.now() || sendingRef.current || (isRegistration && submittingRef.current)) return
    const m = normalizedMobile
    if (!m) return setErr('请输入手机号')
    if (!mobileValid) return setErr('请输入正确的手机号')
    if (captcha.image && !captcha.answer.trim()) return setErr('请输入图形验证码')
    sendingRef.current = true
    setSending(true)
    setErr('')
    try {
      const as = await ensureAuthStart()
      if (!aliveRef.current) return
      await sendAuthSms({
        authStart: as,
        mobile: m,
        purpose: smsPurpose,
        captchaId: captcha.id,
        captchaAnswer: captcha.answer.trim(),
      })
      if (!aliveRef.current) return
      const now = Date.now()
      setClock(now)
      setResendAfter((previous) => ({ ...previous, [cooldownKey]: now + 60_000 }))
      if (isRegistration) setSentMobile(m)
      showToast('验证码已发送', 'success')
    } catch (e: any) {
      if (!aliveRef.current) return
      if (await handleCaptchaErr(e)) return
      if (isRegistration && Number(e?.code) === 10401) {
        setAlreadyReg(true)
        return
      }
      setErr(getAuthErrorMessage(e, '验证码发送失败,请稍后重试'))
    } finally {
      sendingRef.current = false
      if (aliveRef.current) setSending(false)
    }
  }

  const submit = async () => {
    if (submittingRef.current || (isRegistration && (sendingRef.current || !canRegister))) return
    setErr('')
    const m = (needsMobileInput ? mobile : prefill?.mobile || '').replace(/\s/g, '')
    if (needsMobileInput && !m) return setErr('请输入手机号')
    if (needsMobileInput && !/^1\d{10}$/.test(m)) return setErr('请输入正确的手机号')
    if (pwdRequired && !password.trim()) return setErr(mode === 'forgot' ? '请输入新密码' : '请输入密码')
    if (needsCodeInput && !code.trim()) return setErr('请输入验证码')
    submittingRef.current = true
    setSubmitting(true)
    try {
      const as = authStart || (await ensureAuthStart())
      if (!aliveRef.current) return
      if (mode === 'forgot') {
        await resetPassword({ authStart: as, mobile: m, newPassword: password.trim(), smsCode: code.trim() })
        if (!aliveRef.current) return
        showToast('重置密码成功,可重新登录', 'success')
        onResetDone?.(m)
        onClose()
        return
      }
      // 注册与短信补注册成功后都交回登录页完成统一 OAuth 桥接。
      const pwd = password.trim() || (mode === 'sms-register' ? randomPassword() : '')
      const smsCode = needsCodeInput ? code.trim() : prefill?.smsCode || ''
      const inviteCode = getInviteCode()
      const inviteType = inviteCode ? getInviteType() : ''
      const result = await registerAccount({
        authStart: as,
        mobile: m,
        password: pwd,
        smsCode,
        termsAccepted: true,
        inviteCode, // 分享链接带来的推广码(空则接口层去掉)
        inviteType,
      })
      if (!aliveRef.current) return
      clearInviteCode() // 注册成功即清除,避免后续误归因
      showToast(mode === 'sms-register' ? '注册成功,正在登录…' : '注册成功', 'success')
      onAuthed?.(as, result)
      onClose()
    } catch (e: any) {
      if (!aliveRef.current) return
      if (await handleCaptchaErr(e)) {
        return
      }
      // 注册:该手机号已注册 → 弹窗内红字提示并提供「去登录」入口(不关闭弹窗)
      if (mode === 'register' && Number(e?.code) === 10401) {
        setAlreadyReg(true)
        return
      }
      // sms-register:复用的登录验证码若不被注册接口接受 → 引导改用注册
      if (mode === 'sms-register' && Number(e?.code) === 10003) {
        setErr('验证码已失效,请关闭后用「免费注册」重新获取验证码注册')
      } else {
        setErr(getAuthErrorMessage(e, mode === 'forgot' ? '重置失败,请重试' : '注册失败,请重试'))
      }
    } finally {
      submittingRef.current = false
      if (aliveRef.current) setSubmitting(false)
    }
  }

  return (
    <div className="zauth-mask" onClick={onClose}>
      <div
        className="zauth-card"
        role="dialog"
        aria-modal="true"
        aria-label={title ?? TITLES[mode]}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="zauth-x" aria-label="关闭" onClick={onClose}>
          ×
        </button>
        <h2 className="zauth-title">{title ?? TITLES[mode]}</h2>
        {mode === 'sms-register' && (
          <p className="zauth-sub">该手机号未注册,设置密码即完成注册并登录(密码可不填,后续可用「忘记密码」设置)</p>
        )}

        <div className="zauth-fields">
          {!mobileLocked ? (
            <div className="zauth-field">
              <input
                ref={mobileInputRef}
                aria-label="手机号"
                type="tel"
                inputMode="numeric"
                placeholder="手机号"
                value={mobile}
                readOnly={isRegistration && (sending || submitting)}
                onChange={(e) => {
                  const next = e.target.value
                  if (isRegistration && next.replace(/\s/g, '') !== normalizedMobile) {
                    setCode('')
                    setClock(Date.now())
                    setCaptcha({ id: '', image: '', answer: '' })
                  }
                  setMobile(next)
                  setErr('')
                  setAlreadyReg(false) // 改手机号 → 清掉「已注册」提示
                }}
              />
            </div>
          ) : (
            <div className="zauth-static" aria-label="手机号">
              <span className="zauth-static-label">手机号</span>
              <span className="zauth-static-val">{mobile || prefill?.mobile || ''}</span>
            </div>
          )}

          <div className="zauth-field">
            <input
              ref={passwordInputRef}
              aria-label={pwdLabel}
              type={showPwd ? 'text' : 'password'}
              placeholder={pwdLabel}
              value={password}
              autoComplete="new-password"
              onChange={(e) => {
                setPassword(e.target.value)
                setErr('')
              }}
            />
            <button
              type="button"
              className="zauth-eye"
              aria-label={showPwd ? '隐藏密码' : '显示密码'}
              aria-pressed={showPwd}
              onClick={() => setShowPwd((v) => !v)}
            >
              {showPwd ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {needsCodeInput && (
            <div className="zauth-field">
              <input
                aria-label="验证码"
                type="text"
                inputMode="numeric"
                placeholder="验证码"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value)
                  setErr('')
                }}
              />
              <button
                type="button"
                className="zauth-code-btn"
                disabled={coolingDown || sending || (isRegistration && submitting)}
                onClick={sendCode}
              >
                {sending ? '发送中…' : countdown > 0 ? `${countdown}s后重发` : '获取验证码'}
              </button>
            </div>
          )}

          {captcha.image && (
            <div className="zauth-field">
              <input
                aria-label="图形验证码"
                type="text"
                placeholder="图形验证码"
                value={captcha.answer}
                onChange={(e) => {
                  setCaptcha((p) => ({ ...p, answer: e.target.value }))
                  setErr('')
                }}
              />
              <button
                type="button"
                className="zauth-captcha-button"
                aria-label="刷新图形验证码"
                onClick={refreshCaptcha}
              >
                <img className="zauth-captcha" src={captcha.image} alt="" />
              </button>
            </div>
          )}
        </div>

        {alreadyReg ? (
          <span className="zauth-err">
            该手机号已注册,请
            <button
              type="button"
              className="zauth-inline-link"
              onClick={() => onAlreadyRegistered?.((mobile || prefill?.mobile || '').replace(/\s/g, ''))}
            >
              直接登录
            </button>
          </span>
        ) : (
          err && <span className="zauth-err">{err}</span>
        )}

        <button type="button" className="zauth-submit" disabled={submitting || registrationBlocked} onClick={submit}>
          {submitting ? '处理中…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
