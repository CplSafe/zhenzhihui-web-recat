export interface GenerationFailure {
  message: string
  taskId?: string
  requestId?: string
  code?: string
  httpStatus?: number
  submissionId?: string
  failedAt: string
  stage: 'task' | 'rejected' | 'unknown' | 'local'
}

function identifier(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  return undefined
}

/** 只提取明确的诊断字段，不复制请求正文、签名 URL 或鉴权信息。 */
export function failureIdentifiers(error: any = {}): { taskId?: string; requestId?: string } {
  const payload = error?.response
  const sources = [error, payload, payload?.data, payload?.error, payload?.data?.task, payload?.task]
  let taskId: string | undefined
  let requestId: string | undefined
  for (const source of sources) {
    taskId ||= identifier(source?.task_id ?? source?.taskId)
    if (source?.status && typeof source.status === 'string') taskId ||= identifier(source?.id)
    requestId ||= identifier(source?.request_id ?? source?.requestId ?? source?.trace_id ?? source?.traceId)
  }
  return { taskId, requestId }
}

export function buildGenerationFailure(
  error: any,
  context: { taskId?: unknown; submissionId?: unknown; failedAt?: unknown; submitted?: boolean } = {},
): GenerationFailure {
  const ids = failureIdentifiers(error)
  const taskId = ids.taskId || identifier(context.taskId)
  const httpStatus = Number(error?.status) || undefined
  return {
    message: String(error?.message || '生成失败，请稍后重试'),
    taskId,
    requestId: ids.requestId,
    code: identifier(error?.code),
    httpStatus,
    submissionId: identifier(context.submissionId),
    failedAt: String(context.failedAt || new Date().toISOString()),
    stage: taskId ? 'task' : !context.submitted ? 'local' : httpStatus && httpStatus < 500 ? 'rejected' : 'unknown',
  }
}

export function nodeGenerationFailure(data: Record<string, any>): GenerationFailure {
  return (
    data.taskFailure ||
    buildGenerationFailure(
      { message: data.taskError },
      {
        taskId: data.taskId,
        submissionId: data.taskIdempotencyKey,
        failedAt: data.taskUpdatedAt || data.taskStartedAt,
        submitted: Boolean(data.taskId || data.taskIdempotencyKey),
      },
    )
  )
}

export function archiveGenerationFailure(data: Record<string, any>): GenerationFailure[] {
  const history: GenerationFailure[] = Array.isArray(data.taskFailureHistory) ? data.taskFailureHistory : []
  if (
    !data.taskFailure &&
    !['failed', 'error', 'payment_failed', 'submit_failed', 'result_sync_failed'].includes(data.taskStatus)
  )
    return history.slice(-5)
  const current = nodeGenerationFailure(data)
  return [...history.filter((entry) => entry.failedAt !== current.failedAt), current].slice(-5)
}

export const FAILURE_STAGE_LABELS = {
  task: '任务已创建',
  rejected: '请求被服务拒绝，未取得任务编号',
  unknown: '任务状态待确认，请勿反复新建任务',
  local: '任务未提交',
}

export function formatGenerationFailure(details: GenerationFailure): string {
  return [
    `失败原因：${details.message}`,
    `状态：${FAILURE_STAGE_LABELS[details.stage]}`,
    details.taskId && `TaskID：${details.taskId}`,
    details.requestId && `RequestID：${details.requestId}`,
    details.submissionId && `提交编号（幂等键）：${details.submissionId}`,
    details.code && `错误码：${details.code}`,
    details.httpStatus && `HTTP 状态：${details.httpStatus}`,
    `失败时间：${details.failedAt}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** 保存请求指纹而非请求正文；刷新后仅原样请求才复用未知提交的幂等键。 */
export async function generationSubmissionFingerprint(request: unknown): Promise<string> {
  const canonical = (value: any): any => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      )
    return value
  }
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(request)))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function unknownSubmissionKey(data: Record<string, any>, fingerprint: string): string {
  return data.taskFailure?.stage === 'unknown' && data.taskSubmissionFingerprint === fingerprint
    ? String(data.taskIdempotencyKey || data.taskFailure?.submissionId || '')
    : ''
}
