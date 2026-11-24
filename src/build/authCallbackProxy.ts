type CallbackHeaders = Record<string, string | string[] | undefined>

/**
 * 仅将已配置的业务源的 OAuth 回调留在开发代理内。
 * 业务服务器可能通过 IP 访问，但 OAuth 注册的是公网域名；两者须显式加入可信集合。
 * 不能改 authorize 请求中的 redirect_uri，否则会破坏 OAuth 客户端/PKCE 校验。
 */
export function rewriteBusinessAuthCallback(
  location: string | undefined,
  businessOrigins: ReadonlySet<string>,
): string | undefined {
  if (!location) return undefined
  try {
    const url = new URL(location)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    if (!businessOrigins.has(url.origin) || url.pathname !== '/auth/callback') return undefined
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return undefined
  }
}

/** 将顶层 OAuth 回调错误交回登录页，供 iframe 和接口调用者继续读取原响应。 */
export function redirectFailedAuthCallback(
  request: { method?: string; url?: string; headers: CallbackHeaders },
  response: { statusCode?: number; statusMessage?: string; headers: CallbackHeaders },
): boolean {
  const status = response.statusCode
  if (
    request.method !== 'GET' ||
    request.url?.split('?')[0] !== '/auth/callback' ||
    request.headers['sec-fetch-dest'] !== 'document' ||
    status === undefined ||
    status < 400 ||
    status > 599
  ) {
    return false
  }

  response.statusCode = 303
  response.statusMessage = 'See Other'
  response.headers.location = '/login?oauth_callback=failed'
  response.headers['cache-control'] = 'no-store'
  return true
}
