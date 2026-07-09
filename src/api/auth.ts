// @ts-nocheck — 逐字移植自框架无关的 JS API 客户端；类型化为后续增量工作。
/**
 * Auth API 客户端
 * 登录/注册/登出、短信验证码、会话管理、DeepAuth 扫码登录、团队邀请码操作。
 */
import { shouldRequestAuthenticatedSession } from '../utils/workflowGuards'

const AUTH_SESSION_MARKER_KEY = 'zzh_has_auth_session'

const businessRemoteOrigin = readBaseUrl('VITE_ZZH_REMOTE_ORIGIN', '')
const deepAuthRemoteOrigin = readBaseUrl('VITE_DEEPAUTH_REMOTE_ORIGIN', '')
const ssoRemoteOrigin = readBaseUrl('VITE_SSO_REMOTE_ORIGIN', '')
const businessApiBaseUrl = resolveProxyFriendlyBaseUrl(import.meta.env.VITE_ZZH_API_BASE_URL, '', businessRemoteOrigin)
const deepAuthApiBaseUrl = resolveProxyFriendlyBaseUrl(
  import.meta.env.VITE_DEEPAUTH_API_BASE_URL,
  '/deepauth',
  deepAuthRemoteOrigin,
)
const ssoApiBaseUrl = resolveProxyFriendlyBaseUrl('', '/sso', ssoRemoteOrigin)

export class AuthApiError extends Error {
  constructor(message, { status = 0, code = null, requestId = '', response = null }: any = {}) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.response = response
  }
}

export async function startOAuth({ redirectTo }: any = {}) {
  const query = redirectTo ? `?${new URLSearchParams({ redirect_to: redirectTo })}` : ''

  return requestJson(buildUrl(businessApiBaseUrl, `/api/v1/auth/oauth-start${query}`))
}

// 统一直接走「公开认证 API」(DeepAuth /api/v1/public/auth/*),不再依赖 oauth-start 返回的
// 各 *_api_url(它们可能指向别的 host/路径,易踩跨域 cookie / redirect_uri 问题)。
// 各接口请求体字段以 swagger 为准:login 支持 client_id+return_to;register 仅 return_to(无 client_id);
// password/forgot 与 sms/send 二者皆不需要。
const PUBLIC_AUTH = {
  login: '/api/v1/public/auth/login',
  register: '/api/v1/public/auth/register',
  forgot: '/api/v1/public/auth/password/forgot',
  smsSend: '/api/v1/public/auth/sms/send',
}

export function sendAuthSms({ authStart, mobile, purpose, captchaId, captchaAnswer }) {
  void authStart // 保留入参兼容旧调用;短信接口本身不需要 authStart
  return requestDeepAuth(PUBLIC_AUTH.smsSend, {
    mobile,
    purpose,
    captcha_id: captchaId,
    captcha_answer: captchaAnswer,
  })
}

export function loginWithPassword({ authStart, mobile, password, captchaId, captchaAnswer }) {
  return requestDeepAuth(PUBLIC_AUTH.login, {
    ...authStartContext(authStart),
    mobile,
    password,
    method: 'password',
    captcha_id: captchaId,
    captcha_answer: captchaAnswer,
  })
}

export function loginWithSmsCode({ authStart, mobile, smsCode, captchaId, captchaAnswer }) {
  return requestDeepAuth(PUBLIC_AUTH.login, {
    ...authStartContext(authStart),
    mobile,
    sms_code: smsCode,
    method: 'sms_code',
    captcha_id: captchaId,
    captcha_answer: captchaAnswer,
  })
}

export function registerAccount({ authStart, mobile, password, smsCode, termsAccepted, inviteCode = '' }) {
  return requestDeepAuth(PUBLIC_AUTH.register, {
    return_to: authStart?.return_to, // register 字段无 client_id,只带 return_to(空则被 removeEmptyFields 去掉)
    mobile,
    password,
    sms_code: smsCode,
    terms_accepted: termsAccepted,
    invite_code: inviteCode, // 分享链接带来的推广码(空则被 removeEmptyFields 去掉)
  })
}

