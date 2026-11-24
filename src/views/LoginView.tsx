/**
 * 页面职责：提供帧智汇统一登录入口，并在认证成功后把业务会话交给全局 AuthContext。
 * 页面效果：左侧展示可轮播的品牌媒体，右侧支持密码登录、短信登录、验证码挑战、协议确认和注册/找回密码弹窗。
 * 关键流程：登录或注册提交时清理旧会话，再启动本次 OAuth；认证成功后确认业务会话，必要时通过隐藏 iframe 完成 SSO 桥接。
 * 安全边界：不记录令牌、认证响应或完整跳转地址；组件卸载时终止倒计时和迟到的会话桥接回调。
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './LoginView.css'
import loginHero from '@/assets/login-hero.webp'
import loginHeroFallback from '@/assets/login-hero-fallback.jpg'
import AgreementModal from '@/components/auth/AgreementModal'
import PrivacyPolicyModal from '@/components/auth/PrivacyPolicyModal'
import AuthActionModal, { type AuthActionMode } from '@/components/auth/AuthActionModal'
import {
  AuthApiError,
  clearAuthSessionMarker,
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
import { useAuthSmsCooldown } from '@/composables/useAuthSmsCooldown'
import { useToast } from '@/composables/useToast'
import { listBanners } from '@/api/banners'
import { useSwr } from '@/composables/useSwr' // 复用首页同一套 SWR 缓存(先返缓存秒出、后台刷新)
import { logger } from '@/observability/openobserve-logger'
import { createLoginBridgeDiagnostic, type LoginBridgeWarningReason } from '@/utils/loginObservability'
import { hasConfiguredDevBackend } from '@/utils/devBackend'
import { getInviteCode, getInviteType } from '@/utils/inviteCode'
import MediaSoundToggle from '@/components/common/MediaSoundToggle'
import { useBackgroundVideoSound } from '@/composables/useBackgroundVideoSound'
import { useLatestCallback } from '@/composables/useLatestCallback'
import {
  consumeOAuthLoginReturnTo,
  hasOAuthCallbackFailure,
  keepOAuthLoginReturnTo,
  readLoginReturnTo,
} from '@/utils/loginReturnTo'

/** 短信登录前的人机验证码会话状态。 */
interface CaptchaState {
  id: string
  image: string
  answer: string
}
const EMPTY_CAPTCHA: CaptchaState = { id: '', image: '', answer: '' }

// 登录页大图轮播数据的 SWR 缓存键(slug=login)
const LOGIN_BANNERS_CACHE_KEY = 'login-banners'
// 仅记住账号，不设置过期时间；与登录会话分开存储，退出登录仍保留。
const REMEMBERED_ACCOUNT_KEY = 'zzh_remembered_login_account'
function readRememberedAccount(): string | null {
  try {
    const account = window.localStorage.getItem(REMEMBERED_ACCOUNT_KEY)
    return account !== null && /^\d{0,11}$/.test(account) ? account : null
  } catch {
    return null
  }
}
// 图片幻灯片自动切换间隔(视频则播完即切)
const IMAGE_AUTOPLAY_MS = 3000
const DIRECT_SESSION_TIMEOUT_MS = 1200
const SESSION_BRIDGE_TIMEOUT_MS = 6000
const CALLBACK_FAILURE_MESSAGE = '登录回调失败，请重新登录。'
// 接口无数据时的兜底标题(保持原静态四项)
const NAV_ITEMS = ['食品饮料', '生活服务', '餐饮美食', '丽人服务']

/** 只上报脱敏后的登录桥接诊断，不记录令牌或完整跳转地址。 */
function reportLoginBridgeWarning(
  reason: LoginBridgeWarningReason,
  oauthStart: unknown,
  authResult: unknown,
  navigationUrl: unknown,
) {
  // 诊断信息由专用工具脱敏；开发环境输出控制台，生产环境才上报可观测平台。
  const diagnostic = createLoginBridgeDiagnostic({ reason, oauthStart, authResult, navigationUrl })

  if (import.meta.env.DEV) {
    console.warn('[login] session bridge warning', diagnostic)
    return
  }

  logger.warn('login_session_bridge_warning', diagnostic)
}

