/**
 * 创意草稿持久化并发控制：识别冲突、计算稳定指纹并决定是否允许重试写入。
 * 指纹会忽略临时 URL 与非创作元数据，避免把签名刷新误判为内容变更。
 */
/** 草稿保存过程在界面中的状态。 */
export type DraftSaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'
/** 一次草稿写入可返回的结果。 */
export type DraftWriteResult = 'saved' | 'conflict' | 'error'

/** 当前页面不再拥有云端创作内容时使用的稳定错误码。 */
const CONTENT_CONFLICT_CODE = 'DRAFT_CONTENT_CONFLICT'

/** 云端存在当前会话之外的创作修改时抛出；调用方不得提升版本后重试整份快照。 */
export class CreativeDraftContentConflictError extends Error {
  readonly code = CONTENT_CONFLICT_CODE

  constructor() {
    super('项目已在其他页面被修改，当前内容尚未覆盖云端')
    this.name = 'CreativeDraftContentConflictError'
  }
}

/** 判断错误是否为本模块抛出的创作内容冲突。 */
export function isCreativeDraftContentConflictError(error: unknown): boolean {
  const value = error as { code?: unknown; name?: unknown } | null
  return value?.code === CONTENT_CONFLICT_CODE || value?.name === 'CreativeDraftContentConflictError'
}

/** 从不同请求库的错误结构中读取 HTTP 状态码。 */
const errorStatus = (error: any): number =>
  Number(
    error?.status ??
      error?.response?.status ??
      error?.response?.status_code ??
      error?.response?.statusCode ??
      error?.response?.code,
  ) || 0

/** 判断后端是否报告乐观锁版本冲突。 */
export function isDraftConflictError(error: unknown): boolean {
  const value = error as any
  const code = String(
    value?.code ??
      value?.code_string ??
      value?.codeString ??
      value?.response?.code_string ??
      value?.response?.codeString ??
      '',
  ).toUpperCase()
  return errorStatus(value) === 409 || code === 'DRAFT_CONFLICT'
}

/** 判断草稿保存错误是否适合短暂等待后重试。 */
export function isRetryableDraftSaveError(error: unknown): boolean {
  const value = error as any
  if (value?.name === 'AbortError' || value?.cause === 'aborted') return false
  const status = errorStatus(value)
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500
}

/** 按重试次数执行有限退避，降低并发写入压力。 */
export function waitForDraftSaveRetry(attempt: number): Promise<void> {
  const delayMs = Math.min(1200, 250 * 2 ** Math.max(0, Math.floor(Number(attempt) || 0)))
  return new Promise((resolve) => window.setTimeout(resolve, delayMs))
}

