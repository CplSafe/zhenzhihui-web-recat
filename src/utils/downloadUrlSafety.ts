/**
 * 下载 URL 安全策略：仅允许 HTTP(S) 与当前页面创建的 blob 地址。
 * 返回标准化的同源信息，供下载器选择 fetch、文件句柄或浏览器降级路径。
 */
/** 下载器允许处理的 URL 类型。 */
export type SafeDownloadKind = 'http' | 'blob'

/** 经校验后的下载地址及其跨域属性。 */
export interface SafeDownloadUrl {
  href: string
  kind: SafeDownloadKind
  isCrossOrigin: boolean
}

/** 解析 URL，非法文本统一返回 null。 */
function parseUrl(value: string, base?: string): URL | null {
  try {
    return base ? new URL(value, base) : new URL(value)
  } catch {
    return null
  }
}

/** 将页面来源规范化为合法的 HTTP(S) origin。 */
function normalizePageOrigin(value: string): string {
  const parsed = parseUrl(String(value || '').trim())
  return parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.origin : ''
}

/** 检测可能造成响应头或地址解析歧义的控制字符。 */
function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return true
  }
  return false
}

/**
 * 使用浏览器同款解析器校验下载地址；允许同源根路径、HTTP(S) 和同源 blob。
 * 协议相对地址、凭据、危险协议及反斜杠变体会在进入 fetch 或 iframe 前被拒绝。
 */
export function resolveSafeDownloadUrl(value: unknown, pageOriginValue: string): SafeDownloadUrl | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  const pageOrigin = normalizePageOrigin(pageOriginValue)
  if (!raw || !pageOrigin || containsControlCharacter(raw) || raw.includes('\\') || raw.startsWith('//')) return null

  if (raw.startsWith('/')) {
    const parsedRelative = parseUrl(raw, pageOrigin)
    if (
      !parsedRelative ||
      (parsedRelative.protocol !== 'https:' && parsedRelative.protocol !== 'http:') ||
      parsedRelative.origin !== pageOrigin
    ) {
      return null
    }
    return { href: raw, kind: 'http', isCrossOrigin: false }
  }

  const parsed = parseUrl(raw)
  if (!parsed || parsed.username || parsed.password) return null
  if (parsed.protocol === 'blob:') {
    return parsed.origin === pageOrigin ? { href: raw, kind: 'blob', isCrossOrigin: false } : null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  return {
    href: parsed.href,
    kind: 'http',
    isCrossOrigin: parsed.origin !== pageOrigin,
  }
}