function isRejectedOAuthCallback(frame: HTMLIFrameElement): boolean {
  try {
    const location = frame.contentWindow?.location
    if (location?.origin !== window.location.origin) return false
    if (!['/auth/callback', '/api/v1/auth/callback'].includes(location.pathname)) return false
    const doc = frame.contentDocument
    const text = doc?.querySelector('pre')?.textContent ?? doc?.body?.textContent
    if (!text || text.length > 4096) return false
    const response = JSON.parse(text)
    return Number(response?.code) > 0 || (typeof response?.code_string === 'string' && response.code_string !== 'OK')
  } catch {
    // 受浏览器限制无法读取的页面，其回调结果仍未知。
    return false
  }
}

function getFreshAuthorizeUrl(oauth: any, previousOauth: any, previousUrl: string): string {
  const candidate = getAuthNavigationUrl(oauth, undefined)
  const url = new URL(candidate, window.location.origin)
  const state = url.searchParams.get('state')
  const previousState = new URL(previousUrl, window.location.origin).searchParams.get('state')
  const previousAuthorizeUrl = new URL(getAuthNavigationUrl(previousOauth, undefined), window.location.origin)
  return url.origin === window.location.origin &&
    ['/deepauth/oauth2/authorize', '/sso/oauth2/authorize'].includes(url.pathname) &&
    !url.searchParams.has('code') &&
    state &&
    state !== previousState &&
    state !== previousAuthorizeUrl.searchParams.get('state')
    ? candidate
    : ''
}

