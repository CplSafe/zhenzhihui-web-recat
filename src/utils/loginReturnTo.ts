/**
 * 登录后回跳地址(returnTo)的校验。
 *
 * 受保护页被守卫弹到 /login、或游客在浏览页里点了需登录的动作时,会把当时的站内路径
 * 塞进 location.state.returnTo;登录成功后要回到那里而不是一律落首页。
 * 这里只接受「站内相对路径」:必须以单个 `/` 开头(`//host` 会被浏览器当协议相对地址跳出站),
 * 且不能是登录/开屏页本身(否则登录成功又回到登录页,形成死循环)。
 */

/** 登录页/开屏页不能作为回跳目标。 */
const NON_RETURNABLE_PATHS = new Set(['/login', '/welcome', '/'])
const OAUTH_RETURN_TO_KEY = 'zzh.login.oauth-return.v1'
const OAUTH_RETURN_TO_TTL_MS = 5 * 60 * 1000
const VALIDATION_ORIGIN = 'https://login-return.invalid'

/** 校验并规范化 returnTo,非法时返回空串(调用方回落 /home)。 */
export function sanitizeLoginReturnTo(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) return ''
  // 含协议/换行等的都拒绝,只留 path + search + hash。
  if (/[\r\n\t]/.test(trimmed) || /^\/[^/?#]*:/.test(trimmed)) return ''
  const url = new URL(trimmed, VALIDATION_ORIGIN)
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  if (
    url.origin !== VALIDATION_ORIGIN ||
    pathname.startsWith('//') ||
    NON_RETURNABLE_PATHS.has(pathname.toLowerCase())
  ) {
    return ''
  }
  return trimmed
}

/** 从 react-router 的 location.state 里读取合法的 returnTo。 */
export function readLoginReturnTo(state: unknown): string {
  return sanitizeLoginReturnTo((state as any)?.returnTo)
}

/** 本地代理将顶层回调错误送回登录页时使用的标记。 */
export function hasOAuthCallbackFailure(search: string): boolean {
  return new URLSearchParams(search).get('oauth_callback') === 'failed'
}

/** 整页 OAuth 跳转前在当前标签页保留回跳目标。 */
export function keepOAuthLoginReturnTo(value: unknown): void {
  const target = sanitizeLoginReturnTo(value)
  if (!target) {
    clearOAuthLoginReturnTo()
    return
  }
  try {
    window.sessionStorage.setItem(
      OAUTH_RETURN_TO_KEY,
      JSON.stringify({ target, expiresAt: Date.now() + OAUTH_RETURN_TO_TTL_MS }),
    )
  } catch {
    // 浏览器限制存储时仍可完成 OAuth，并使用默认落点。
  }
}

/** 回跳目标只使用一次，读取时重新校验路径及有效期。 */
export function consumeOAuthLoginReturnTo(): string {
  try {
    const stored = window.sessionStorage.getItem(OAUTH_RETURN_TO_KEY)
    window.sessionStorage.removeItem(OAUTH_RETURN_TO_KEY)
    if (!stored) return ''
    const { target, expiresAt } = JSON.parse(stored)
    return typeof expiresAt === 'number' && expiresAt > Date.now() ? sanitizeLoginReturnTo(target) : ''
  } catch {
    return ''
  }
}

/** 普通登录、注销或已知登录失败时清除同标签页的待回跳目标。 */
export function clearOAuthLoginReturnTo(): void {
  try {
    window.sessionStorage.removeItem(OAUTH_RETURN_TO_KEY)
  } catch {
    // 浏览器限制存储时没有待清理的回跳目标。
  }
}
