// Restrict URLs that come from restored localStorage / server responses
// before binding them to <video src> / <img src>. Blocks `javascript:`,
// `data:`, `file:`, and other schemes that could be used for local
// exfiltration or unexpected rendering.

const SAFE_MEDIA_SCHEME = /^(https?:\/\/|blob:|\/)/i

export function isSafeMediaUrl(value) {
  return typeof value === 'string' && SAFE_MEDIA_SCHEME.test(value)
}

export function sanitizeMediaUrl(value, fallback = '') {
  return isSafeMediaUrl(value) ? value : fallback
}