// 找回/重置密码:手机号 + 新密码 + 验证码(短信 purpose=reset_password)。成功后用新密码重新登录。
export function resetPassword({ authStart, mobile, newPassword, smsCode }) {
  void authStart // 保留入参兼容旧调用;找回密码接口本身不需要 authStart
  return requestDeepAuth(PUBLIC_AUTH.forgot, {
    mobile,
    new_password: newPassword,
    sms_code: smsCode,
  })
}

export function getCaptcha() {
  return requestJson(buildUrl(deepAuthApiBaseUrl, '/captcha'))
}

export function getSession() {
  return requestJson(buildUrl(businessApiBaseUrl, '/api/v1/auth/session'))
}

export function refreshSession() {
  return businessPost('/api/v1/auth/refresh')
}

export function logoutSession() {
  return businessPost('/api/v1/auth/logout')
}

// 登录前清掉旧的业务会话：换账号时旧的会话 cookie（DEEPAUTH_SID，24h）仍有效，
// 若不先登出，登录后立即 getSession() 会直接读回旧账号 → 「换账号仍是旧账号」。
// 必须在 oauth-start 之前调用，否则会把本次 OAuth 的 state 一并清掉导致回调 400。
// 全程容错（未登录/已失效都忽略），不阻断后续登录。
export async function clearExistingSession() {
  try {
    await logoutSession()
  } catch {
    // 未登录或会话已失效：忽略即可
  }
  clearAuthSessionMarker()
}

export function getCurrentUser() {
  return requestJson(buildUrl(businessApiBaseUrl, '/api/v1/me'))
}

