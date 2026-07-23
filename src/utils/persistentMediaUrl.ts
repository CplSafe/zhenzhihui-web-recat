/**
 * 可持久化媒体地址策略：优先把素材 ID 转成应用同源下载地址，并剔除临时或带签名 URL。
 * 这样草稿刷新后仍可播放，同时避免把供应商凭据和错误工作区参数长期保存。
 */
/** 浏览器临时协议及脚本协议，不允许写入草稿。 */
const UNSAFE_SCHEME_RE = /^(?:blob|data|javascript|vbscript):/i
/** URL 中编码后的控制字符或反斜杠，可能造成解析歧义。 */
const ENCODED_CONTROL_OR_BACKSLASH_RE = /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i
/** 常见云存储签名与临时凭据查询参数。 */
const SIGNED_QUERY_KEYS = new Set([
  'access_token',
  'authorization',
  'awsaccesskeyid',
  'credential',
  'expires',
  'key-pair-id',
  'ossaccesskeyid',
  'policy',
  'q-sign-algorithm',
  'q-sign-time',
  'q-key-time',
  'q-header-list',
  'q-url-param-list',
  'q-signature',
  'security-token',
  'sig',
  'signature',
  'token',
  'x-amz-algorithm',
  'x-amz-credential',
  'x-amz-date',
  'x-amz-expires',
  'x-amz-security-token',
  'x-amz-signature',
  'x-goog-algorithm',
  'x-goog-credential',
  'x-goog-date',
  'x-goog-expires',
  'x-goog-signature',
  'x-oss-credential',
  'x-oss-expires',
  'x-oss-security-token',
  'x-oss-signature',
])

/** 持久化媒体地址时用于构建稳定资产下载路径的上下文。 */
interface PersistentMediaUrlOptions {
  assetId?: number
  workspaceId?: number
}

/** 将候选素材或工作区标识规范化为正整数。 */
function normalizePositiveId(value: unknown): number {
  const id = Math.floor(Number(value) || 0)
  return id > 0 ? id : 0
}

/** 判断原始地址是否包含控制字符或反斜杠。 */
function hasControlOrBackslash(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return character === '\\' || code <= 31 || code === 127
  })
}

/** 安全读取当前页面 origin，非浏览器环境返回空字符串。 */
function currentOrigin(): string {
  try {
    return typeof window !== 'undefined' ? window.location.origin : ''
  } catch {
    return ''
  }
}

/** 判断绝对地址是否与当前应用同源。 */
function isSameOriginUrl(url: URL): boolean {
  const origin = currentOrigin()
  return Boolean(origin && origin !== 'null' && url.origin === origin)
}

/** 根据查询参数判断地址是否像云厂商的临时签名链接。 */
function isLikelySignedProviderUrl(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    const normalizedKey = key.toLowerCase()
    if (
      SIGNED_QUERY_KEYS.has(normalizedKey) ||
      /(?:^|[-_])(?:credential|security-token|signature)$/.test(normalizedKey)
    ) {
      return true
    }
  }
  return false
}

/** 构建素材的鉴权同源流地址；该引用可长期恢复且不包含供应商凭据或签名。 */
export function buildPersistentAssetUrl(assetId: unknown, workspaceId: unknown): string {
  const asset = normalizePositiveId(assetId)
  const workspace = normalizePositiveId(workspaceId)
  if (!asset || !workspace) return ''
  return `/api/v1/assets/${asset}/download?workspace_id=${workspace}`
}

/**
 * 写入浏览器存储前移除临时与供应商签名地址；有素材 ID 时替换为应用同源稳定地址。
 * 没有素材 ID 的公开无签名外链继续保留，以兼容已有草稿。
 */
export function sanitizePersistentMediaUrl(
  value: unknown,
  { assetId = 0, workspaceId = 0 }: PersistentMediaUrlOptions = {},
): string {
  const url = typeof value === 'string' ? value.trim() : ''
  const stableAssetUrl = buildPersistentAssetUrl(assetId, workspaceId)
  if (!url) return stableAssetUrl
  if (
    UNSAFE_SCHEME_RE.test(url) ||
    hasControlOrBackslash(url) ||
    ENCODED_CONTROL_OR_BACKSLASH_RE.test(url) ||
    url.startsWith('//')
  ) {
    return stableAssetUrl
  }

  // An asset ID is the durable identity. Never retain a caller-provided URL
  // (including a same-origin URL with a stale workspace or signed query).
  if (stableAssetUrl) return stableAssetUrl

  if (url.startsWith('/')) {
    try {
      const parsed = new URL(url, currentOrigin() || 'https://local.invalid')
      return isLikelySignedProviderUrl(parsed) ? '' : url
    } catch {
      return ''
    }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return stableAssetUrl
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    return stableAssetUrl
  }
  if (isLikelySignedProviderUrl(parsed)) return ''
  if (isSameOriginUrl(parsed)) return url
  return url
}

/** 保留项目视频归类元数据，同时规范化有素材 ID 的媒体并移除仅靠签名 URL 的预览。 */
export function sanitizePersistentProjectVideoStore(value: unknown, workspaceId: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const source = value as Record<string, unknown>
  const records = Array.isArray(source.records)
    ? source.records.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item
        const record = item as Record<string, unknown>
        const videoAssetId = normalizePositiveId(record.videoAssetId ?? record.assetId ?? record.asset_id)
        const coverAssetId = normalizePositiveId(record.coverAssetId ?? record.cover_asset_id)
        return {
          ...record,
          ...(videoAssetId ? { videoAssetId } : {}),
          videoUrl: sanitizePersistentMediaUrl(record.videoUrl, {
            assetId: videoAssetId,
            workspaceId: Number(workspaceId),
          }),
          coverUrl: sanitizePersistentMediaUrl(record.coverUrl, {
            assetId: coverAssetId,
            workspaceId: Number(workspaceId),
          }),
          ...(record.publishUrl !== undefined
            ? {
                publishUrl: sanitizePersistentMediaUrl(record.publishUrl, {
                  assetId: videoAssetId,
                  workspaceId: Number(workspaceId),
                }),
              }
            : {}),
        }
      })
    : []
  return {
    ...source,
    records,
    overrides:
      source.overrides && typeof source.overrides === 'object' && !Array.isArray(source.overrides)
        ? source.overrides
        : {},
  }
}
