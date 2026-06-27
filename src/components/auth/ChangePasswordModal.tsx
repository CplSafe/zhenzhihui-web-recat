/**
 * ChangePasswordModal — 登录态下「修改密码」独立弹窗(不复用注册/找回的 AuthActionModal)。
 * 取当前用户手机号(只读展示,不可改)+ 新密码 + 短信验证码,走公开找回密码接口完成改密。
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
import { useToast } from '@/composables/useToast'
import './ChangePasswordModal.css'

// 归一化:去空格/连字符/括号、去国家码 +86,得到 11 位手机号(失败返回'')
function normalizeMobile(raw: any): string {
  let s = String(raw ?? '').trim()
  if (!s) return ''
  s = s.replace(/[\s\-()]/g, '').replace(/^\+?86/, '')
  return /^1\d{10}$/.test(s) ? s : ''
}

// 递归深搜会话/用户对象里任意名为 mobile/phone/tel 的字段(/me 的 domain.User.mobile 可能在顶层或嵌套)
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

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { showToast } = useToast()
  const session = useWorkspaceSessionStore((s) => s.authSession)
  const [mobile, setMobile] = useState(() => pickMobile(session))
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [captcha, setCaptcha] = useState({ id: '', image: '', answer: '' })
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const timerRef = useRef<number | null>(null)

  // 会话里没拿到手机号时,拉一次 /api/v1/me 兜底
  useEffect(() => {
    if (mobile) return
    let cancelled = false
    getCurrentUser()
      .then((me: any) => {
        const m = pickMobile(me)
        if (!cancelled && m) setMobile(m)
        else if (import.meta.env.DEV && !m)
          // 仍取不到 → 打印 /me 原始返回,便于定位手机号字段路径
          console.debug('[修改密码] /me 未解析出手机号,原始返回:', me)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    },
    [],
  )

  const startCountdown = () => {
    setCountdown(60)
    timerRef.current = window.setInterval(() => {
      setCountdown((p) => {
        if (p <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current)
          return 0
        }
        return p - 1
      })
    }, 1000)
  }

  const refreshCaptcha = async () => {
    try {
      const c: any = await getCaptcha()
      setCaptcha({ id: c?.id || '', image: c?.image || '', answer: '' })
    } catch {
      /* ignore */
    }
  }

  const sendCode = async () => {
    if (countdown > 0 || sending) return
    if (!mobile) return setErr('未获取到当前账号手机号,无法发送验证码')
    if (captcha.image && !captcha.answer.trim()) return setErr('请输入图形验证码')
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
      startCountdown()
      showToast('验证码已发送', 'success')
    } catch (e: any) {
      if (isCaptchaChallengeError(e)) {
        await refreshCaptcha()
        setErr('请输入图形验证码')
      } else {
        setErr(getAuthErrorMessage(e, '验证码发送失败,请稍后重试'))
      }
    } finally {
      setSending(false)
    }
  }

  const submit = async () => {
    setErr('')
    if (!mobile) return setErr('未获取到当前账号手机号')
    if (!password.trim()) return setErr('请输入新密码')
    if (!code.trim()) return setErr('请输入验证码')
    setSubmitting(true)
    try {
      await resetPassword({ authStart: null, mobile, newPassword: password.trim(), smsCode: code.trim() })
      showToast('密码修改成功,下次请用新密码登录', 'success')
      onClose()
    } catch (e: any) {
      if (isCaptchaChallengeError(e)) {
        await refreshCaptcha()
        setErr('请输入图形验证码')
      } else {
        setErr(getAuthErrorMessage(e, '修改失败,请重试'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div
      className="cpw-mask"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="cpw-card" role="dialog" aria-label="修改密码">
        <button type="button" className="cpw-x" aria-label="关闭" onClick={onClose}>
          ×
        </button>
        <h2 className="cpw-title">修改密码</h2>

        <div className="cpw-fields">
          {/* 当前手机号:只读展示,不可编辑 */}
          <div className="cpw-mobile">
            <span className="cpw-mobile-label">当前手机号</span>
            <span className="cpw-mobile-val">{mobile || '未获取到手机号'}</span>
          </div>

          {/* 新密码 */}
          <div className="cpw-field">
            <input
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {/* 短信验证码 */}
          <div className="cpw-field">
            <input
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
              disabled={countdown > 0 || sending || !mobile}
              onClick={sendCode}
            >
              {sending ? '发送中…' : countdown > 0 ? `${countdown}s后重发` : '获取验证码'}
            </button>
          </div>

          {/* 图形验证码(仅风控触发时出现) */}
          {captcha.image && (
            <div className="cpw-field">
              <input
                type="text"
                placeholder="图形验证码"
                value={captcha.answer}
                onChange={(e) => {
                  setCaptcha((p) => ({ ...p, answer: e.target.value }))
                  setErr('')
                }}
              />
              <img className="cpw-captcha" src={captcha.image} alt="点击刷新图形验证码" onClick={refreshCaptcha} />
            </div>
          )}
        </div>

        {err && <span className="cpw-err">{err}</span>}

        <button type="button" className="cpw-submit" disabled={submitting} onClick={submit}>
          {submitting ? '提交中…' : '确认修改'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