// PATCH /api/v1/me/profile —— 修改我的资料(用户名等,仅改当前登录用户自己)。
// 用户名唯一(不可重复):重复由后端校验并报错(AuthApiError.status/code/message),前端据此提示「已被占用」。
export function updateMyProfile(payload) {
  return requestJson(buildUrl(businessApiBaseUrl, '/api/v1/me/profile'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
}

// POST /api/v1/me/avatar —— 上传我的头像(当前登录用户自己)。
// 与修改资料分开：头像走专用上传接口，昵称等文字资料仍走 /api/v1/me/profile。
export function uploadMyAvatar(file) {
  const formData = new FormData()
  formData.append('file', file)
  return requestJson(buildUrl(businessApiBaseUrl, '/api/v1/me/avatar'), {
    method: 'POST',
    body: formData,
  })
}

export function listWorkspaceMembers(workspaceId) {
  return requestJson(buildUrl(businessApiBaseUrl, `/api/v1/workspaces/${workspaceId}/members`))
}

// 同一时刻多个来源(初次挂载 / 续期失败重拉 / 守卫 / 登录轮询)可能并发校验会话。
// 用一个共享 in-flight promise 去重:并发调用共用同一次 session→refresh,避免打成 3~4 对
// 401 请求风暴。promise 结束即清空,后续(如登录轮询的下一拍)可再次正常发起。
let authSessionPromise: Promise<any> | null = null

export function getAuthenticatedSession() {
  if (!authSessionPromise) {
    authSessionPromise = fetchAuthenticatedSession()
    // finally 仅用于结束后清空缓存;其返回的新 promise 丢弃,
    // 对外 return 的是原始 promise(保留 resolve/reject 供调用方 await/catch)。
    authSessionPromise.finally(() => {
      authSessionPromise = null
    })
  }
  return authSessionPromise
}

// 登出时调用:丢弃共享的 in-flight session promise。否则登出前发起的一次会话校验若在登出后才 resolve,
// 其 .then 会把刚清掉的会话「复活」(setSession/setIsAuthenticated(true))。配合调用方 bump 序号双保险。
export function resetAuthenticatedSession() {
  authSessionPromise = null
}

async function fetchAuthenticatedSession() {
  // 如果正在进行 SSO 登录回调，即使没有历史 marker 也应该尝试获取 session
  const ssoPending = window.sessionStorage.getItem('zzh_sso_pending') === '1'
  const shouldAttemptRefresh = hasAuthSessionMarker() || ssoPending

  if (!shouldRequestAuthenticatedSession(shouldAttemptRefresh)) {
    throw new AuthApiError('未登录', {
      status: 401,
      code: 'UNAUTHORIZED',
    })
  }

  let session

  try {
    session = await getSession()
  } catch (error) {
    if (!isUnauthorizedAuthError(error) || !shouldAttemptRefresh) {
      throw error
    }

    session = await refreshSession()
  }

  let profile = {}

  try {
    profile = await getCurrentUser()
  } catch (error) {
    if (isUnauthorizedAuthError(error)) {
      throw error
    }

    profile = { profileLoadError: error }
  }

  const authContext = { ...session, ...profile }
  authContext.currentMember = await getCurrentWorkspaceMember(authContext)

  return authContext
}

function pickCurrentWorkspaceId(authContext) {
  const candidates = [
    authContext?.workspace?.id,
    authContext?.currentWorkspace?.id,
    authContext?.current_workspace?.id,
    authContext?.workspace_id,
    authContext?.current_workspace_id,
    authContext?.workspaces?.[0]?.id,
  ]
  return Number(candidates.find((value) => Number(value || 0) > 0) || 0)
}

export function hasAuthSessionMarker() {
  return window.localStorage.getItem(AUTH_SESSION_MARKER_KEY) === '1'
}

export function markAuthSessionExpected() {
  window.localStorage.setItem(AUTH_SESSION_MARKER_KEY, '1')
}

export function clearAuthSessionMarker() {
  window.localStorage.removeItem(AUTH_SESSION_MARKER_KEY)
}

export function getAuthNavigationUrl(authStart, authResult) {
  const redirectTo = authResult?.redirect_to

  if (redirectTo && redirectTo !== '/') {
    return toNavigationUrl(redirectTo, authStart)
  }

  return toNavigationUrl(authStart?.authorize_url || authStart?.return_to || '/', authStart)
}

export function getAuthErrorMessage(error, fallback = '请求失败，请稍后重试') {
  if (error instanceof AuthApiError && error.message) {
    return error.message
  }

  return fallback
}

export function isCaptchaChallengeError(error) {
  return error instanceof AuthApiError && (error.code === 20007 || error.code === 20008)
}

export function isUnauthorizedAuthError(error) {
  if (!(error instanceof AuthApiError)) return false
  // HTTP 401 或业务层 code_string === 'UNAUTHORIZED'（后端可能返回 200 + 业务错误码 10101）
  return error.status === 401 || error.code === 'UNAUTHORIZED'
}

function authStartContext(authStart) {
  return {
    client_id: authStart?.client_id,
    return_to: authStart?.return_to,
  }
}

function businessPost(path) {
  return requestJson(buildUrl(businessApiBaseUrl, path), { method: 'POST' })
}

async function getCurrentWorkspaceMember(authContext) {
  const userId = Number(authContext?.user?.id || 0)
  const workspaceId = pickCurrentWorkspaceId(authContext)

  if (!userId || !workspaceId) {
    return null
  }

  try {
    const members = await listWorkspaceMembers(workspaceId)

    if (!Array.isArray(members)) {
      return null
    }

    return members.find((member) => Number(member.user_id) === userId) || null
  } catch {
    return null
  }
}

function requestDeepAuth(url, body) {
  return requestJson(toProxiedUrl(url, deepAuthApiBaseUrl, deepAuthRemoteOrigin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(removeEmptyFields(body)),
  })
}

async function requestJson(url, options = {}) {
  let response

  try {
    response = await fetch(url, { credentials: 'include', ...options })
  } catch (error) {
    throw new AuthApiError('网络请求失败，请检查接口服务或本地代理配置', {
      response: error,
    })
  }

  const payload = await readJsonResponse(response)

  if (!response.ok || isBusinessError(payload)) {
    throw new AuthApiError(payload?.message || `请求失败 (${response.status})`, {
      status: response.status,
      code: payload?.code ?? payload?.code_string ?? null,
      requestId: payload?.request_id || '',
      response: payload,
    })
  }

  // 用字段存在性判断而非 ?? ：避免把合法的 data:null（成功但无数据）回退成整个包裹对象。
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
}

async function readJsonResponse(response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new AuthApiError('接口返回格式异常', {
      status: response.status,
      response: text,
    })
  }
}

function isBusinessError(payload) {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  if (typeof payload.code === 'number' && payload.code !== 0) {
    return true
  }

  return typeof payload.code_string === 'string' && payload.code_string !== 'OK'
}

function toNavigationUrl(url, authStart) {
  if (!url) {
    return '/'
  }

  if (url.startsWith('/oauth2/')) {
    return buildUrl(deepAuthApiBaseUrl, url)
  }

  if (url.startsWith('/')) {
    return url
  }

  try {
    const parsedUrl = new URL(url)
    const origin = normalizeBaseUrl(parsedUrl.origin)
    const pathAndQuery = `${parsedUrl.pathname}${parsedUrl.search}`

    if (origin === deepAuthRemoteOrigin) {
      return buildUrl(deepAuthApiBaseUrl, pathAndQuery)
    }

    if (origin === businessRemoteOrigin) {
      return pathAndQuery
    }

    if (origin === ssoRemoteOrigin) {
      return buildUrl(ssoApiBaseUrl, pathAndQuery)
    }
  } catch {
    return authStart?.authorize_url ? toNavigationUrl(authStart.authorize_url, null) : '/'
  }

  // Reject any absolute URL that did not match a known origin to avoid open redirects.
  return '/'
}

function toProxiedUrl(url, localBaseUrl, remoteOrigin) {
  if (!url) {
    return localBaseUrl
  }

  if (url.startsWith('/')) {
    return buildUrl(localBaseUrl, url)
  }

  try {
    const parsedUrl = new URL(url)
    const origin = normalizeBaseUrl(parsedUrl.origin)
    const pathAndQuery = `${parsedUrl.pathname}${parsedUrl.search}`

    if (origin === remoteOrigin) {
      return buildUrl(localBaseUrl, pathAndQuery)
    }

    if (origin === businessRemoteOrigin) {
      return buildUrl(businessApiBaseUrl, pathAndQuery)
    }

    // SSO(8001) 的请求也走代理，确保 cookie 同域
    if (origin === ssoRemoteOrigin) {
      return buildUrl(ssoApiBaseUrl, pathAndQuery)
    }
  } catch {
    return buildUrl(localBaseUrl, url)
  }

  // origin 未匹配任何已知远程 → 走本地代理兜底，避免直连外网失败
  try {
    const parsedUrl = new URL(url)
    return buildUrl(localBaseUrl, `${parsedUrl.pathname}${parsedUrl.search}`)
  } catch {
    return buildUrl(localBaseUrl, url)
  }
}

function buildUrl(baseUrl, path) {
  if (!path) {
    return baseUrl
  }

  if (/^https?:\/\//.test(path)) {
    return path
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  if (!baseUrl) {
    return normalizedPath
  }

  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`
}

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '')
}

function readBaseUrl(envKey, fallback) {
  return normalizeBaseUrl(import.meta.env[envKey] || fallback)
}

function resolveProxyFriendlyBaseUrl(configuredBaseUrl, proxyBaseUrl, remoteOrigin) {
  const normalizedConfigured = normalizeBaseUrl(configuredBaseUrl)
  const normalizedProxy = normalizeBaseUrl(proxyBaseUrl)
  if (!import.meta.env.DEV) {
    return normalizedConfigured || normalizedProxy
  }
  if (!normalizedConfigured) {
    return normalizedProxy
  }
  if (remoteOrigin && normalizedConfigured === remoteOrigin) {
    return normalizedProxy
  }
  return normalizedConfigured
}

function removeEmptyFields(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== ''),
  )
}
