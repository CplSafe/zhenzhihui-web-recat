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

/** 校验并规范化 returnTo,非法时返回空串(调用方回落 /home)。 */
export function sanitizeLoginReturnTo(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) return ''
  // 含协议/换行等的都拒绝,只留 path + search + hash。
  if (/[\r\n]/.test(trimmed) || /^\/[^/?#]*:/.test(trimmed)) return ''
  const pathname = trimmed.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  if (NON_RETURNABLE_PATHS.has(pathname)) return ''
  return trimmed
}

/** 从 react-router 的 location.state 里读取合法的 returnTo。 */
export function readLoginReturnTo(state: unknown): string {
  return sanitizeLoginReturnTo((state as any)?.returnTo)
}
