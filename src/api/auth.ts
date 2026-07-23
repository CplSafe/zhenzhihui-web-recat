// @ts-nocheck — 逐字移植自框架无关的 JS API 客户端；类型化为后续增量工作。
/**
 * Auth API 客户端
 * 登录/注册/登出、短信验证码、会话管理、DeepAuth 扫码登录、团队邀请码操作。
 */
import { shouldRequestAuthenticatedSession } from '../utils/workflowGuards'
import { createSingleFlight } from '../utils/singleFlight'
import { DEFAULT_API_REQUEST_TIMEOUT_MS, RequestAbortError, withRequestTimeout } from './requestTimeout'

/** 记录浏览器是否期待存在已登录会话，避免匿名页反复请求鉴权端点。 */
const AUTH_SESSION_MARKER_KEY = 'zzh_has_auth_session'

/** 浏览器只请求同源代理；真实后端主机由部署层配置，不写入客户端包。 */
const businessApiBaseUrl = ''
/** DeepAuth 通过开发/反向代理暴露的同源前缀。 */
const deepAuthApiBaseUrl = '/deepauth'

/** 携带 HTTP 状态、业务码和请求 ID 的统一鉴权异常。 */
export class AuthApiError extends Error {
  constructor(message, { status = 0, code = null, requestId = '', response = null, cause = null }: any = {}) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.response = response
    this.cause = cause
  }
}

/** 向业务后端申请 OAuth 上下文，可携带登录完成后的目标页。 */
export async function startOAuth({ redirectTo }: any = {}) {
  const query = redirectTo ? `?${new URLSearchParams({ redirect_to: redirectTo })}` : ''

  return requestJson(buildUrl(businessApiBaseUrl, `/api/v1/auth/oauth-start${query}`))
}

/**
 * DeepAuth 公开认证端点的同源路径。
 * 不信任 oauth-start 响应中可能指向其他主机的 API URL，避免跨域 cookie 和 redirect_uri 错配。
 */
const PUBLIC_AUTH = {
  login: '/api/v1/public/auth/login',
  register: '/api/v1/public/auth/register',
  forgot: '/api/v1/public/auth/password/forgot',
  smsSend: '/api/v1/public/auth/sms/send',
}

/** 发送登录、注册或重置密码用的短信验证码。 */
export function sendAuthSms({ authStart, mobile, purpose, captchaId, captchaAnswer }) {
  void authStart // 保留入参兼容旧调用;短信接口本身不需要 authStart
  return requestDeepAuth(PUBLIC_AUTH.smsSend, {
    mobile,
    purpose,
    captcha_id: captchaId,
    captcha_answer: captchaAnswer,
  })
}

/** 使用手机号、密码和可选图形验证码登录。 */
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

/** 使用手机号、短信码和可选图形验证码登录。 */
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

/** 注册新账号，并透传用户条款确认和可选邀请码。 */
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

/** 通过手机号和 reset_password 短信码重置密码。 */
export function resetPassword({ authStart, mobile, newPassword, smsCode }) {
  void authStart // 保留入参兼容旧调用;找回密码接口本身不需要 authStart
  return requestDeepAuth(PUBLIC_AUTH.forgot, {
    mobile,
    new_password: newPassword,
    sms_code: smsCode,
  })
}

/** 获取 DeepAuth 图形验证码挑战。 */
export function getCaptcha() {
  return requestJson(buildUrl(deepAuthApiBaseUrl, '/captcha'))
}

/** 读取当前业务会话，未登录时由请求层转换为 AuthApiError。 */
export function getSession() {
  return requestJson(buildUrl(businessApiBaseUrl, '/api/v1/auth/session'))
}

/** 刷新当前会话，支持由调用方取消。 */
export function refreshSession({ signal } = {}) {
  return businessPost('/api/v1/auth/refresh', { signal })
}

