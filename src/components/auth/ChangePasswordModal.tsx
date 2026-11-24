/**
 * ChangePasswordModal — 登录态下「修改密码」独立弹窗(不复用注册/找回的 AuthActionModal)。
 * 预填可用的手机号，由用户填写新密码和短信验证码，走公开找回密码接口完成改密。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  getAuthErrorMessage,
  getCaptcha,
  getCurrentUser,
  isCaptchaChallengeError,
  resetPassword,
  sendAuthSms,
} from '@/api/auth'
import { useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { useAuthSmsCooldown } from '@/composables/useAuthSmsCooldown'
import { useToast } from '@/composables/useToast'
import './ChangePasswordModal.css'

/** 归一化手机号：去格式符与国家码，只接受有效的 11 位中国大陆手机号。 */
function normalizeMobile(raw: any): string {
  let s = String(raw ?? '').trim()
  if (!s) return ''
  s = s.replace(/[\s\-()]/g, '').replace(/^\+?86/, '')
  return /^1\d{10}$/.test(s) ? s : ''
}

// 递归深搜会话/用户对象里任意名为 mobile/phone/tel 的字段(/me 的 domain.User.mobile 可能在顶层或嵌套)
/** 兼容不同认证响应结构，从常见字段中提取手机号。 */
function pickMobile(obj: any): string {
  if (!obj || typeof obj !== 'object') return ''
  const seen = new Set<any>()
  const stack: any[] = [obj]
  while (stack.length) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue
    seen.add(cur)
    for (const [k, v] of Object.entries(cur)) {
      if (v && typeof v === 'object') {
        stack.push(v)
        continue
      }
      if (/mobile|phone|tel/i.test(k)) {
        const m = normalizeMobile(v)
        if (m) return m
      }
    }
  }
  return ''
}

