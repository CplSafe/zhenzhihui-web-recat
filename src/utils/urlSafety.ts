/**
 * 通用 URL 安全校验：在本地草稿或服务端地址绑定到媒体和导航元素前限制可用协议。
 * 拒绝脚本、data、file、用户信息及反斜杠等歧义形式，避免本地数据泄露和意外跳转。
 */

// 特殊协议会把反斜杠当路径分隔符；看似单斜杠开头的地址也可能解析到外部来源，因此解析前先拒绝歧义字符。
/** 允许的绝对 HTTP(S) 地址前缀。 */
const ABSOLUTE_HTTP_PREFIX = /^https?:\/\//i
/** 可供当前页面媒体预览的 blob 地址前缀。 */
const BLOB_PREFIX = /^blob:/i
/** 单斜杠开头的同源绝对路径。 */
const ROOT_RELATIVE_PREFIX = /^\/(?!\/)/
/** 解析相对地址时使用的不可路由基准来源。 */
const RELATIVE_URL_BASE = 'https://url-safety.invalid'

/** 检测控制字符与反斜杠，防止浏览器以不同方式解释地址。 */
function hasDisallowedUrlCharacters(value: string): boolean {
  if (value.includes('\\')) return true
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

/** 判断输入是否为没有首尾空白和歧义字符的非空字符串。 */
function isUnambiguousUrlString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim() && !hasDisallowedUrlCharacters(value)
}

/** 判断解析后的 URL 是否携带用户名或密码。 */
function hasUserInfo(url: URL): boolean {
  return Boolean(url.username || url.password)
}

/** 在解析前检查 authority 部分是否显式包含用户信息。 */
function hasExplicitAuthorityUserInfo(value: string): boolean {
  const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0]
  return authority.includes('@')
}

/** 校验绝对 HTTP(S) 地址的协议、凭据与字符形式。 */
function isSafeAbsoluteHttpUrl(value: string): boolean {
  if (!ABSOLUTE_HTTP_PREFIX.test(value)) return false

  try {
    const parsed = new URL(value)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname) &&
      !hasUserInfo(parsed) &&
      !hasExplicitAuthorityUserInfo(value)
    )
  } catch {
    return false
  }
}

/** 校验同源根路径，拒绝双斜杠及可跨源解析的歧义路径。 */
function isSafeRootRelativeUrl(value: string): boolean {
  if (!ROOT_RELATIVE_PREFIX.test(value)) return false

  try {
    const parsed = new URL(value, RELATIVE_URL_BASE)
    return parsed.origin === RELATIVE_URL_BASE && !hasUserInfo(parsed)
  } catch {
    return false
  }
}

/** 校验 blob 地址是否由当前 HTTP(S) 页面来源创建。 */
function isSafeBlobUrl(value: string): boolean {
  if (!BLOB_PREFIX.test(value)) return false

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'blob:') return false

    const nestedValue = value.slice(value.indexOf(':') + 1)
    if (!nestedValue) return false
    // Browser-created object URLs use either the document's HTTP(S) origin or
    // the opaque `null` origin (for sandboxed/local documents). Do not treat
    // arbitrary nested schemes such as `blob:javascript:` as object URLs.
    if (nestedValue.startsWith('null/')) return nestedValue.length > 'null/'.length
    return isSafeAbsoluteHttpUrl(nestedValue)
  } catch {
    return false
  }
}

/** 判断地址是否可安全绑定到图片或视频元素。 */
export function isSafeMediaUrl(value: unknown): value is string {
  if (!isUnambiguousUrlString(value)) return false
  return isSafeRootRelativeUrl(value) || isSafeAbsoluteHttpUrl(value) || isSafeBlobUrl(value)
}

/** 返回安全媒体地址，非法输入使用调用方提供的回退值。 */
export function sanitizeMediaUrl(value: unknown, fallback = ''): string {
  return isSafeMediaUrl(value) ? value : fallback
}

/** 判断地址是否可安全用于页面导航。 */
export function isSafeNavigationUrl(value: unknown): value is string {
  if (!isUnambiguousUrlString(value)) return false
  return isSafeRootRelativeUrl(value) || isSafeAbsoluteHttpUrl(value)
}

/** 返回安全导航地址，非法输入使用调用方提供的回退值。 */
export function sanitizeNavigationUrl(value: unknown, fallback = ''): string {
  return isSafeNavigationUrl(value) ? value : fallback
}
