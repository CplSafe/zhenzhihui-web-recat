/**
 * LoginView — 登录页（按 Figma「帧智汇 2.1」重构）
 * 左侧品牌大图 + 右侧表单。支持两种登录方式:
 *  - 账号密码登录(loginWithPassword)
 *  - 手机短信登录(loginWithSmsCode);未注册手机号经短信登录即完成注册
 * 保留图形验证码挑战、用户协议确认、OAuth start 等既有认证逻辑;移除扫码/SSO/独立注册页。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './LoginView.css'
import loginHero from '@/assets/login-hero.jpg'
import AgreementModal from '@/components/auth/AgreementModal'
import AuthActionModal, { type AuthActionMode } from '@/components/auth/AuthActionModal'
import {
  clearExistingSession,
  getAuthErrorMessage,
  getAuthNavigationUrl,
  getAuthenticatedSession,
  getCaptcha,
  isCaptchaChallengeError,
  loginWithPassword,
  loginWithSmsCode,
  markAuthSessionExpected,
  sendAuthSms,
  startOAuth,
} from '@/api/auth'
import { useAuth } from '@/auth/AuthContext'
import { useToast } from '@/composables/useToast'

interface CaptchaState {
  id: string
  image: string
  answer: string
}

const NAV_ITEMS = ['母婴宠物', '视频饮料', '生活服务', '家居建材']

export default function LoginView() {
  const navigate = useNavigate()
  // 「返回」写死:始终回到开屏页 /welcome。
  const goBack = () => {
    navigate('/welcome', { replace: true })
  }
  const { showToast, clearToast } = useToast()
  const { handleLoginSuccess } = useAuth()

  const hasRemoteBackend = Boolean(import.meta.env.VITE_ZZH_REMOTE_ORIGIN)

  const [loginMode, setLoginMode] = useState<'password' | 'sms'>('sms')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [captcha, setCaptcha] = useState<CaptchaState>({ id: '', image: '', answer: '' })
  const [agreed, setAgreed] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [codeCountdown, setCodeCountdown] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [loginErrors, setLoginErrors] = useState({ phone: '', password: '', code: '', captcha: '' })
  const [showAgreementModal, setShowAgreementModal] = useState(false)
  // 注册 / 重置密码 弹窗;以及「验证码登录时手机号未注册」触发的补全注册弹窗
  const [authModal, setAuthModal] = useState<AuthActionMode | null>(null)
  const [smsRegister, setSmsRegister] = useState<{ mobile: string; smsCode: string } | null>(null)

  // 'login' | 'view'：协议弹窗的来源上下文
  const agreementModalContextRef = useRef('login')
  const authStartRef = useRef<any>(null)
  const authStartPromiseRef = useRef<Promise<any> | null>(null)
  const codeTimerRef = useRef<number | null>(null)

  const credentialLabel = loginMode === 'password' ? '密码' : '验证码'
  const codeButtonText = codeCountdown > 0 ? `${codeCountdown}s后重发` : '获取验证码'

  function setNoticeMessage(message: string, type = 'info') {
    if (message) showToast(message, type as any, type === 'error' ? 5000 : 3000)
    else clearToast()
  }

  function clearLoginErrors() {
    setLoginErrors({ phone: '', password: '', code: '', captcha: '' })
  }
  function clearLoginError(field: string) {
    setLoginErrors((prev) => ({ ...prev, [field]: '' }))
  }

  function normalizeMobile(value: string) {
    return value.replace(/\s/g, '')
  }
  // 登录成功后的 SSO 回跳地址:直接落到首页。
  // 不能用 `${origin}/`,根路径会被路由重定向到开屏页 /welcome(详见 router/index.tsx 的 index 路由)。
  function getRedirectTo() {
    return `${window.location.origin}/home`
  }
  // 登录成功后获取会话进首页。业务会话需经 OAuth 回调建立(login 200 不一定直接下发 cookie)。
  // 策略:① 先直接重试取会话(cookie 已就绪即直接进);② 拿不到 → 用【隐藏 iframe 静默跑完 SSO 桥接】
  // (authorize 地址同源经代理,cookie 共享),期间轮询会话,全程不弹出 DeepAuth 页;
  // ③ 静默被拦/超时 → 兜底回退到可见重定向,保证一定能登录。
  async function handleLoginFlowComplete(oauth: any, authResult?: any) {
    markAuthSessionExpected()
    if (import.meta.env.DEV && !hasRemoteBackend) {
      setNoticeMessage('登录成功', 'success')
      handleLoginSuccess()
      return
    }
    // 仅在真正拿到业务会话后才提示「登录成功」并进首页(避免先成功后失败的误导)
    const trySession = async () => {
      try {
        const session = await getAuthenticatedSession()
        setNoticeMessage('登录成功', 'success')
        handleLoginSuccess(session)
        return true
      } catch {
        return false
      }
    }
    // ① 直接重试(cookie 就绪即可)
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await trySession()) return
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    const navUrl = getAuthNavigationUrl(oauth, authResult)
    if (!navUrl || navUrl === '/') {
      console.warn('[login] 取会话失败且无 SSO 跳转地址 navUrl=%o', navUrl, { authResult, oauth })
      setNoticeMessage('登录失败:未获取到会话,且缺少 SSO 跳转地址,请稍后重试或联系管理员', 'error')
      return
    }
    // ② 隐藏 iframe 静默桥接:后台跑完 OAuth 回调种 cookie,同时轮询会话
    const silentOk = await new Promise<boolean>((resolve) => {
      const iframe = document.createElement('iframe')
      iframe.style.display = 'none'
      iframe.setAttribute('aria-hidden', 'true')
      iframe.src = navUrl
      document.body.appendChild(iframe)
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        iframe.remove()
        resolve(ok)
      }
      const deadline = Date.now() + 6000
      const poll = async () => {
        if (settled) return
        if (await trySession()) {
          finish(true)
          return
        }
        if (Date.now() >= deadline) {
          finish(false)
          return
        }
        setTimeout(poll, 500)
      }
      setTimeout(poll, 700) // 给 iframe 一点时间跑完重定向链
    })
    if (silentOk) return
    // ③ 静默失败(被 X-Frame-Options 拦截 / 超时)→ 兜底可见重定向,保证能登录
    console.warn('[login] 静默会话桥接失败/超时,回退可见重定向:', navUrl)
    window.location.href = navUrl
  }

  async function refreshCaptcha({ silent = false } = {}) {
    try {
      const next = await getCaptcha()
      setCaptcha({ id: next.id || '', image: next.image || '', answer: '' })
    } catch (error) {
      if (!silent) setNoticeMessage(getAuthErrorMessage(error, '图形验证码刷新失败，请稍后重试'), 'error')
      throw error
    }
  }

  async function handleCaptchaError(error: any) {
    if (!isCaptchaChallengeError(error)) return false
    try {
      await refreshCaptcha({ silent: true })
    } catch {
      /* 即使刷新失败，仍保留原始验证码挑战错误提示 */
    }
    setLoginErrors((prev) => ({ ...prev, captcha: getAuthErrorMessage(error, '请输入图形验证码') }))
    return true
  }

  async function ensureAuthStart() {
    if (authStartRef.current) return authStartRef.current
    if (!authStartPromiseRef.current) {
      authStartPromiseRef.current = startOAuth({ redirectTo: getRedirectTo() })
        .then((data) => {
          authStartRef.current = data
          return data
        })
        .finally(() => {
          authStartPromiseRef.current = null
        })
    }
    return authStartPromiseRef.current
  }

  function switchMode(mode: 'password' | 'sms') {
    setLoginMode(mode)
    setNoticeMessage('')
    clearLoginErrors()
  }

  function clearCodeTimer() {
    if (codeTimerRef.current) {
      window.clearInterval(codeTimerRef.current)
      codeTimerRef.current = null
    }
  }
  function startCodeCountdown() {
    clearCodeTimer()
    setCodeCountdown(60)
    codeTimerRef.current = window.setInterval(() => {
      setCodeCountdown((prev) => {
        if (prev <= 1) {
          clearCodeTimer()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function requestCode() {
    if (codeCountdown > 0) return
    const mobile = normalizeMobile(phone)
    if (!mobile) {
      setLoginErrors((prev) => ({ ...prev, phone: '请输入手机号' }))
      return
    }
    if (captcha.image && !captcha.answer.trim()) {
      setLoginErrors((prev) => ({ ...prev, captcha: '请输入图形验证码' }))
      return
    }
    clearLoginError('phone')
    setIsSendingCode(true)
    try {
      const oauth = await ensureAuthStart()
      await sendAuthSms({
        authStart: oauth,
        mobile,
        purpose: 'login',
        captchaId: captcha.id,
        captchaAnswer: captcha.answer.trim(),
      })
      startCodeCountdown()
      setNoticeMessage('验证码已发送', 'success')
    } catch (error) {
      if (await handleCaptchaError(error)) {
        setNoticeMessage(getAuthErrorMessage(error, '请输入图形验证码'), 'error')
        return
      }
      setNoticeMessage(getAuthErrorMessage(error, '验证码发送失败，请稍后重试'), 'error')
    } finally {
      setIsSendingCode(false)
    }
  }

  // 校验登录表单;通过返回规范化手机号与凭据,否则返回 null。
  function validateLogin(): { mobile: string; credential: string } | null {
    const mobile = normalizeMobile(phone)
    const credential = loginMode === 'password' ? password : smsCode.trim()
    const nextErrors = { phone: '', password: '', code: '', captcha: '' }
    let hasError = false
    if (!mobile) {
      nextErrors.phone = '请输入手机号'
      hasError = true
    }
    if (!credential) {
      nextErrors[loginMode === 'password' ? 'password' : 'code'] = `请输入${credentialLabel}`
      hasError = true
    }
    if (captcha.image && !captcha.answer.trim()) {
      nextErrors.captcha = '请输入图形验证码'
      hasError = true
    }
    if (hasError) {
      setLoginErrors(nextErrors)
      return null
    }
    return { mobile, credential }
  }

  // 实际提交（协议已确认后调用）。
  async function submitLogin(mobile: string, credential: string) {
    setIsSubmitting(true)

    // 仅在未配置远程后端时跳过真实 API 调用（走本地 mock 登录）。
    if (import.meta.env.DEV && !hasRemoteBackend) {
      setIsSubmitting(false)
      handleLoginFlowComplete(null as any)
      return
    }

    try {
      // 换账号关键：先登出旧业务会话，否则登录后立即 getSession() 会读回旧账号。
      // 必须在 oauth-start 之前，否则会清掉本次 OAuth 的 state 导致回调 400。
      await clearExistingSession()
      // 发短信时可能已生成过 authStart（其 state 绑定旧会话），登出后需重新获取。
      authStartRef.current = null
      authStartPromiseRef.current = null
      const oauth = await ensureAuthStart()
      const common = { authStart: oauth, mobile, captchaId: captcha.id, captchaAnswer: captcha.answer.trim() }
      let loginResult: any
      if (loginMode === 'password') {
        loginResult = await loginWithPassword({ ...common, password: credential })
      } else {
        loginResult = await loginWithSmsCode({ ...common, smsCode: credential })
      }
      // 不再在此提前弹「登录成功」——改由 handleLoginFlowComplete 确认会话后再弹
      handleLoginFlowComplete(oauth, loginResult)
    } catch (error) {
      if (await handleCaptchaError(error)) {
        setNoticeMessage(getAuthErrorMessage(error, '请输入图形验证码'), 'error')
        return
      }
      // 验证码登录 + 该手机号未注册(后端 code 20003)→ 弹「设置密码完成注册并登录」(密码可不填)
      if (loginMode === 'sms' && Number((error as any)?.code) === 20003) {
        setSmsRegister({ mobile, smsCode: credential })
        return
      }
      const fallback = loginMode === 'password' ? '手机号或密码错误' : '手机号或验证码错误'
      setNoticeMessage(getAuthErrorMessage(error, fallback), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleSubmit() {
    clearLoginErrors()
    setNoticeMessage('')
    const valid = validateLogin()
    if (!valid) return
    if (!agreed) {
      agreementModalContextRef.current = 'login'
      setShowAgreementModal(true)
      return
    }
    void submitLogin(valid.mobile, valid.credential)
  }

  function handleLink(label: string) {
    if (label === '用户协议' || label === '隐私政策') {
      agreementModalContextRef.current = 'view'
      setShowAgreementModal(true)
      return
    }
    setNoticeMessage(`${label}功能即将开放`)
  }

  function handleAgreementAgree() {
    setShowAgreementModal(false)
    if (agreementModalContextRef.current === 'login') {
      setAgreed(true)
      // setAgreed 异步,这里走不依赖该 state 的提交路径。
      const valid = validateLogin()
      if (valid) void submitLogin(valid.mobile, valid.credential)
    }
    // 'view' → 仅查看协议
  }

  function handleAgreementCancel() {
    setShowAgreementModal(false)
  }

  useEffect(() => {
    // 仅卸载时清理倒计时定时器
    return () => clearCodeTimer()
  }, [])

  return (
    <main className="zlogin">
      <aside className="zlogin-hero" style={{ backgroundImage: `url(${loginHero})` }} aria-hidden="true">
        <nav className="zlogin-nav">
          {NAV_ITEMS.map((item) => (
            <span key={item} className={`zlogin-nav-item${item === '生活服务' ? ' is-active' : ''}`}>
              {item}
            </span>
          ))}
        </nav>
      </aside>

      <section className="zlogin-panel" aria-label="帧智汇登录">
        <button type="button" className="zlogin-back" onClick={goBack} aria-label="返回上一页">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="zlogin-form">
          <h1 className="zlogin-title">欢迎加入帧智汇</h1>
          <p className="zlogin-sub">
            还没有账号？
            <button type="button" className="zlogin-link" onClick={() => setAuthModal('register')}>
              免费注册
            </button>
          </p>

          <div className="zlogin-tabs" role="tablist" aria-label="登录方式">
            <button
              type="button"
              role="tab"
              aria-selected={loginMode === 'sms'}
              className={`zlogin-tab${loginMode === 'sms' ? ' is-active' : ''}`}
              onClick={() => switchMode('sms')}
            >
              短信登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={loginMode === 'password'}
              className={`zlogin-tab${loginMode === 'password' ? ' is-active' : ''}`}
              onClick={() => switchMode('password')}
            >
              密码登录
            </button>
          </div>

          <div className="zlogin-fields">
            <div className={`zlogin-field${loginErrors.phone ? ' has-error' : ''}`}>
              <input
                type="tel"
                inputMode="numeric"
                placeholder="账号 / 手机号"
                aria-label="账号或手机号"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  clearLoginError('phone')
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>

            {loginMode === 'password' ? (
              <div className={`zlogin-field${loginErrors.password ? ' has-error' : ''}`}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="密码"
                  aria-label="密码"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    clearLoginError('password')
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
                <button
                  type="button"
                  className="zlogin-eye"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
                      <path
                        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
                      <path
                        d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a17.3 17.3 0 0 1-3.7 4.4M6.1 6.1A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.1-.9"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </div>
            ) : (
              <div className={`zlogin-field${loginErrors.code ? ' has-error' : ''}`}>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="验证码"
                  aria-label="短信验证码"
                  value={smsCode}
                  onChange={(e) => {
                    setSmsCode(e.target.value)
                    clearLoginError('code')
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
                <button
                  type="button"
                  className="zlogin-code-btn"
                  disabled={codeCountdown > 0 || isSendingCode}
                  onClick={requestCode}
                >
                  {isSendingCode ? '发送中…' : codeButtonText}
                </button>
              </div>
            )}

            {captcha.image && (
              <div className={`zlogin-field${loginErrors.captcha ? ' has-error' : ''}`}>
                <input
                  type="text"
                  placeholder="图形验证码"
                  aria-label="图形验证码"
                  value={captcha.answer}
                  onChange={(e) => {
                    setCaptcha((prev) => ({ ...prev, answer: e.target.value }))
                    clearLoginError('captcha')
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
                <img
                  className="zlogin-captcha-img"
                  src={captcha.image}
                  alt="点击刷新图形验证码"
                  onClick={() => refreshCaptcha()}
                />
              </div>
            )}
          </div>

          {(loginErrors.phone || loginErrors.password || loginErrors.code || loginErrors.captcha) && (
            <span className="zlogin-err">
              {loginErrors.phone || loginErrors.password || loginErrors.code || loginErrors.captcha}
            </span>
          )}

          <button type="button" className="zlogin-submit" disabled={isSubmitting} onClick={handleSubmit}>
            {isSubmitting ? '登录中…' : '登录'}
          </button>

          <div className="zlogin-foot">
            <button type="button" className="zlogin-forgot" onClick={() => setAuthModal('forgot')}>
              忘记密码？
            </button>
          </div>

          <label className="zlogin-agree">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              已经阅读并同意
              <a onClick={() => handleLink('用户协议')}>《用户协议》</a>及
              <a onClick={() => handleLink('隐私政策')}>《隐私政策》</a>
            </span>
          </label>
        </div>
      </section>

      {showAgreementModal && <AgreementModal onAgree={handleAgreementAgree} onCancel={handleAgreementCancel} />}

      {/* 注册 / 重置密码 弹窗 */}
      {authModal && (
        <AuthActionModal
          mode={authModal}
          ensureAuthStart={ensureAuthStart}
          onClose={() => setAuthModal(null)}
          onAuthed={(as, result) => {
            setAuthModal(null)
            void handleLoginFlowComplete(as, result)
          }}
          onResetDone={(m) => {
            setAuthModal(null)
            switchMode('password')
            setPhone(m)
            setNoticeMessage('重置密码成功,请用新密码登录', 'success')
          }}
          onAlreadyRegistered={(m) => {
            setAuthModal(null)
            switchMode('password')
            setPhone(m)
          }}
        />
      )}

      {/* 验证码登录·手机号未注册 → 设置密码完成注册并登录 */}
      {smsRegister && (
        <AuthActionModal
          mode="sms-register"
          ensureAuthStart={ensureAuthStart}
          authStart={authStartRef.current}
          prefill={smsRegister}
          onClose={() => setSmsRegister(null)}
          onAuthed={(as, result) => {
            setSmsRegister(null)
            void handleLoginFlowComplete(as, result)
          }}
        />
      )}
    </main>
  )
}
