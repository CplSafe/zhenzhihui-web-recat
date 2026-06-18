/**
 * LoginView — 登录/注册页面
 * 聚合 AuthHeroPanel（品牌展示）+ LoginFormCard / RegisterFormCard（表单切换）+ AgreementModal（用户协议）。
 * 支持密码登录、短信登录、扫码登录三种模式，登录成功后自动初始化工作空间会话并跳转。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import '@/styles/login.css'
import loginBg from '@/assets/login-bg.png'
import loginHero from '@/assets/login-hero.png'
import AuthHeroPanel from '@/components/auth/AuthHeroPanel'
import LoginFormCard from '@/components/auth/LoginFormCard'
import RegisterFormCard from '@/components/auth/RegisterFormCard'
import AgreementModal from '@/components/auth/AgreementModal'
import {
  getAuthNavigationUrl,
  getAuthErrorMessage,
  getCaptcha,
  isCaptchaChallengeError,
  loginWithPassword,
  loginWithSmsCode,
  markAuthSessionExpected,
  registerAccount,
  sendAuthSms,
  startOAuth,
} from '@/api/auth'
import { useToast } from '@/composables/useToast'

const DESIGN_WIDTH = 1440
const DESIGN_HEIGHT = 900

interface CaptchaState {
  id: string
  image: string
  answer: string
}

const features = [
  {
    title: 'AI智能生成',
    lines: ['输入文案或产品连接，', 'AI自动生成高质量广告视频'],
    icon: 'video',
  },
  {
    title: '丰富模板素材',
    lines: ['海量行业模板与素材，', '覆盖多种营销场景'],
    icon: 'template',
  },
  {
    title: '高效转化增长',
    lines: ['优化视频内容与投放效果，', '助力提升ROI与品牌影响力'],
    icon: 'chart',
  },
]

export default function LoginView() {
  const { showToast, clearToast } = useToast()

  const [stageScale, setStageScale] = useState<string | number>(1)
  const [pageMode, setPageMode] = useState('login')
  const [loginMode, setLoginMode] = useState('password')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [registerPhone, setRegisterPhone] = useState('')
  const [registerCode, setRegisterCode] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerAgreed, setRegisterAgreed] = useState(false)
  const [captcha, setCaptcha] = useState<CaptchaState>({ id: '', image: '', answer: '' })
  const [registerCaptcha, setRegisterCaptcha] = useState<CaptchaState>({
    id: '',
    image: '',
    answer: '',
  })
  const [remember, setRemember] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeType, setNoticeType] = useState('info')
  const [codeCountdown, setCodeCountdown] = useState(0)
  const [registerCodeCountdown, setRegisterCodeCountdown] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRegisterSubmitting, setIsRegisterSubmitting] = useState(false)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isSendingRegisterCode, setIsSendingRegisterCode] = useState(false)
  const [loginErrors, setLoginErrors] = useState({
    phone: '',
    password: '',
    code: '',
    captcha: '',
  })
  const [registerErrors, setRegisterErrors] = useState({
    phone: '',
    code: '',
    password: '',
    captcha: '',
  })

  const [showAgreementModal, setShowAgreementModal] = useState(false)
  // 'login' | 'register' | 'sso' | 'view'
  const agreementModalContextRef = useRef('sso')

  // 非渲染状态：authStart 数据、定时器、并发请求 Promise
  const authStartRef = useRef<any>(null)
  const authStartPromiseRef = useRef<Promise<any> | null>(null)
  const codeTimerRef = useRef<number | null>(null)
  const registerCodeTimerRef = useRef<number | null>(null)

  const credentialValue = loginMode === 'password' ? password : smsCode
  const credentialLabel = loginMode === 'password' ? '密码' : '验证码'
  const codeButtonText = codeCountdown > 0 ? `${codeCountdown}s后重发` : '获取验证码'
  const registerCodeButtonText =
    registerCodeCountdown > 0 ? `${registerCodeCountdown}s后重发` : '获取验证码'

  const shellStyle = useMemo(
    () =>
      ({
        '--design-width': `${DESIGN_WIDTH}px`,
        '--design-height': `${DESIGN_HEIGHT}px`,
        '--stage-scale': stageScale,
      }) as any,
    [stageScale],
  )

  function updateStageScale() {
    const widthScale = window.innerWidth / DESIGN_WIDTH
    const heightScale = window.innerHeight / DESIGN_HEIGHT
    // Clamp scale between 0.5 and 1.5 so content remains readable on all viewports
    const raw = Math.min(widthScale, heightScale)
    setStageScale(Math.max(0.5, Math.min(1.5, raw)).toFixed(4))
  }

  function setNoticeMessage(message: string, type = 'info') {
    setNotice('')
    setNoticeType(type)

    if (message) {
      showToast(message, type as any, type === 'error' ? 5000 : 3000)
    } else {
      clearToast()
    }
  }

  function clearLoginErrors() {
    setLoginErrors({ phone: '', password: '', code: '', captcha: '' })
  }

  function clearRegisterErrors() {
    setRegisterErrors({ phone: '', code: '', password: '', captcha: '' })
  }

  function clearLoginError(field: string) {
    setLoginErrors((prev) => ({ ...prev, [field]: '' }))
  }

  function clearRegisterError(field: string) {
    setRegisterErrors((prev) => ({ ...prev, [field]: '' }))
  }

  function normalizeMobile(value: string) {
    return value.replace(/\s/g, '')
  }

  function getRedirectTo() {
    return `${window.location.origin}/`
  }

  function completeAuthFlow(oauth: any, authResult: any) {
    markAuthSessionExpected()
    window.location.href = getAuthNavigationUrl(oauth, authResult)
  }

  async function refreshCaptcha(target = 'login', { silent = false } = {}) {
    try {
      const nextCaptcha = await getCaptcha()
      const nextState: CaptchaState = {
        id: nextCaptcha.id || '',
        image: nextCaptcha.image || '',
        answer: '',
      }

      if (target === 'register') {
        setRegisterCaptcha(nextState)
      } else {
        setCaptcha(nextState)
      }
    } catch (error) {
      if (!silent) {
        setNoticeMessage(getAuthErrorMessage(error, '图形验证码刷新失败，请稍后重试'), 'error')
      }

      throw error
    }
  }

  async function handleCaptchaError(error: any, target = 'login') {
    if (!isCaptchaChallengeError(error)) {
      return false
    }

    try {
      await refreshCaptcha(target, { silent: true })
    } catch {
      // Keep showing the original captcha challenge error even if refreshing the image fails.
    }

    if (target === 'register') {
      setRegisterErrors((prev) => ({
        ...prev,
        captcha: getAuthErrorMessage(error, '请输入图形验证码'),
      }))
    } else {
      setLoginErrors((prev) => ({
        ...prev,
        captcha: getAuthErrorMessage(error, '请输入图形验证码'),
      }))
    }

    return true
  }

  async function ensureAuthStart() {
    if (authStartRef.current) {
      return authStartRef.current
    }

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

  function switchMode(mode: string) {
    setLoginMode(mode)
    setNoticeMessage('')
    clearLoginErrors()
  }

  function showRegister() {
    setPageMode('register')
    setNoticeMessage('')
    clearLoginErrors()
  }

  function showLogin() {
    setPageMode('login')
    setNoticeMessage('')
    clearRegisterErrors()
  }

  function clearCodeTimer() {
    if (codeTimerRef.current) {
      window.clearInterval(codeTimerRef.current)
      codeTimerRef.current = null
    }
  }

  function clearRegisterCodeTimer() {
    if (registerCodeTimerRef.current) {
      window.clearInterval(registerCodeTimerRef.current)
      registerCodeTimerRef.current = null
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

  function startRegisterCodeCountdown() {
    clearRegisterCodeTimer()
    setRegisterCodeCountdown(60)
    registerCodeTimerRef.current = window.setInterval(() => {
      setRegisterCodeCountdown((prev) => {
        if (prev <= 1) {
          clearRegisterCodeTimer()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function requestCode() {
    if (codeCountdown > 0) {
      return
    }

    const mobile = normalizeMobile(phone)

    if (!mobile) {
      setLoginErrors((prev) => ({ ...prev, phone: '请输入手机号' }))
      setNoticeMessage('')
      return
    }

    if (captcha.image && !captcha.answer.trim()) {
      setLoginErrors((prev) => ({ ...prev, captcha: '请输入图形验证码' }))
      setNoticeMessage('')
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
      if (await handleCaptchaError(error, 'login')) {
        setNoticeMessage(getAuthErrorMessage(error, '请输入图形验证码'), 'error')
        return
      }

      setNoticeMessage(getAuthErrorMessage(error, '验证码发送失败，请稍后重试'), 'error')
    } finally {
      setIsSendingCode(false)
    }
  }

  async function requestRegisterCode() {
    if (registerCodeCountdown > 0) {
      return
    }

    const mobile = normalizeMobile(registerPhone)

    if (!mobile) {
      setRegisterErrors((prev) => ({ ...prev, phone: '请输入手机号' }))
      setNoticeMessage('')
      return
    }

    if (registerCaptcha.image && !registerCaptcha.answer.trim()) {
      setRegisterErrors((prev) => ({ ...prev, captcha: '请输入图形验证码' }))
      setNoticeMessage('')
      return
    }

    clearRegisterError('phone')
    setIsSendingRegisterCode(true)

    try {
      const oauth = await ensureAuthStart()

      await sendAuthSms({
        authStart: oauth,
        mobile,
        purpose: 'register',
        captchaId: registerCaptcha.id,
        captchaAnswer: registerCaptcha.answer.trim(),
      })

      startRegisterCodeCountdown()
      setNoticeMessage('验证码已发送', 'success')
    } catch (error) {
      if (await handleCaptchaError(error, 'register')) {
        setNoticeMessage(getAuthErrorMessage(error, '请输入图形验证码'), 'error')
        return
      }

      setNoticeMessage(getAuthErrorMessage(error, '验证码发送失败，请稍后重试'), 'error')
    } finally {
      setIsSendingRegisterCode(false)
    }
  }

  async function handleSubmit() {
    clearLoginErrors()
    setNoticeMessage('')

    let hasError = false
    const mobile = normalizeMobile(phone)
    const credential = loginMode === 'password' ? credentialValue : credentialValue.trim()
    const nextErrors = { phone: '', password: '', code: '', captcha: '' }

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
      return
    }

    if (!agreed) {
      agreementModalContextRef.current = 'login'
      setShowAgreementModal(true)
      return
    }

    setIsSubmitting(true)

    try {
      const oauth = await ensureAuthStart()

      if (loginMode === 'password') {
        const result = await loginWithPassword({
          authStart: oauth,
          mobile,
          password: credential,
          captchaId: captcha.id,
          captchaAnswer: captcha.answer.trim(),
        })

        setNoticeMessage('登录成功', 'success')
        completeAuthFlow(oauth, result)
        return
      } else {
        const result = await loginWithSmsCode({
          authStart: oauth,
          mobile,
          smsCode: credential,
          captchaId: captcha.id,
          captchaAnswer: captcha.answer.trim(),
        })

        setNoticeMessage('登录成功', 'success')
        completeAuthFlow(oauth, result)
        return
      }
    } catch (error) {
      if (await handleCaptchaError(error, 'login')) {
        setNoticeMessage(getAuthErrorMessage(error, '请输入图形验证码'), 'error')
        return
      }

      const fallback = loginMode === 'password' ? '手机号或密码错误' : '手机号或验证码错误'
      setNoticeMessage(getAuthErrorMessage(error, fallback), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRegisterSubmit() {
    clearRegisterErrors()
    setNoticeMessage('')

    let hasError = false
    const mobile = normalizeMobile(registerPhone)
    const code = registerCode.trim()
    const newPassword = registerPassword
    const nextErrors = { phone: '', code: '', password: '', captcha: '' }

    if (!mobile) {
      nextErrors.phone = '请输入手机号'
      hasError = true
    }

    if (!code) {
      nextErrors.code = '请输入验证码'
      hasError = true
    }

    if (!newPassword) {
      nextErrors.password = '请输入密码'
      hasError = true
    }

    if (hasError) {
      setRegisterErrors(nextErrors)
      return
    }

    if (!registerAgreed) {
      agreementModalContextRef.current = 'register'
      setShowAgreementModal(true)
      return
    }

    setIsRegisterSubmitting(true)

    try {
      const oauth = await ensureAuthStart()

      const result = await registerAccount({
        authStart: oauth,
        mobile,
        password: newPassword,
        smsCode: code,
        termsAccepted: true,
      })

      setNoticeMessage('注册成功', 'success')
      completeAuthFlow(oauth, result)
    } catch (error) {
      setNoticeMessage(getAuthErrorMessage(error, '注册失败，请检查信息后重试'), 'error')
    } finally {
      setIsRegisterSubmitting(false)
    }
  }

  function handleLink(label: string) {
    if (label === '用户协议' || label === '隐私政策') {
      agreementModalContextRef.current = 'view'
      setShowAgreementModal(true)
      return
    }
    setNoticeMessage(`${label}功能即将开放`)
  }

  function handleUnifiedLogin() {
    agreementModalContextRef.current = 'sso'
    setShowAgreementModal(true)
  }

  function handleAgreementAgree() {
    setShowAgreementModal(false)

    if (agreementModalContextRef.current === 'login') {
      setAgreed(true)
      // 协议确认后立即重新提交（原 Vue 直接调用 handleSubmit，此处用专门的内联校验路径，
      // 因为 React 中 setAgreed(true) 是异步的，不能立即依赖 agreed 状态）。
      void submitLoginAfterAgree()
      return
    }

    if (agreementModalContextRef.current === 'register') {
      setRegisterAgreed(true)
      void submitRegisterAfterAgree()
      return
    }

    if (agreementModalContextRef.current === 'sso') {
      setAgreed(true)
      sessionStorage.setItem('zzh_sso_pending', '1')
      // 直接跳后端，不走 Vite 代理。DeepAuth 登录页在 DeepAuth 自己的域名上显示
      const baseUrl = (import.meta as any).env.VITE_ZZH_REMOTE_ORIGIN || window.location.origin
      const redirectTo = `${window.location.origin}/creative`
      const loginUrl = `${baseUrl}/auth/login?${new URLSearchParams({ redirect_to: redirectTo })}`
      window.location.href = loginUrl
      return
    }

    // 'view' → 仅查看协议，不修改任何勾选状态
  }

  // 协议确认后重新提交登录：复用 handleSubmit 的逻辑但跳过 agreed 拦截。
  async function submitLoginAfterAgree() {
    clearLoginErrors()
    setNoticeMessage('')

    let hasError = false
    const mobile = normalizeMobile(phone)
    const credential = loginMode === 'password' ? credentialValue : credentialValue.trim()
    const nextErrors = { phone: '', password: '', code: '', captcha: '' }

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
      return
    }

    setIsSubmitting(true)

    try {
      const oauth = await ensureAuthStart()

      if (loginMode === 'password') {
        const result = await loginWithPassword({
          authStart: oauth,
          mobile,
          password: credential,
          captchaId: captcha.id,
          captchaAnswer: captcha.answer.trim(),
        })

        setNoticeMessage('登录成功', 'success')
        completeAuthFlow(oauth, result)
        return
      } else {
        const result = await loginWithSmsCode({
          authStart: oauth,
          mobile,
          smsCode: credential,
          captchaId: captcha.id,
          captchaAnswer: captcha.answer.trim(),
        })

        setNoticeMessage('登录成功', 'success')
        completeAuthFlow(oauth, result)
        return
      }
    } catch (error) {
      if (await handleCaptchaError(error, 'login')) {
        setNoticeMessage(getAuthErrorMessage(error, '请输入图形验证码'), 'error')
        return
      }

      const fallback = loginMode === 'password' ? '手机号或密码错误' : '手机号或验证码错误'
      setNoticeMessage(getAuthErrorMessage(error, fallback), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  // 协议确认后重新提交注册：复用 handleRegisterSubmit 的逻辑但跳过 registerAgreed 拦截。
  async function submitRegisterAfterAgree() {
    clearRegisterErrors()
    setNoticeMessage('')

    let hasError = false
    const mobile = normalizeMobile(registerPhone)
    const code = registerCode.trim()
    const newPassword = registerPassword
    const nextErrors = { phone: '', code: '', password: '', captcha: '' }

    if (!mobile) {
      nextErrors.phone = '请输入手机号'
      hasError = true
    }

    if (!code) {
      nextErrors.code = '请输入验证码'
      hasError = true
    }

    if (!newPassword) {
      nextErrors.password = '请输入密码'
      hasError = true
    }

    if (hasError) {
      setRegisterErrors(nextErrors)
      return
    }

    setIsRegisterSubmitting(true)

    try {
      const oauth = await ensureAuthStart()

      const result = await registerAccount({
        authStart: oauth,
        mobile,
        password: newPassword,
        smsCode: code,
        termsAccepted: true,
      })

      setNoticeMessage('注册成功', 'success')
      completeAuthFlow(oauth, result)
    } catch (error) {
      setNoticeMessage(getAuthErrorMessage(error, '注册失败，请检查信息后重试'), 'error')
    } finally {
      setIsRegisterSubmitting(false)
    }
  }

  function handleAgreementCancel() {
    setShowAgreementModal(false)
  }

  // onMounted / onBeforeUnmount
  useEffect(() => {
    updateStageScale()
    window.addEventListener('resize', updateStageScale)
    return () => {
      window.removeEventListener('resize', updateStageScale)
      clearCodeTimer()
      clearRegisterCodeTimer()
    }
    // 仅在挂载/卸载时运行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="login-shell" style={shellStyle}>
      <img className="viewport-background" src={loginBg} alt="" />
      <section className="login-stage" aria-label="帧智汇账号密码登录页">
        <div className="figma-frame">
          <AuthHeroPanel
            loginHero={loginHero}
            mode={pageMode}
            features={features}
            onShowRegister={showRegister}
            onShowLogin={showLogin}
          />

          {pageMode === 'login' ? (
            <LoginFormCard
              phone={phone}
              onPhoneChange={setPhone}
              password={password}
              onPasswordChange={setPassword}
              smsCode={smsCode}
              onSmsCodeChange={setSmsCode}
              captchaAnswer={captcha.answer}
              onCaptchaAnswerChange={(value) =>
                setCaptcha((prev) => ({ ...prev, answer: value }))
              }
              remember={remember}
              onRememberChange={setRemember}
              agreed={agreed}
              onAgreedChange={setAgreed}
              showPassword={showPassword}
              onShowPasswordChange={setShowPassword}
              loginMode={loginMode}
              loginErrors={loginErrors}
              codeCountdown={codeCountdown}
              codeButtonText={codeButtonText}
              isSubmitting={isSubmitting}
              isSendingCode={isSendingCode}
              captchaImage={captcha.image}
              notice={notice}
              noticeType={noticeType}
              onSwitchMode={switchMode}
              onSubmit={handleSubmit}
              onClearError={clearLoginError}
              onRequestCode={requestCode}
              onRefreshCaptcha={() => refreshCaptcha('login')}
              onLink={handleLink}
              onUnifiedLogin={handleUnifiedLogin}
            />
          ) : (
            <RegisterFormCard
              registerPhone={registerPhone}
              onRegisterPhoneChange={setRegisterPhone}
              registerCode={registerCode}
              onRegisterCodeChange={setRegisterCode}
              registerPassword={registerPassword}
              onRegisterPasswordChange={setRegisterPassword}
              registerAgreed={registerAgreed}
              onRegisterAgreedChange={setRegisterAgreed}
              registerCaptchaAnswer={registerCaptcha.answer}
              onRegisterCaptchaAnswerChange={(value) =>
                setRegisterCaptcha((prev) => ({ ...prev, answer: value }))
              }
              registerErrors={registerErrors}
              registerCodeCountdown={registerCodeCountdown}
              registerCodeButtonText={registerCodeButtonText}
              isSubmitting={isRegisterSubmitting}
              isSendingCode={isSendingRegisterCode}
              captchaImage={registerCaptcha.image}
              notice={notice}
              noticeType={noticeType}
              onSubmit={handleRegisterSubmit}
              onClearError={clearRegisterError}
              onRequestCode={requestRegisterCode}
              onRefreshCaptcha={() => refreshCaptcha('register')}
              onLink={handleLink}
            />
          )}
        </div>
      </section>

      {showAgreementModal && (
        <AgreementModal onAgree={handleAgreementAgree} onCancel={handleAgreementCancel} />
      )}
    </main>
  )
}
