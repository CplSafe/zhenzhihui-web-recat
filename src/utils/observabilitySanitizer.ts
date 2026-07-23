/**
 * 可观测日志脱敏工具：在事件上传前移除令牌、Cookie、签名参数和认证 URL 查询串。
 * 对循环引用、超深对象及不可读属性采用安全占位；无法可靠替换敏感字段时丢弃事件。
 */
/** 可变结构化日志对象的内部表示。 */
type MutableRecord = Record<string, unknown>

/** 日志字段被主动脱敏后的统一占位文本。 */
export const TELEMETRY_REDACTED = '[REDACTED]'

/** 循环引用占位文本。 */
const TELEMETRY_CIRCULAR = '[Circular]'
/** 超出清洗预算时的截断占位文本。 */
const TELEMETRY_TRUNCATED = '[Truncated]'
/** 递归清洗允许的最大对象深度。 */
const MAX_SANITIZE_DEPTH = 12
/** 单个事件允许访问的最大节点数，防止异常对象拖垮日志线程。 */
const MAX_SANITIZE_NODES = 2000

/** 从普通错误文本中识别可能带查询参数的 URL。 */
const URL_CANDIDATE_RE = /(?:https?:\/\/|\/\/)[^\s<>"']+|\/[A-Za-z0-9._~:@%+-][^\s<>"']*[?#][^\s<>"']*/gi
/** 识别 Cookie/Set-Cookie 请求头及其值。 */
const COOKIE_HEADER_RE = /(\b(?:set[-_ ]?cookie|cookie)\b\s*:\s*)[^\r\n]*/gi
/** 统一列出认证信息、密钥与凭据类敏感字段名。 */
const SENSITIVE_KEY_SOURCE =
  '(?:authorization|proxy[-_ ]?authorization|token|access[-_ ]?token|refresh[-_ ]?token|id[-_ ]?token|auth[-_ ]?token|csrf[-_ ]?token|client[-_ ]?token|secret|client[-_ ]?secret|api[-_ ]?key|x[-_ ]?api[-_ ]?key|access[-_ ]?key[-_ ]?id|password|passwd|private[-_ ]?key|session[-_ ]?id|cookie|set[-_ ]?cookie|signature|credential)'
/** 匹配对象文本中带引号的敏感字段赋值。 */
const SENSITIVE_QUOTED_VALUE_RE = new RegExp(
  `((?:["'])${SENSITIVE_KEY_SOURCE}(?:["'])\\s*[:=]\\s*)(["'])(.*?)\\2`,
  'gi',
)
/** 匹配普通文本中的敏感字段赋值。 */
const SENSITIVE_ASSIGNMENT_RE = new RegExp(
  `(\\b${SENSITIVE_KEY_SOURCE}\\b\\s*[:=]\\s*)(?:(?:Bearer|Basic)\\s+)?(\\[REDACTED\\]|[^\\s,;&}\\]]+)`,
  'gi',
)
/** 匹配 Bearer 与 Basic 认证头。 */
const AUTH_SCHEME_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi
/** 匹配常见三段式 JWT。 */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g

/** 将未知对象收敛为可安全枚举的普通记录。 */
function asRecord(value: unknown): MutableRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as MutableRecord) : null
}

