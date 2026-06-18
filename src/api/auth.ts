// @ts-nocheck — 逐字移植自框架无关的 JS API 客户端；类型化为后续增量工作。
/**
 * Auth API 客户端
 * 登录/注册/登出、短信验证码、会话管理、DeepAuth 扫码登录、团队邀请码操作。
 */
import { shouldRequestAuthenticatedSession } from '../utils/workflowGuards'

const AUTH_SESSION_MARKER_KEY = 'zzh_has_auth_session'

const businessRemoteOrigin = readBaseUrl('VITE_ZZH_REMOTE_ORIGIN', '')
const deepAuthRemoteOrigin = readBaseUrl('VITE_DEEPAUTH_REMOTE_ORIGIN', '')
const businessApiBaseUrl = resolveProxyFriendlyBaseUrl(import.meta.env.VITE_ZZH_API_BASE_URL, '', businessRemoteOrigin)
const deepAuthApiBaseUrl = resolveProxyFriendlyBaseUrl(
  import.meta.env.VITE_DEEPAUTH_API_BASE_URL,
  '/deepauth',
  deepAuthRemoteOrigin,
)

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

export function sendAuthSms({ authStart, mobile, purpose, captchaId, captchaAnswer }) {
  return requestDeepAuth(authStart?.sms_send_api_url || '/api/v1/public/auth/sms/send', {
    mobile,
    purpose,
    captcha_id: captchaId,
    captcha_answer: captchaAnswer,
  })
}

export function loginWithPassword({ authStart, mobile, password, captchaId, captchaAnswer }) {
  return requestDeepAuth(authStart?.login_api_url || '/api/v1/public/auth/login', {
    ...authStartContext(authStart),
    mobile,
    password,
    method: 'password',
    captcha_id: captchaId,
    captcha_answer: captchaAnswer,
  })
}

export function loginWithSmsCode({ authStart, mobile, smsCode, captchaId, captchaAnswer }) {
  return requestDeepAuth(authStart?.login_api_url || '/api/v1/public/auth/login', {
    ...authStartContext(authStart),
    mobile,
    sms_code: smsCode,
    method: 'sms_code',
    captcha_id: captchaId,
    captcha_answer: captchaAnswer,
  })
}

export function registerAccount({ authStart, mobile, password, smsCode, termsAccepted }) {
  return requestDeepAuth(authStart?.register_api_url || '/api/v1/public/auth/register', {
    ...authStartContext(authStart),
    mobile,
    password,
    sms_code: smsCode,
    terms_accepted: termsAccepted,
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

export function getCurrentUser() {
  return requestJson(buildUrl(businessApiBaseUrl, '/api/v1/me'))
}

export function listWorkspaceMembers(workspaceId) {
  return requestJson(buildUrl(businessApiBaseUrl, `/api/v1/workspaces/${workspaceId}/members`))
}

export async function getAuthenticatedSession() {
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
  return error instanceof AuthApiError && error.status === 401
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

  return payload?.data ?? payload
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
  } catch {
    return buildUrl(localBaseUrl, url)
  }

  return url
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