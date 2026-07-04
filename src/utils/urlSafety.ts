// Restrict URLs that come from restored localStorage / server responses
// before binding them to <video src> / <img src>. Blocks `javascript:`,
// `data:`, `file:`, and other schemes that could be used for local
// exfiltration or unexpected rendering.

// 允许 http(s)、blob:、以及单斜杠开头的站内相对路径；
// 显式排除协议相对 URL（//evil.com）——它会被浏览器解析成外部源。
const SAFE_MEDIA_SCHEME = /^(https?:\/\/|blob:|\/(?!\/))/i

export function isSafeMediaUrl(value) {
  return typeof value === 'string' && SAFE_MEDIA_SCHEME.test(value)
}

export function sanitizeMediaUrl(value, fallback = '') {
  return isSafeMediaUrl(value) ? value : fallback
}