/** 在登录态下完成验证码校验与密码重置，并在成功后关闭弹窗。 */
export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { showToast } = useToast()
  const session = useWorkspaceSessionStore((s) => s.authSession)
  const [mobile, setMobile] = useState(() => pickMobile(session))
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [captcha, setCaptcha] = useState({ id: '', image: '', answer: '' })
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const aliveRef = useRef(true)
  const sendingRef = useRef(false)
  const submittingRef = useRef(false)
  const mobileEditedRef = useRef(false)
  const currentMobileRef = useRef(mobile)
  const mobileInputRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const { remainingSeconds: countdown, markSent } = useAuthSmsCooldown(mobile)

  useEffect(() => {
    aliveRef.current = true
    mobileInputRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      aliveRef.current = false
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // 会话里没拿到手机号时,拉一次 /api/v1/me 兜底
  useEffect(() => {
    if (mobile) return
    let cancelled = false
    getCurrentUser()
      .then((me: any) => {
        if (cancelled || mobileEditedRef.current) return
        const m = pickMobile(me)
        if (m) {
          currentMobileRef.current = m
          setMobile(m)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshCaptcha = async (target = currentMobileRef.current) => {
    try {
      const c: any = await getCaptcha()
      if (!aliveRef.current || currentMobileRef.current !== target) return
      setCaptcha({ id: c?.id || '', image: c?.image || '', answer: '' })
    } catch {
      /* ignore */
    }
  }

  const sendCode = async () => {
    if (countdown > 0 || sendingRef.current || submittingRef.current) return
    if (!/^1\d{10}$/.test(mobile)) return setErr('请输入正确的手机号')
    if (captcha.image && !captcha.answer.trim()) return setErr('请输入图形验证码')
    sendingRef.current = true
    setSending(true)
    setErr('')
    try {
      await sendAuthSms({
        authStart: null,
        mobile,
        purpose: 'reset_password',
        captchaId: captcha.id,
        captchaAnswer: captcha.answer.trim(),
      })
      if (!aliveRef.current) return
      markSent(mobile)
      if (currentMobileRef.current === mobile) showToast('验证码已发送', 'success')
    } catch (e: any) {
      if (!aliveRef.current || currentMobileRef.current !== mobile) return
      if (isCaptchaChallengeError(e)) {
        await refreshCaptcha(mobile)
        if (!aliveRef.current || currentMobileRef.current !== mobile) return
        setErr('请输入图形验证码')
      } else {
        setErr(getAuthErrorMessage(e, '验证码发送失败,请稍后重试'))
      }
    } finally {
      sendingRef.current = false
      if (aliveRef.current) setSending(false)
    }
  }

  const submit = async () => {
    if (submittingRef.current || sendingRef.current) return
    setErr('')
    if (!/^1\d{10}$/.test(mobile)) return setErr('请输入正确的手机号')
    if (!password.trim()) return setErr('请输入新密码')
    if (!code.trim()) return setErr('请输入验证码')
    submittingRef.current = true
    setSubmitting(true)
    try {
      await resetPassword({ authStart: null, mobile, newPassword: password.trim(), smsCode: code.trim() })
      if (!aliveRef.current) return
      showToast('密码修改成功,下次请用新密码登录', 'success')
      onClose()
    } catch (e: any) {
      if (!aliveRef.current) return
      if (isCaptchaChallengeError(e)) {
        await refreshCaptcha(mobile)
        if (!aliveRef.current || currentMobileRef.current !== mobile) return
        setErr('请输入图形验证码')
      } else {
        setErr(getAuthErrorMessage(e, '修改失败,请重试'))
      }
    } finally {
      submittingRef.current = false
      if (aliveRef.current) setSubmitting(false)
    }
  }

  return createPortal(
    <div
      className="cpw-mask"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="cpw-card" role="dialog" aria-modal="true" aria-label="修改密码">
        <button type="button" className="cpw-x" aria-label="关闭" onClick={onClose}>
          ×
        </button>
        <h2 className="cpw-title">修改密码</h2>

        <div className="cpw-fields">
          {/* 手机号:后端 /me 暂未返回手机号,改由用户输入(若能取到则自动预填) */}
          <div className="cpw-field">
            <input
              ref={mobileInputRef}
              aria-label="手机号"
              type="tel"
              inputMode="numeric"
              placeholder="手机号"
              value={mobile}
              readOnly={submitting}
              onChange={(e) => {
                mobileEditedRef.current = true
                const next = e.target.value.replace(/\D/g, '').slice(0, 11)
                if (currentMobileRef.current !== next) {
                  setCode('')
                  setCaptcha({ id: '', image: '', answer: '' })
                }
                currentMobileRef.current = next
                setMobile(next)
                setErr('')
              }}
            />
          </div>

          {/* 新密码 */}
          <div className="cpw-field">
            <input
              aria-label="新密码"
              type={showPwd ? 'text' : 'password'}
              placeholder="新密码"
              value={password}
              autoComplete="new-password"
              onChange={(e) => {
                setPassword(e.target.value)
                setErr('')
              }}
            />
            <button
              type="button"
              className="cpw-eye"
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

          {/* 短信验证码 */}
          <div className="cpw-field">
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
              className="cpw-code-btn"
              disabled={countdown > 0 || sending || submitting || !/^1\d{10}$/.test(mobile)}
              onClick={sendCode}
            >
              {sending ? '发送中…' : countdown > 0 ? `${countdown}s后重发` : '获取验证码'}
            </button>
          </div>

          {/* 图形验证码(仅风控触发时出现) */}
          {captcha.image && (
            <div className="cpw-field">
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
                className="cpw-captcha-button"
                aria-label="刷新图形验证码"
                onClick={() => void refreshCaptcha()}
              >
                <img className="cpw-captcha" src={captcha.image} alt="" />
              </button>
            </div>
          )}
        </div>

        {err && <span className="cpw-err">{err}</span>}

        <button type="button" className="cpw-submit" disabled={submitting || sending} onClick={submit}>
          {submitting ? '提交中…' : '确认修改'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
