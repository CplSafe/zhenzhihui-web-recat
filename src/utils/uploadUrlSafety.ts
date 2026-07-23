/**
 * 上传地址安全策略：只允许同源端点或显式白名单中的 HTTP(S) 主机接收文件内容。
 * 开发环境可通过独立开关放宽限制，生产环境仍拒绝内网重定向和未知上传域名。
 */
/** 上传主机白名单支持精确字符串或正则表达式。 */
export type UploadHostPattern = string | RegExp

/** 判定上传 URL 所需的页面来源、开发开关与主机白名单。 */
export interface UploadUrlPolicy {
  /** Origin of the page issuing the upload request, including scheme and port. */
  pageOrigin: string
  /** Development-only escape hatch for absolute http(s) upload endpoints. */
  allowAnyHttp: boolean
  /** Exact origins or hostname patterns that may receive upload bodies. */
  allowedHostPatterns: readonly UploadHostPattern[]
}

/** 将地址解析为 HTTP(S) URL，其他协议或非法文本返回 null。 */
function parseHttpUrl(value: string, base?: string): URL | null {
  try {
    const parsed = base ? new URL(value, base) : new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null
  } catch {
    return null
  }
}

/** 将页面来源规范化为合法 HTTP(S) origin。 */
function normalizeHttpOrigin(value: string): string {
  return parseHttpUrl(String(value || '').trim())?.origin || ''
}

/** 判断目标 URL 是否匹配配置的来源或主机规则。 */
function matchesAllowedHost(parsed: URL, patterns: readonly UploadHostPattern[]): boolean {
  return patterns.some((pattern) => {
    if (!pattern) return false
    if (pattern instanceof RegExp) {
      pattern.lastIndex = 0
      return pattern.test(parsed.hostname)
    }
    return normalizeHttpOrigin(pattern) === parsed.origin
  })
}

/**
 * 发送 File/FormData 前校验上传目标，仅允许同源根路径和显式信任的 HTTP(S) 绝对地址。
 * 协议相对及包含反斜杠的输入会被拒绝，防止浏览器规范化为跨源地址。
 */
export function isAllowedUploadUrl(value: unknown, policy: UploadUrlPolicy): boolean {
  if (typeof value !== 'string') return false
  const raw = value.trim()
  if (!raw || raw.includes('\\')) return false

  const pageOrigin = normalizeHttpOrigin(policy.pageOrigin)

  if (raw.startsWith('/')) {
    if (raw.startsWith('//') || !pageOrigin) return false
    const parsedRelative = parseHttpUrl(raw, pageOrigin)
    return Boolean(parsedRelative && parsedRelative.origin === pageOrigin)
  }

  const parsed = parseHttpUrl(raw)
  if (!parsed) return false
  if (pageOrigin && parsed.origin === pageOrigin) return true
  if (policy.allowAnyHttp) return true
  return matchesAllowedHost(parsed, policy.allowedHostPatterns)
}