/** 统一字段名大小写与分隔符，便于敏感字段判断。 */
function normalizeFieldName(field: string): string {
  return field.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** 判断字段名是否可能承载认证信息或密钥。 */
function isSensitiveField(field: string): boolean {
  const normalized = normalizeFieldName(field)
  return (
    normalized.includes('authorization') ||
    normalized.includes('password') ||
    normalized.includes('passwd') ||
    normalized.includes('secret') ||
    normalized.includes('cookie') ||
    normalized === 'apikey' ||
    normalized.endsWith('apikey') ||
    normalized === 'accesskeyid' ||
    normalized.endsWith('accesskeyid') ||
    normalized === 'privatekey' ||
    normalized.endsWith('privatekey') ||
    normalized === 'credential' ||
    normalized.endsWith('credential') ||
    normalized === 'signature' ||
    normalized.endsWith('signature') ||
    normalized === 'token' ||
    normalized.endsWith('token') ||
    normalized === 'sessionid' ||
    normalized.endsWith('sessionid') ||
    normalized === 'sid'
  )
}

/** 判断字段是否应按 URL 规则删除查询串与用户信息。 */
function isUrlField(field: string): boolean {
  const lower = field.toLowerCase()
  return (
    lower === 'url' ||
    lower === 'uri' ||
    lower === 'href' ||
    lower === 'referrer' ||
    lower === 'location' ||
    lower === 'resourceurl' ||
    lower === 'sourceurl' ||
    lower === 'requesturl' ||
    lower === 'responseurl' ||
    /(?:_|-)(?:url|uri|href)$/.test(lower) ||
    /(?:Url|URL|Uri|URI|Href)$/.test(field)
  )
}

/** 保留日志 URL 的来源与路径，移除常承载 OAuth code、state、签名和凭据的参数。 */
export function sanitizeTelemetryUrl(value: string): string {
  const queryIndex = value.indexOf('?')
  const fragmentIndex = value.indexOf('#')
  const boundary = [queryIndex, fragmentIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0]
  const withoutQueryOrFragment = boundary === undefined ? value : value.slice(0, boundary)

  try {
    const parsed = new URL(withoutQueryOrFragment)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return withoutQueryOrFragment

    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return withoutQueryOrFragment
  }
}

/** 脱敏普通日志文本中的凭据，同时保留错误描述、状态码、请求 ID 和 URL 路径。 */
export function sanitizeTelemetryText(value: string): string {
  return value
    .replace(URL_CANDIDATE_RE, (candidate) => {
      const trailing = candidate.match(/[),.;]+$/)?.[0] || ''
      const url = trailing ? candidate.slice(0, -trailing.length) : candidate
      return `${sanitizeTelemetryUrl(url)}${trailing}`
    })
    .replace(COOKIE_HEADER_RE, `$1${TELEMETRY_REDACTED}`)
    .replace(SENSITIVE_QUOTED_VALUE_RE, (_match, prefix: string, quote: string) => {
      return `${prefix}${quote}${TELEMETRY_REDACTED}${quote}`
    })
    .replace(SENSITIVE_ASSIGNMENT_RE, `$1${TELEMETRY_REDACTED}`)
    .replace(AUTH_SCHEME_RE, `$1 ${TELEMETRY_REDACTED}`)
    .replace(JWT_RE, TELEMETRY_REDACTED)
}

/** 日志递归清洗时的循环引用、节点预算和安全状态。 */
interface SanitizeState {
  seen: WeakSet<object>
  nodes: number
  safe: boolean
}

/** 尝试原地替换日志字段；失败时标记整个事件不安全。 */
function replaceProperty(target: object, field: PropertyKey, value: unknown, state: SanitizeState): void {
  try {
    if (!Reflect.set(target, field, value)) state.safe = false
  } catch {
    state.safe = false
  }
}

