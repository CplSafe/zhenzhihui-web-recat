/** Validate backend-issued upload URLs without an origin or storage-provider allowlist. */
export function isValidUploadUrl(value: unknown, pageOrigin = globalThis.location?.origin || ''): boolean {
  if (typeof value !== 'string') return false
  const raw = value.trim()
  if (!raw || raw.includes('\\') || raw.startsWith('//')) return false
  try {
    const relative = raw.startsWith('/')
    const base = relative ? new URL(pageOrigin) : undefined
    if (base && base.protocol !== 'http:' && base.protocol !== 'https:') return false
    const parsed = base ? new URL(raw, base.origin) : new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (parsed.username || parsed.password) return false
    return !base || parsed.origin === base.origin
  } catch {
    return false
  }
}