/** 渲染密码/短信登录，并把认证结果安全交给全局会话。 */
export default function LoginView() {
  const navigate = useNavigate()
  // 「返回」写死:始终回到开屏页 /welcome。
  const goBack = () => {
    loginAttemptRef.current?.abort()
    navigate('/welcome', { replace: true })
  }
  const { showToast, clearToast } = useToast()
  const { handleLoginSuccess: finishLogin } = useAuth()
  // 被守卫/需登录动作弹到登录页时携带的站内回跳地址;登录成功后回到原页,而不是一律落首页。
  const { search, state: locationState } = useLocation()
  const returnTo = readLoginReturnTo(locationState)
  const handleLoginSuccess = (session?: any) => finishLogin(session, returnTo)

  const hasRemoteBackend = hasConfiguredDevBackend()

  // 左侧大图轮播:数据来自 /api/v1/banners?slug=login。useSwr 负责缓存秒出 + 后台刷新。
  const { data: loginBanners } = useSwr(LOGIN_BANNERS_CACHE_KEY, () => listBanners('login'), { fallback: [] })
  // 当前高亮/展示的幻灯片下标(标题与媒体联动);默认第 2 项(对齐原「生活服务」高亮)。
  const [heroIndex, setHeroIndex] = useState(1)
  // 已经稳定显示的媒体与正在淡入的目标媒体分开维护，切换时旧媒体不会被兜底图替换。
  const [displayedMediaUrl, setDisplayedMediaUrl] = useState('')
  const [readyMediaUrl, setReadyMediaUrl] = useState('')
  const [loginMode, setLoginMode] = useState<'password' | 'sms'>('sms')
  const [rememberedAccount] = useState(readRememberedAccount)
  const [phone, setPhone] = useState(rememberedAccount ?? '')
  const [rememberAccount, setRememberAccount] = useState(rememberedAccount !== null)
  useEffect(() => {
    try {
      if (rememberAccount) window.localStorage.setItem(REMEMBERED_ACCOUNT_KEY, phone)
      else window.localStorage.removeItem(REMEMBERED_ACCOUNT_KEY)
    } catch {
      // 浏览器禁用本地存储时仍允许正常登录。
    }
  }, [rememberAccount, phone])
  const [password, setPassword] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [captcha, setCaptcha] = useState(EMPTY_CAPTCHA)
  const [agreed, setAgreed] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const { remainingSeconds: codeCountdown, markSent } = useAuthSmsCooldown(phone)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [loginErrors, setLoginErrors] = useState({ phone: '', password: '', code: '', captcha: '' })
  const [showAgreementModal, setShowAgreementModal] = useState(false)
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false)
  // 注册 / 重置密码 弹窗;以及「验证码登录时手机号未注册」触发的补全注册弹窗
  const [authModal, setAuthModal] = useState<AuthActionMode | null>(null)
  const [smsRegister, setSmsRegister] = useState<{ mobile: string } | null>(null)

  // 'login' | 'view'：协议弹窗的来源上下文
  const agreementModalContextRef = useRef('login')
  const smsRequestRef = useRef<symbol | null>(null)
  const mobileRevisionRef = useRef(0)
  const captchaRequestRef = useRef(0)
  const handledCallbackFailureRef = useRef(false)
  const loginAttemptRef = useRef<AbortController | null>(null)

  const credentialLabel = loginMode === 'password' ? '密码' : '验证码'
  const codeButtonText = codeCountdown > 0 ? `${codeCountdown}s后重发` : '获取验证码'
  const authActionOpen = Boolean(authModal || smsRegister)

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

  function resetLoginCredentials(mobile: string) {
    mobileRevisionRef.current += 1
    setPhone(mobile)
    setPassword('')
    setShowPassword(false)
    setSmsCode('')
    setCaptcha(EMPTY_CAPTCHA)
    clearLoginErrors()
  }

  function normalizeMobile(value: string) {
    return value.replace(/\s/g, '')
  }
  // 当前短信和密码登录接口都以中国大陆手机号作为账号标识。
  // 与 ChangePasswordModal / AuthActionModal 现有规则保持一致。
  function isValidSmsMobile(value: string) {
    return /^1\d{10}$/.test(value)
  }
  // 登录成功后的 SSO 回跳地址:直接落到首页。
  // 不能用 `${origin}/`,根路径会被路由重定向到开屏页 /welcome(详见 router/index.tsx 的 index 路由)。
  function getRedirectTo() {
    return `${window.location.origin}/home`
  }

  async function runLoginAttempt(run: (signal: AbortSignal) => Promise<void>) {
    if (loginAttemptRef.current) return
    const controller = new AbortController()
    loginAttemptRef.current = controller
    setIsSubmitting(true)
    try {
      await run(controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) {
        setNoticeMessage(getAuthErrorMessage(error, '未能建立登录会话，请重新登录。'), 'error')
      }
    } finally {
      if (loginAttemptRef.current === controller) {
        loginAttemptRef.current = null
        if (!controller.signal.aborted) setIsSubmitting(false)
      }
    }
  }

  // 先探测业务会话，再在 iframe 内静默跑 OAuth。
  async function handleLoginFlowComplete(signal: AbortSignal, oauth?: any, authResult?: any, mobile?: string) {
    if (signal.aborted) return false
    let keepSessionMarker = false
    let accountMismatch = false
    const waitForSession = (timeoutMs: number, pollInterval: number, firstPollDelay = 0, rejected?: AbortSignal) =>
      new Promise<any>((resolve) => {
        if (signal.aborted || rejected?.aborted) {
          resolve(null)
          return
        }
        let settled = false
        let pollTimer: number | undefined
        const finish = (session: any) => {
          if (settled) return
          settled = true
          window.clearTimeout(pollTimer)
          window.clearTimeout(deadlineTimer)
          signal.removeEventListener('abort', stop)
          rejected?.removeEventListener('abort', stop)
          resolve(session)
        }
        const stop = () => finish(null)
        const deadlineTimer = window.setTimeout(stop, timeoutMs)
        const poll = async () => {
          try {
            const session = await getAuthenticatedSession()
            if (settled) return
            const sessionMobile = normalizeMobile(String(session?.user?.mobile ?? ''))
            if (!mobile || !isValidSmsMobile(sessionMobile) || sessionMobile === mobile) {
              finish(session)
              return
            }
            accountMismatch = true
          } catch (error) {
            if (settled) return
            if (error instanceof AuthApiError && 'code' in error && error.code === 'SESSION_IDENTITY_MISMATCH') {
              accountMismatch = true
            }
          }
          pollTimer = window.setTimeout(poll, pollInterval)
        }
        signal.addEventListener('abort', stop, { once: true })
        rejected?.addEventListener('abort', stop, { once: true })
        if (firstPollDelay) pollTimer = window.setTimeout(poll, firstPollDelay)
        else void poll()
      })

    markAuthSessionExpected()
    try {
      const isLocalDev = import.meta.env.DEV && !hasRemoteBackend
      let session = isLocalDev ? undefined : await waitForSession(DIRECT_SESSION_TIMEOUT_MS, 300)
      if (signal.aborted) return false
      const navUrl = !isLocalDev && !session ? getAuthNavigationUrl(oauth, authResult) : ''
      const callbackRejected = new AbortController()
      if (navUrl && navUrl !== '/') {
        const iframe = document.createElement('iframe')
        iframe.style.display = 'none'
        iframe.setAttribute('aria-hidden', 'true')
        iframe.addEventListener('load', () => {
          if (isRejectedOAuthCallback(iframe)) callbackRejected.abort()
        })
        iframe.src = navUrl
        document.body.appendChild(iframe)
        try {
          session = await waitForSession(SESSION_BRIDGE_TIMEOUT_MS, 500, 700, callbackRejected.signal)
        } finally {
          iframe.remove()
        }
      }
      if (signal.aborted) return false
      if (isLocalDev || session) {
        keepSessionMarker = true
        setNoticeMessage('登录成功', 'success')
        handleLoginSuccess(session)
        return true
      } else if (callbackRejected.signal.aborted) {
        reportLoginBridgeWarning('oauth_callback_rejected', oauth, authResult, navUrl)
        setNoticeMessage(CALLBACK_FAILURE_MESSAGE, 'error')
      } else if (accountMismatch) {
        reportLoginBridgeWarning('session_account_mismatch', oauth, authResult, navUrl)
        setNoticeMessage('登录会话与提交的账号不一致，请重新登录。', 'error')
      } else if (!navUrl || navUrl === '/') {
        reportLoginBridgeWarning('navigation_url_missing', oauth, authResult, navUrl)
        setNoticeMessage('未能建立登录会话，请重新登录。', 'error')
      } else {
        reportLoginBridgeWarning('silent_bridge_unavailable', oauth, authResult, navUrl)
        // iframe 可能已用掉原 state。整页回退必须重新初始化 OAuth，不再发送凭据。
        let freshUrl = ''
        try {
          const freshOAuth = await startOAuth({ redirectTo: getRedirectTo() })
          if (signal.aborted) return false
          freshUrl = getFreshAuthorizeUrl(freshOAuth, oauth, navUrl)
        } catch {
          if (signal.aborted) return false
        }
        if (freshUrl) {
          keepOAuthLoginReturnTo(returnTo)
          window.location.href = freshUrl
          keepSessionMarker = true
          return true
        }
        reportLoginBridgeWarning('fresh_oauth_unavailable', oauth, authResult, freshUrl)
        setNoticeMessage(CALLBACK_FAILURE_MESSAGE, 'error')
      }
      return false
    } finally {
      if (!keepSessionMarker) clearAuthSessionMarker()
    }
  }

  function finishRegistration(oauth: any, result: any, mobile: string) {
    void runLoginAttempt(async (signal) => {
      const completed = await handleLoginFlowComplete(signal, oauth, result, mobile)
      if (!completed && !signal.aborted) {
        resetLoginCredentials(mobile)
        setLoginMode('sms')
      }
    })
  }

  async function refreshCaptcha({ silent = false, signal }: { silent?: boolean; signal?: AbortSignal } = {}) {
    const mobileRevision = mobileRevisionRef.current
    const request = ++captchaRequestRef.current
    const isCurrent = () =>
      !signal?.aborted && mobileRevisionRef.current === mobileRevision && captchaRequestRef.current === request
    try {
      const next = await getCaptcha()
      if (isCurrent()) setCaptcha({ id: next.id || '', image: next.image || '', answer: '' })
    } catch (error) {
      if (!silent && isCurrent()) {
        setNoticeMessage(getAuthErrorMessage(error, '图形验证码刷新失败，请稍后重试'), 'error')
      }
    }
  }

  async function handleCaptchaError(error: any, signal?: AbortSignal) {
    if (!isCaptchaChallengeError(error)) return false
    const mobileRevision = mobileRevisionRef.current
    await refreshCaptcha({ silent: true, signal })
    if (!signal?.aborted && mobileRevisionRef.current === mobileRevision) {
      setLoginErrors((prev) => ({ ...prev, captcha: getAuthErrorMessage(error, '请输入图形验证码') }))
    }
    return true
  }

  async function prepareAuthStart(signal?: AbortSignal) {
    await clearExistingSession()
    if (signal?.aborted) return null
    const inviteCode = getInviteCode()
    return startOAuth({
      redirectTo: getRedirectTo(),
      inviteCode,
      inviteType: inviteCode ? getInviteType() : '',
    })
  }

  function switchMode(mode: 'password' | 'sms') {
    setLoginMode(mode)
    setNoticeMessage('')
    clearLoginErrors()
  }

  async function requestCode() {
    if (codeCountdown > 0 || authActionOpen || loginAttemptRef.current || smsRequestRef.current) return
    const mobile = normalizeMobile(phone)
    if (!mobile) {
      setLoginErrors((prev) => ({ ...prev, phone: '请输入手机号' }))
      return
    }
    if (!isValidSmsMobile(mobile)) {
      setLoginErrors((prev) => ({ ...prev, phone: '请输入正确的手机号' }))
      return
    }
    if (captcha.image && !captcha.answer.trim()) {
      setLoginErrors((prev) => ({ ...prev, captcha: '请输入图形验证码' }))
      return
    }
    clearLoginError('phone')
    const request = Symbol()
    const mobileRevision = mobileRevisionRef.current
    const isCurrent = () => smsRequestRef.current === request && mobileRevisionRef.current === mobileRevision
    smsRequestRef.current = request
    setIsSendingCode(true)
    try {
      await sendAuthSms({
        authStart: null,
        mobile,
        purpose: 'login',
        captchaId: captcha.id,
        captchaAnswer: captcha.answer.trim(),
      })
      if (smsRequestRef.current === request) markSent(mobile)
      if (isCurrent()) setNoticeMessage('验证码已发送', 'success')
    } catch (error) {
      if (!isCurrent()) return
      const captchaRequired = await handleCaptchaError(error)
      if (isCurrent()) {
        const fallback = captchaRequired ? '请输入图形验证码' : '验证码发送失败，请稍后重试'
        setNoticeMessage(getAuthErrorMessage(error, fallback), 'error')
      }
    } finally {
      if (smsRequestRef.current === request) {
        smsRequestRef.current = null
        setIsSendingCode(false)
      }
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
    } else if (!isValidSmsMobile(mobile)) {
      nextErrors.phone = '请输入正确的手机号'
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
  function submitLogin(mobile: string, credential: string) {
    if (authActionOpen) return
    return runLoginAttempt(async (signal) => {
      if (import.meta.env.DEV && !hasRemoteBackend) {
        await handleLoginFlowComplete(signal)
        return
      }

      let oauth: any
      let loginResult: any
      try {
        oauth = await prepareAuthStart(signal)
      } catch (error) {
        if (!signal.aborted) {
          setNoticeMessage(getAuthErrorMessage(error, '登录初始化失败，请稍后重试。'), 'error')
        }
        return
      }
      if (signal.aborted) return
      try {
        const common = { authStart: oauth, mobile, captchaId: captcha.id, captchaAnswer: captcha.answer.trim() }
        loginResult =
          loginMode === 'password'
            ? await loginWithPassword({ ...common, password: credential })
            : await loginWithSmsCode({ ...common, smsCode: credential })
      } catch (error) {
        if (signal.aborted) return
        const captchaRequired = await handleCaptchaError(error, signal)
        if (signal.aborted) return
        if (captchaRequired) {
          setNoticeMessage(getAuthErrorMessage(error, '请输入图形验证码'), 'error')
          return
        }
        // 该号码未注册时，引导用户获取独立的注册验证码。
        if (loginMode === 'sms' && Number((error as any)?.code) === 20003) {
          setSmsRegister({ mobile })
          return
        }
        const fallback =
          loginMode === 'password' ? '登录失败，请稍后重试，也可以尝试短信验证码登录。' : '登录失败，请稍后重试。'
        setNoticeMessage(getAuthErrorMessage(error, fallback), 'error')
        return
      }
      await handleLoginFlowComplete(signal, oauth, loginResult, mobile)
    })
  }

  function handleSubmit() {
    if (authActionOpen || loginAttemptRef.current) return // 回车和按钮共用同步提交锁。
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
    if (label === '隐私政策') {
      setShowPrivacyPolicy(true)
      return
    }
    if (label === '用户协议') {
      agreementModalContextRef.current = 'view'
      setShowAgreementModal(true)
      return
    }
    setNoticeMessage(`${label}功能即将开放`)
  }

  function handleAgreementAgree() {
    setShowAgreementModal(false)
    setAgreed(true) // 「同意并继续」即勾选(与表单复选框联动)
    if (agreementModalContextRef.current === 'login') {
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
    // 离开页面时作废本次登录，包括还未启动桥接的凭据请求。
    return () => {
      smsRequestRef.current = null
      mobileRevisionRef.current += 1
      loginAttemptRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!hasOAuthCallbackFailure(search)) {
      handledCallbackFailureRef.current = false
      return
    }
    if (handledCallbackFailureRef.current) return
    handledCallbackFailureRef.current = true
    const retryTarget = consumeOAuthLoginReturnTo() || readLoginReturnTo(locationState)
    showToast(CALLBACK_FAILURE_MESSAGE, 'error', 5000)
    navigate('/login', { replace: true, state: retryTarget ? { returnTo: retryTarget } : undefined })
  }, [locationState, navigate, search, showToast])

  // 带推广码进站(分享链接 /login?invite_code=…):属新用户场景,直接弹出注册框,省掉手点「免费注册」。
  // (推广码本身由 App 的 captureInviteCode 落地即捕获,注册时读取;这里只负责自动打开注册。)
  useEffect(() => {
    const invited = new URLSearchParams(window.location.search).get('invite_code')
    if (invited && invited.trim()) setAuthModal('register')
  }, [])

  // ── 登录页大图轮播(slug=login)──────────────────────────────────────
  // 有数据用 banner 列表;为空回退到静态四项(只有标题、无媒体)。
  const hasBanners = Array.isArray(loginBanners) && loginBanners.length > 0
  // 标题用 banner.title;为空时给可读兜底名(避免出现无障碍名称为空的按钮)
  const navTitles = hasBanners ? loginBanners!.map((b, i) => b.title?.trim() || `第 ${i + 1} 张`) : NAV_ITEMS
  // heroIndex 夹回有效范围
  const safeIndex = navTitles.length ? Math.min(heroIndex, navTitles.length - 1) : 0
  const activeBanner = hasBanners ? loginBanners![safeIndex] : null

  const heroVideoRefs = useRef(new Map<string, HTMLVideoElement>())
  const targetMediaUrlRef = useRef('')
  const mediaTransitionTimerRef = useRef<number | null>(null)
  const { muted, needsInteraction, playVideo, toggleVideoSound } = useBackgroundVideoSound()

  /**
   * 窄屏是否隐藏了整块大图区（与 LoginView.css 的 max-width:768px 断点一致）。
   *
   * 光靠 CSS 的 display:none 拦不住媒体加载：元素仍在 DOM 里，autoPlay + preload 照常下载，
   * 下面的 effect 还会主动 play()。结果是手机用户为一段自己根本看不见的视频付流量——
   * 首屏那条 banner 实测 69.6MB。所以这里必须在 JSX 层面就不渲染它。
   */
  const [heroHidden, setHeroHidden] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 768px)')
    const sync = () => setHeroHidden(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  const selectHero = (index: number) => {
    if (index === safeIndex) return
    // 手动切换时定格当前视频，等待目标媒体首帧在它上方淡入。
    heroVideoRefs.current.get(activeBanner?.mediaUrl || '')?.pause()
    setHeroIndex(index)
  }

  // 切下一张:基于「钳位后的当前索引」推进,避免列表长度变化后 heroIndex 越界导致跳/重。
  const goNextHero = () => {
    setHeroIndex((i) => {
      const len = navTitles.length
      if (!len) return 0
      return (Math.min(i, len - 1) + 1) % len
    })
  }
  // 媒体加载失败:多张则切下一张(单张则保持,透出静态底图)。
  const handleMediaError = () => {
    if (navTitles.length > 1) goNextHero()
  }

  // 自动轮播:视频幻灯片由「播放结束」驱动;图片幻灯片用 3s 定时;<2 张不轮播。
  useEffect(() => {
    if (!hasBanners || navTitles.length < 2) return
    if (activeBanner?.mediaType === 'video') return // 视频靠 onEnded 切换
    const t = window.setTimeout(goNextHero, IMAGE_AUTOPLAY_MS)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBanners, navTitles.length, safeIndex, activeBanner?.mediaType])

  /** 切换目标媒体时保留当前图层；目标首帧准备好后再交叉淡入。 */
  const lastMediaUrlRef = useRef('')
  const playVideoLatest = useLatestCallback(playVideo)
  const activeMediaUrl = activeBanner?.mediaUrl || ''
  targetMediaUrlRef.current = activeMediaUrl

  const displayedBanner = hasBanners
    ? loginBanners!.find((banner) => banner.mediaUrl === displayedMediaUrl) || null
    : null
  const mediaLayers = [displayedBanner, activeBanner].filter(
    (banner, index, items): banner is NonNullable<typeof banner> =>
      Boolean(banner?.mediaUrl) && items.findIndex((item) => item?.mediaUrl === banner?.mediaUrl) === index,
  )

  const markTargetMediaReady = (url: string) => {
    // 迟到的 loadeddata/canplay/onload 只能影响它自己的旧请求，不能提前放出当前目标媒体。
    if (!url || targetMediaUrlRef.current !== url) return
    setReadyMediaUrl(url)
    // 首屏没有旧媒体可保留，首个成功解码的媒体立即成为稳定展示层；
    // 否则用户在淡入的 380ms 内切换 Tab，会因为 displayedMediaUrl 仍为空而误删当前画面。
    setDisplayedMediaUrl((current) => current || url)
    if (mediaTransitionTimerRef.current !== null) window.clearTimeout(mediaTransitionTimerRef.current)
    mediaTransitionTimerRef.current = window.setTimeout(() => {
      if (targetMediaUrlRef.current === url) setDisplayedMediaUrl(url)
      mediaTransitionTimerRef.current = null
    }, 380)
  }

  useEffect(() => {
    const url = activeMediaUrl
    if (url === lastMediaUrlRef.current) return
    lastMediaUrlRef.current = url
    setReadyMediaUrl('')
    if (mediaTransitionTimerRef.current !== null) {
      window.clearTimeout(mediaTransitionTimerRef.current)
      mediaTransitionTimerRef.current = null
    }
    const v = heroVideoRefs.current.get(url)
    if (v && activeBanner?.mediaType === 'video') void playVideoLatest(v)
  }, [activeBanner?.mediaType, activeMediaUrl, playVideoLatest])

  useEffect(
    () => () => {
      if (mediaTransitionTimerRef.current !== null) window.clearTimeout(mediaTransitionTimerRef.current)
    },
    [],
  )

  return (
    <main className="zlogin">
      {/* 始终铺静态 login-hero 背景图:既是无数据时的兜底,也是 banner 图/视频加载失败时透出的底图。 */}
      <aside className="zlogin-hero">
        <picture className="zlogin-hero-fallback" aria-hidden="true">
          <source srcSet={loginHero} type="image/webp" />
          <img src={loginHeroFallback} alt="" loading="eager" decoding="async" />
        </picture>
        {/* 大图媒体:有 banner 数据时按当前幻灯片展示(图=图层,视频=播放并播完切下一张);
            加载失败时:多张→切下一张,单张→隐藏(透出静态底图)。 */}
        {hasBanners &&
          !heroHidden &&
          mediaLayers.map((banner) => {
            const url = banner.mediaUrl
            const isReady = url === displayedMediaUrl || url === readyMediaUrl
            return (
              <div key={url} className={`zlogin-hero-media${isReady ? ' is-ready' : ''}`} aria-hidden="true">
                {banner.mediaType === 'video' ? (
                  <video
                    ref={(node) => {
                      if (node) heroVideoRefs.current.set(url, node)
                      else heroVideoRefs.current.delete(url)
                    }}
                    className="zlogin-hero-video"
                    src={url}
                    muted={muted}
                    playsInline
                    autoPlay
                    // 不用 auto：auto 会让浏览器尽力缓冲整片，而首屏那条 banner 实测 69.6MB，
                    // 用户只是想登录，却在后台跑一个几十兆的下载，把登录接口的带宽也挤掉。
                    preload="metadata"
                    // 多个幂等的就绪入口：canplay 之外补 loadeddata / playing，
                    // 任一先到就撤占位，避免个别浏览器某个事件不触发时一直显示不出来
                    onLoadedData={() => markTargetMediaReady(url)}
                    onPlaying={() => markTargetMediaReady(url)}
                    onCanPlay={(event) => {
                      markTargetMediaReady(url)
                      if (targetMediaUrlRef.current === url) void playVideo(event.currentTarget)
                    }}
                    onEnded={() => {
                      if (targetMediaUrlRef.current === url) goNextHero()
                    }}
                    onError={() => {
                      if (targetMediaUrlRef.current === url) handleMediaError()
                    }}
                  />
                ) : (
                  <img
                    className="zlogin-hero-img"
                    src={url}
                    alt=""
                    onLoad={() => markTargetMediaReady(url)}
                    onError={() => {
                      if (targetMediaUrlRef.current === url) handleMediaError()
                    }}
                  />
                )}
              </div>
            )
          })}
        {activeBanner?.mediaType === 'video' && !heroHidden && (
          <MediaSoundToggle
            className="zlogin-sound-toggle"
            muted={muted}
            needsInteraction={needsInteraction}
            onToggle={() => toggleVideoSound(heroVideoRefs.current.get(activeMediaUrl) || null)}
          />
        )}
        <nav className="zlogin-nav">
          {navTitles.map((title, i) => (
            <button
              type="button"
              key={`${title}-${i}`}
              className={`zlogin-nav-item${i === safeIndex ? ' is-active' : ''}`}
              onClick={() => selectHero(i)}
            >
              {title}
            </button>
          ))}
        </nav>
      </aside>

      <section className="zlogin-panel" aria-label="帧智汇登录">
        <button
          type="button"
          className="zlogin-back"
          disabled={authActionOpen}
          onClick={goBack}
          aria-label="返回上一页"
        >
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
            <button
              type="button"
              className="zlogin-link"
              disabled={isSubmitting || authActionOpen}
              onClick={() => setAuthModal('register')}
            >
              免费注册
            </button>
          </p>

          <div className="zlogin-tabs" role="tablist" aria-label="登录方式">
            <button
              type="button"
              role="tab"
              aria-selected={loginMode === 'sms'}
              disabled={isSubmitting || authActionOpen}
              className={`zlogin-tab${loginMode === 'sms' ? ' is-active' : ''}`}
              onClick={() => switchMode('sms')}
            >
              短信登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={loginMode === 'password'}
              disabled={isSubmitting || authActionOpen}
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
                autoComplete="tel"
                maxLength={11}
                placeholder="手机号"
                aria-label="手机号"
                value={phone}
                readOnly={isSubmitting}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, '').slice(0, 11)
                  if (next !== phone) resetLoginCredentials(next)
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>

            {loginMode === 'password' ? (
              <div className={`zlogin-field${loginErrors.password ? ' has-error' : ''}`}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
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
                  disabled={codeCountdown > 0 || isSendingCode || isSubmitting || authActionOpen}
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
                <button
                  type="button"
                  className="zlogin-captcha-refresh"
                  aria-label="刷新图形验证码"
                  disabled={isSubmitting || authActionOpen}
                  onClick={() => void refreshCaptcha()}
                >
                  <img src={captcha.image} alt="" />
                </button>
              </div>
            )}
          </div>

          {(loginErrors.phone || loginErrors.password || loginErrors.code || loginErrors.captcha) && (
            <span className="zlogin-err">
              {loginErrors.phone || loginErrors.password || loginErrors.code || loginErrors.captcha}
            </span>
          )}

          <button
            type="button"
            className="zlogin-submit"
            disabled={isSubmitting || authActionOpen}
            onClick={handleSubmit}
          >
            {isSubmitting ? '登录中…' : '登录'}
          </button>

          <div className="zlogin-foot">
            <label className="zlogin-remember">
              <input
                type="checkbox"
                checked={rememberAccount}
                onChange={(event) => setRememberAccount(event.target.checked)}
              />
              <span>记住账号</span>
            </label>
            <button
              type="button"
              className="zlogin-forgot"
              disabled={isSubmitting || authActionOpen}
              onClick={() => setAuthModal('forgot')}
            >
              忘记密码？
            </button>
          </div>

          <label className="zlogin-agree">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              已经阅读并同意
              {/* 链接在 label 内,且无 href 不算交互内容 → 点击会连带切换复选框;阻止默认/冒泡避免误改勾选 */}
              <a
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleLink('用户协议')
                }}
              >
                《用户协议》
              </a>
              及
              <a
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleLink('隐私政策')
                }}
              >
                《隐私政策》
              </a>
            </span>
          </label>
        </div>
      </section>

      {showPrivacyPolicy && <PrivacyPolicyModal onClose={() => setShowPrivacyPolicy(false)} />}
      {showAgreementModal && (
        <AgreementModal
          agreed={agreed}
          onAgreedChange={setAgreed}
          onAgree={handleAgreementAgree}
          onCancel={handleAgreementCancel}
        />
      )}

      {/* 注册 / 重置密码 弹窗 */}
      {authModal && (
        <AuthActionModal
          key={authModal}
          mode={authModal}
          prepareRegistration={prepareAuthStart}
          onClose={() => setAuthModal(null)}
          onAuthed={(as, result, mobile) => {
            setAuthModal(null)
            finishRegistration(as, result, mobile)
          }}
          onResetDone={(m) => {
            setAuthModal(null)
            switchMode('password')
            resetLoginCredentials(m)
            setNoticeMessage('重置密码成功,请用新密码登录', 'success')
          }}
          onAlreadyRegistered={(m) => {
            setAuthModal(null)
            switchMode('password')
            resetLoginCredentials(m)
          }}
        />
      )}

      {/* 验证码登录未成功 → 获取注册验证码并补全账号 */}
      {smsRegister && (
        <AuthActionModal
          mode="sms-register"
          prepareRegistration={prepareAuthStart}
          prefill={smsRegister}
          onAlreadyRegistered={(m) => {
            setSmsRegister(null)
            switchMode('password')
            resetLoginCredentials(m)
          }}
          onClose={() => setSmsRegister(null)}
          onAuthed={(as, result, mobile) => {
            setSmsRegister(null)
            finishRegistration(as, result, mobile)
          }}
        />
      )}
    </main>
  )
}