/** 在深度与节点预算内递归清洗任意日志值。 */
function sanitizeValue(value: unknown, field: string, state: SanitizeState, depth: number): unknown {
  if (typeof value === 'string') {
    return isUrlField(field) ? sanitizeTelemetryUrl(value) : sanitizeTelemetryText(value)
  }
  if (typeof value === 'bigint') return `${value.toString()}n`
  if (typeof value === 'function') return '[Function]'
  if (typeof value === 'symbol') return '[Symbol]'
  if (value === null || typeof value !== 'object') return value

  if (depth > MAX_SANITIZE_DEPTH || state.nodes >= MAX_SANITIZE_NODES) return TELEMETRY_TRUNCATED
  if (state.seen.has(value)) return TELEMETRY_CIRCULAR

  state.seen.add(value)
  state.nodes += 1

  try {
    if (value instanceof URL) return sanitizeTelemetryUrl(value.href)
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString()
    if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) {
      return '[Query parameters removed]'
    }
    if (typeof Headers !== 'undefined' && value instanceof Headers) {
      const headers: Record<string, unknown> = {}
      value.forEach((headerValue, headerName) => {
        headers[headerName] = headerValue
      })
      return sanitizeValue(headers, field, state, depth + 1)
    }
    if (value instanceof Map) {
      const entries: Record<string, unknown> = {}
      let index = 0
      for (const [mapKey, mapValue] of value.entries()) {
        if (index >= MAX_SANITIZE_NODES) {
          entries._truncated = TELEMETRY_TRUNCATED
          break
        }
        const label = typeof mapKey === 'string' ? mapKey : `entry_${index}`
        entries[label] = isSensitiveField(label) ? TELEMETRY_REDACTED : sanitizeValue(mapValue, label, state, depth + 1)
        index += 1
      }
      return entries
    }
    if (value instanceof Set) {
      return Array.from(value, (entry) => sanitizeValue(entry, '', state, depth + 1))
    }
  } catch {
    state.safe = false
    return TELEMETRY_REDACTED
  }

  let fields: PropertyKey[]
  try {
    fields = Reflect.ownKeys(value)
  } catch {
    state.safe = false
    return value
  }

  for (const property of fields) {
    if (property === 'length' || typeof property === 'symbol') continue
    const propertyName = String(property)

    if (isSensitiveField(propertyName)) {
      replaceProperty(value, property, TELEMETRY_REDACTED, state)
      continue
    }

    let current: unknown
    try {
      current = Reflect.get(value, property)
    } catch {
      replaceProperty(value, property, '[Unreadable]', state)
      continue
    }

    const sanitized = sanitizeValue(current, propertyName, state, depth + 1)
    if (!Object.is(current, sanitized)) replaceProperty(value, property, sanitized, state)
  }

  return value
}

/**
 * 原地递归清洗 OpenObserve Logs/RUM 事件；返回值可直接供 SDK beforeSend 使用。
 * 若凭据字段或不可读属性无法安全替换则返回 false，使整个不安全事件停止上传。
 */
export function sanitizeObservabilityEventUrls(event: unknown): boolean {
  const state: SanitizeState = { seen: new WeakSet<object>(), nodes: 0, safe: true }
  const sanitized = sanitizeValue(event, '', state, 0)
  return state.safe && Object.is(sanitized, event)
}

/** 安全读取错误对象字段，兼容代理对象或宿主对象抛错。 */
function readField(record: MutableRecord | null, field: string): unknown {
  if (!record) return undefined
  try {
    return record[field]
  } catch {
    return undefined
  }
}

/** 构建最小错误诊断，不传递原始 Error、响应正文、请求配置或请求头。 */
export function createSafeErrorDiagnostic(error: unknown): Record<string, string | number> {
  const root = asRecord(error)
  const response = asRecord(readField(root, 'response'))
  const output: Record<string, string | number> = {}

  const name = readField(root, 'name')
  if (typeof name === 'string' && name.trim()) output.name = sanitizeTelemetryText(name).slice(0, 120)

  let message = readField(root, 'message')
  try {
    if (error instanceof Error) message = error.message
  } catch {
    // Revoked proxies and exotic host errors may reject instanceof/property access.
  }
  if (typeof message === 'string' && message.trim()) {
    output.message = sanitizeTelemetryText(message).slice(0, 500)
  }

  const status = readField(root, 'status') ?? readField(response, 'status')
  if (typeof status === 'number' && Number.isFinite(status)) output.status = status
  else if (typeof status === 'string' && status.trim()) output.status = sanitizeTelemetryText(status).slice(0, 32)

  const code = readField(root, 'code') ?? readField(response, 'code')
  if (typeof code === 'number' && Number.isFinite(code)) output.code = code
  else if (typeof code === 'string' && code.trim()) output.code = sanitizeTelemetryText(code).slice(0, 120)

  return Object.keys(output).length ? output : { name: 'UnknownError' }
}