/** 通知后端注销当前会话。 */
export function logoutSession() {
  return businessPost('/api/v1/auth/logout')
}

/**
 * 换账号登录前容错清理旧业务会话，防止长效 cookie 让新登录读回旧账号。
 * 必须在 oauth-start 之前调用，以免销毁本次 OAuth state；未登录或旧会话失效不阻断后续流程。
 */
export async function clearExistingSession() {
  try {
    await logoutSession()
  } catch {
    // 未登录或会话已失效：忽略即可
  }
  clearAuthSessionMarker()
}

/** 读取当前登录用户资料。 */
export function getCurrentUser() {
  return requestJson(buildUrl(businessApiBaseUrl, '/api/v1/me'))
}

/** 修改当前用户的文字资料；用户名唯一性由后端校验并通过 AuthApiError 返回。 */
export function updateMyProfile(payload) {
  return requestJson(buildUrl(businessApiBaseUrl, '/api/v1/me/profile'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
}

/** 通过专用 multipart 端点上传当前用户头像，长上传显式不设通用短超时。 */
export function uploadMyAvatar(file) {
  const formData = new FormData()
  formData.append('file', file)
  return requestJson(buildUrl(businessApiBaseUrl, '/api/v1/me/avatar'), {
    method: 'POST',
    body: formData,
    // 头像文件上传受文件大小和用户网络影响，保留长流程不限时语义。
    timeoutMs: 0,
  })
}

/** 读取指定工作空间的成员列表。 */
export function listWorkspaceMembers(workspaceId) {
  return requestJson(buildUrl(businessApiBaseUrl, `/api/v1/workspaces/${workspaceId}/members`))
}

/**
 * 会话校验的单飞控制器：初始挂载、守卫和续期重拉共用同一个在途请求。
 * 这能避免 session→refresh 并发形成 401 风暴，reset 后的旧请求也不能清掉新一轮请求。
 */
const authSessionRequest = createSingleFlight<any>()

/** 去重获取完整鉴权上下文，包含会话、用户资料和当前成员。 */
export function getAuthenticatedSession() {
  return authSessionRequest.run(fetchAuthenticatedSession)
}

/** 登出时作废共享会话请求，防止较晚返回的旧响应重新写回已清空登录态。 */
export function resetAuthenticatedSession() {
  authSessionRequest.reset()
}

/** 执行 session 校验、必要时刷新，再合并可选的用户资料和当前成员。 */
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

  // 会话端点是认证链的信任根。HTTP 200 的空值、数组或基础类型都不能继续与
  // profile 响应合并，否则异常响应可能被拼装成看似已登录的上下文。
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new AuthApiError('未登录', {
      status: 401,
      code: 'UNAUTHORIZED',
      response: session,
    })
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

/** 兼容多种会话字段，提取当前工作空间 ID。 */
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

/** 判断浏览器是否记录了期待中的已登录会话。 */
export function hasAuthSessionMarker() {
  return window.localStorage.getItem(AUTH_SESSION_MARKER_KEY) === '1'
}

/** 在登录成功后写入会话期待标记。 */
export function markAuthSessionExpected() {
  window.localStorage.setItem(AUTH_SESSION_MARKER_KEY, '1')
}

/** 在登出或确认未授权后移除会话期待标记。 */
export function clearAuthSessionMarker() {
  window.localStorage.removeItem(AUTH_SESSION_MARKER_KEY)
}

/** 从认证启动与结果中解析经过安全校验的登录后跳转地址。 */
export function getAuthNavigationUrl(authStart, authResult) {
  const redirectTo = authResult?.redirect_to

  if (redirectTo && redirectTo !== '/') {
    return toNavigationUrl(redirectTo, authStart)
  }

  return toNavigationUrl(authStart?.authorize_url || authStart?.return_to || '/', authStart)
}

/** 将鉴权异常转为面向用户的消息，非标准异常使用兜底文案。 */
export function getAuthErrorMessage(error, fallback = '请求失败，请稍后重试') {
  if (error instanceof AuthApiError && error.message) {
    return error.message
  }

  return fallback
}

/** 判断错误是否要求用户完成图形验证码挑战。 */
export function isCaptchaChallengeError(error) {
  return error instanceof AuthApiError && (error.code === 20007 || error.code === 20008)
}

/** 同时识别 HTTP 401 和业务层 UNAUTHORIZED 为未授权错误。 */
export function isUnauthorizedAuthError(error) {
  if (!(error instanceof AuthApiError)) return false
  // HTTP 401 或业务层 code_string === 'UNAUTHORIZED'（后端可能返回 200 + 业务错误码 10101）
  return error.status === 401 || error.code === 'UNAUTHORIZED'
}

/** 仅从 OAuth 启动结果中挑选登录接口允许的 client_id 和 return_to。 */
function authStartContext(authStart) {
  return {
    client_id: authStart?.client_id,
    return_to: authStart?.return_to,
  }
}

/** 对无请求体的业务 POST 端点提供统一调用入口。 */
function businessPost(path, options = {}) {
  return requestJson(buildUrl(businessApiBaseUrl, path), { method: 'POST', ...options })
}

/** 根据当前用户和工作空间匹配成员记录，附加资料失败不破坏主会话。 */
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

/** 向同源 DeepAuth 代理发送 JSON，并移除未定义或空字符串字段。 */
function requestDeepAuth(url, body) {
  return requestJson(buildUrl(deepAuthApiBaseUrl, url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(removeEmptyFields(body)),
  })
}

/**
 * 鉴权请求的统一封装：始终携带同源 cookie，合并超时/取消信号，解析业务信封。
 * 只保留经过归一化的错误元数据；调用方不应记录 cookie、令牌或完整请求头。
 */
async function requestJson(url, options = {}) {
  let response
  let payload
  const hasTimeoutOverride = Object.prototype.hasOwnProperty.call(options, 'timeoutMs')
  const { timeoutMs, signal: externalSignal, ...fetchOptions } = options || {}

  try {
    const result = await withRequestTimeout(
      async (signal) => {
        const nextResponse = await fetch(url, {
          credentials: 'include',
          ...fetchOptions,
          ...(signal ? { signal } : {}),
        })
        const nextPayload = await readJsonResponse(nextResponse)
        return { response: nextResponse, payload: nextPayload }
      },
      {
        signal: externalSignal,
        defaultTimeoutMs: DEFAULT_API_REQUEST_TIMEOUT_MS,
        ...(hasTimeoutOverride ? { timeoutMs } : {}),
      },
    )
    response = result.response
    payload = result.payload
  } catch (error) {
    if (error instanceof RequestAbortError) {
      const abortedByCaller = error.abortCause === 'aborted'
      throw new AuthApiError(abortedByCaller ? '网络请求已取消' : '网络请求超时，请稍后重试', {
        response: error.originalError,
        cause: error.abortCause,
      })
    }
    if (error instanceof AuthApiError) {
      throw error
    }
    throw new AuthApiError('网络请求失败，请检查接口服务或本地代理配置', {
      response: error,
    })
  }

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

/** 先读取响应文本再解析 JSON，以便对非 JSON 错误响应给出统一异常。 */
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

/** 识别 HTTP 成功但业务 code 或 code_string 表示失败的信封。 */
function isBusinessError(payload) {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  if (typeof payload.code === 'number' && payload.code !== 0) {
    return true
  }

  return typeof payload.code_string === 'string' && payload.code_string !== 'OK'
}

/** 用于阻断 URL 中编码控制字符与编码反斜杠的安全正则。 */
const NAVIGATION_ENCODED_CONTROL_RE = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i
/** 检测 URL 中编码后的反斜杠，阻断网络路径绕过。 */
const NAVIGATION_ENCODED_BACKSLASH_RE = /%5c/i

/** 检测字符串中不可见的 C0/DEL 控制字符。 */
function hasControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

/**
 * 对候选跳转值做语法预检，拒绝空白注入、控制字符、反斜杠和双重编码的网络路径。
 */
function normalizeNavigationCandidate(value) {
  if (typeof value !== 'string' || !value) return ''
  if (
    value !== value.trim() ||
    hasControlCharacter(value) ||
    value.includes('\\') ||
    NAVIGATION_ENCODED_CONTROL_RE.test(value) ||
    NAVIGATION_ENCODED_BACKSLASH_RE.test(value)
  ) {
    return ''
  }

  let decodedPrefix = value.slice(0, 48)
  for (let round = 0; round < 2; round += 1) {
    try {
      const decoded = decodeURIComponent(decodedPrefix)
      if (decoded === decodedPrefix) break
      decodedPrefix = decoded
    } catch {
      break
    }
  }
  if (/^[\\/]{2}/.test(decodedPrefix)) return ''
  return value
}

/**
 * 只允许应用内相对路径或已知 OAuth 源，所有未匹配绝对 URL 都回退到首页。
 * 这是认证完成后防止开放重定向的核心边界。
 */
function toNavigationUrl(url, authStart) {
  const candidate = normalizeNavigationCandidate(url)
  if (!candidate) {
    return '/'
  }

  if (candidate.startsWith('/oauth2/')) {
    return buildUrl(deepAuthApiBaseUrl, candidate)
  }

  if (candidate.startsWith('/')) {
    return candidate
  }

  try {
    const parsedUrl = new URL(candidate)
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
      return '/'
    }
    const pathAndQuery = `${parsedUrl.pathname}${parsedUrl.search}`
    const authStartOrigin = getOAuthOriginFromAuthStart(authStart)

    if (normalizeBaseUrl(parsedUrl.origin) === authStartOrigin) {
      return buildUrl(deepAuthApiBaseUrl, pathAndQuery)
    }

    if (normalizeBaseUrl(parsedUrl.origin) === normalizeBaseUrl(globalThis.location?.origin || '')) {
      return pathAndQuery
    }
  } catch {
    return authStart?.authorize_url ? toNavigationUrl(authStart.authorize_url, null) : '/'
  }

  // 任何未匹配已知源的绝对地址都拒绝，防止开放重定向。
  return '/'
}

/** 仅从经校验的 OAuth 路径中提取可信认证源。 */
function getOAuthOriginFromAuthStart(authStart) {
  const candidates = [authStart?.authorize_url, authStart?.return_to]

  for (const candidate of candidates) {
    const safeCandidate = normalizeNavigationCandidate(candidate)
    if (!safeCandidate) continue

    try {
      const parsedUrl = new URL(safeCandidate)
      if (
        ['http:', 'https:'].includes(parsedUrl.protocol) &&
        !parsedUrl.username &&
        !parsedUrl.password &&
        parsedUrl.pathname.startsWith('/oauth2/')
      ) {
        return normalizeBaseUrl(parsedUrl.origin)
      }
    } catch {
      // Relative URLs are already handled by toNavigationUrl.
    }
  }

  return ''
}

/** 构造同源 URL；即使传入绝对地址也仅保留其 path 和 query。 */
function buildUrl(baseUrl, path) {
  if (!path) {
    return baseUrl
  }

  if (/^https?:\/\//.test(path)) {
    try {
      const parsedUrl = new URL(path)
      path = `${parsedUrl.pathname}${parsedUrl.search}`
    } catch {
      return '/'
    }
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  if (!baseUrl) {
    return normalizedPath
  }

  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`
}

/** 去除基础地址尾部斜杠，避免拼接出双斜杠。 */
function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '')
}

/** 从请求体中删除 undefined 和空字符串，保留 0、false 与 null 等有意义值。 */
function removeEmptyFields(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== ''),
  )
}