/** 为序列化文本生成轻量稳定哈希。 */
function hashFingerprintText(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`
}

/** 为待保存快照生成紧凑指纹，用于合并队列中的重复写入。 */
export function createDraftFingerprint(draft: unknown, coverAssetId = 0): string {
  try {
    return hashFingerprintText(JSON.stringify([Math.floor(Number(coverAssetId) || 0), draft]))
  } catch {
    return ''
  }
}

/** 不属于创作正文、可在并发合并时安全忽略的草稿字段。 */
const NON_CREATIVE_DRAFT_KEYS = new Set([
  'completedVideoGenerationIds',
  'createdAt',
  'draftRevision',
  'draft_revision',
  'fullVideoAssetId',
  'fullVideoUrl',
  'generatedVideoAssetId',
  'generatedVideoUrl',
  'idempotencyKey',
  'lastCompletedVideoGenerationId',
  'lastVideoSig',
  'materialBatchPending',
  'ownerUserId',
  'pendingVideoSig',
  'projectId',
  'projectVideoStore',
  'restrictedMemberIds',
  'restricted_member_ids',
  'savedAt',
  'scriptPending',
  'taskId',
  'updatedAt',
  'videoGenerating',
  'videoGenerations',
  'videoGenQueue',
  'videoHistoryList',
  'videoVersions',
  'vidGenTaskId',
  'workspaceId',
])

/** 会随签名或鉴权刷新变化、不应参与内容指纹的 URL 查询参数。 */
const VOLATILE_URL_QUERY_KEY =
  /^(?:access_?token|auth|authorization|credential|expires?|key-?pair-?id|policy|signature|sig|token|x-amz-.+|x-oss-.+)$/i

/** 清理 URL 中易变的签名信息，保留可用于内容比较的稳定部分。 */
function normalizeStableUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value
  try {
    const url = new URL(value)
    for (const key of Array.from(url.searchParams.keys())) {
      if (VOLATILE_URL_QUERY_KEY.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    return url.toString()
  } catch {
    return value
  }
}

/** 递归提取草稿中的创作内容，并跳过元数据、循环引用和易变 URL。 */
function normalizeCreativeContent(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return normalizeStableUrl(value)
  if (value == null || typeof value !== 'object') return value
  if (ancestors.has(value)) return '[Circular]'

  ancestors.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => normalizeCreativeContent(item, ancestors))

    const record = value as Record<string, unknown>
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      if (NON_CREATIVE_DRAFT_KEYS.has(key)) continue
      const item = record[key]
      if (typeof item === 'function' || typeof item === 'undefined') continue
      normalized[key] = normalizeCreativeContent(item, ancestors)
    }
    return normalized
  } finally {
    ancestors.delete(value)
  }
}

/** 将草稿对象或 JSON 字符串解析为记录。 */
function parseDraftRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return parseDraftRecord(JSON.parse(value))
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * 仅对用户可编辑的创作内容计算指纹；排除生成任务、权限元数据和过期 URL 参数。
 * 因此后台任务完成后的合并不会被打开中的编辑器误判为竞争性创作修改。
 */
export function createCreativeDraftContentFingerprint(draft: unknown): string {
  if (draft == null || draft === '') return hashFingerprintText('{}')
  const record = parseDraftRecord(draft)
  if (!record) return ''
  const smart =
    record.smart && typeof record.smart === 'object' && !Array.isArray(record.smart)
      ? (record.smart as Record<string, unknown>)
      : null
  const content = smart
    ? {
        flow: record.flow ?? smart.flow ?? '',
        title: record.title ?? smart.projectName ?? '',
        smart,
      }
    : record

  try {
    return hashFingerprintText(JSON.stringify(normalizeCreativeContent(content)))
  } catch {
    return ''
  }
}

/** 断言云端创作内容仍与编辑会话的基准一致，防止静默覆盖他人修改。 */
export function assertCreativeDraftContentUnchanged(baseFingerprint: string, latestDraft: unknown): string {
  const latestFingerprint = createCreativeDraftContentFingerprint(latestDraft)
  if (baseFingerprint && latestFingerprint !== baseFingerprint) {
    throw new CreativeDraftContentConflictError()
  }
  return latestFingerprint
}

/**
 * 整份草稿写入前校验服务端快照：最新内容等于基准或本次目标时仍归当前写入方所有。
 * 这可兼容同页后台写入及响应丢失；若出现第三种内容则判定为真实并发编辑并阻止覆盖。
 */
export function assertCreativeDraftWriteStillOwned(args: {
  baseFingerprint: string
  intendedFingerprint: string
  latestDraft: unknown
  /** @deprecated Exact intended content is always accepted as already owned. */
  acceptIntendedContent?: boolean
}): string {
  const latestFingerprint = createCreativeDraftContentFingerprint(args.latestDraft)
  if (args.intendedFingerprint && latestFingerprint === args.intendedFingerprint) {
    return latestFingerprint
  }
  if (!args.baseFingerprint) throw new CreativeDraftContentConflictError()
  return assertCreativeDraftContentUnchanged(args.baseFingerprint, args.latestDraft)
}
