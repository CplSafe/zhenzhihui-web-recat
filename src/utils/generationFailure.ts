export interface GenerationFailure {
  message: string
  taskId?: string
  requestId?: string
  code?: string
  httpStatus?: number
  submissionId?: string
  failedAt: string
  stage: 'task' | 'result' | 'rejected' | 'unknown' | 'local'
  operationCode?: string
  modelVersionId?: number
  workspaceId?: number
  canvasId?: number
}

function identifier(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  return undefined
}

function taskIdentifier(value: unknown): string | undefined {
  const id = identifier(value)
  return id && /^0*[1-9]\d*$/.test(id) ? id : undefined
}

/** 只提取明确的诊断字段，不复制请求正文、签名 URL 或鉴权信息。 */
export function failureIdentifiers(error: any = {}): { taskId?: string; requestId?: string } {
  const payload = error?.response
  const sources = [
    error,
    payload,
    payload?.data,
    payload?.error,
    payload?.data?.error,
    payload?.data?.task,
    payload?.task,
  ]
  let taskId: string | undefined
  let requestId: string | undefined
  for (const source of sources) {
    taskId ||= taskIdentifier(source?.task_id) || taskIdentifier(source?.taskId)
    if (source?.status && typeof source.status === 'string') taskId ||= taskIdentifier(source?.id)
    requestId ||= identifier(source?.request_id ?? source?.requestId ?? source?.trace_id ?? source?.traceId)
  }
  return { taskId, requestId }
}

const definiteRejectionCodes = new Set([
  'INVALID_MODEL_PARAMS',
  '10001',
  'MODEL_NOT_FOUND',
  'INSUFFICIENT_CREDITS',
  '10402',
  'WORKSPACE_CONCURRENCY_LIMIT',
  '10401',
])

/** Only known preflight rejections prove a task was not accepted. */
export function isDefiniteCanvasSubmissionRejection(error: unknown): boolean {
  const failure = error as { status?: unknown; code?: unknown; response?: any } | null | undefined
  const status = Number(failure?.status) || 0
  if (status >= 500 || failureIdentifiers(failure).taskId) return false
  if (status === 401 || status === 403) return true
  const payload = failure?.response
  return [failure?.code, payload?.code, payload?.code_string, payload?.error?.code, payload?.data?.code].some((value) =>
    definiteRejectionCodes.has(
      String(value ?? '')
        .trim()
        .toUpperCase(),
    ),
  )
}

export function buildGenerationFailure(
  error: any,
  context: {
    taskId?: unknown
    submissionId?: unknown
    failedAt?: unknown
    submitted?: boolean
    operationCode?: string
    modelVersionId?: number
    workspaceId?: number
    canvasId?: number
  } = {},
): GenerationFailure {
  const ids = failureIdentifiers(error)
  const taskId = ids.taskId || taskIdentifier(context.taskId)
  const httpStatus = Number(error?.status) || undefined
  return {
    message: String(error?.message || '生成失败，请稍后重试'),
    taskId,
    requestId: ids.requestId,
    code: identifier(error?.code),
    httpStatus,
    submissionId: identifier(context.submissionId),
    failedAt: String(context.failedAt || new Date().toISOString()),
    stage: taskId
      ? 'task'
      : !context.submitted
        ? 'local'
        : isDefiniteCanvasSubmissionRejection(error)
          ? 'rejected'
          : 'unknown',
    operationCode: context.operationCode,
    modelVersionId: context.modelVersionId,
    workspaceId: context.workspaceId,
    canvasId: context.canvasId,
  }
}

export function nodeGenerationFailure(data: Record<string, any>): GenerationFailure {
  const savedFailure = data.taskFailure
  const failure: GenerationFailure = {
    ...buildGenerationFailure(
      { message: data.taskError, requestId: data.taskRequestId },
      {
        taskId: data.taskId,
        submissionId: data.taskIdempotencyKey,
        failedAt: data.taskUpdatedAt || data.taskStartedAt,
        submitted: Boolean(
          data.taskId || data.taskIdempotencyKey || savedFailure || data.taskStatus === 'submission_unknown',
        ),
      },
    ),
    ...savedFailure,
  }
  return {
    ...failure,
    stage: failureStage(failure, data.taskStatus === 'submission_unknown'),
    failedAt: String(savedFailure?.failedAt || data.taskUpdatedAt || data.taskStartedAt || ''),
    operationCode:
      failure.operationCode ||
      (data.generationRequest || data.videoUpscaleRequest)?.operationCode ||
      data.operationCode,
    modelVersionId:
      failure.modelVersionId ||
      (data.generationRequest || data.videoUpscaleRequest)?.modelVersionId ||
      data.modelVersionId,
  }
}

export function archiveGenerationFailure(data: Record<string, any>): GenerationFailure[] {
  const history: GenerationFailure[] = Array.isArray(data.taskFailureHistory) ? data.taskFailureHistory : []
  if (
    !data.taskFailure &&
    !['failed', 'error', 'payment_failed', 'submit_failed', 'submission_unknown', 'result_sync_failed'].includes(
      data.taskStatus,
    )
  )
    return history.slice(-5)
  const current = nodeGenerationFailure(data)
  return [...history.filter((entry) => entry.failedAt !== current.failedAt), current].slice(-5)
}

export const FAILURE_STAGE_LABELS = {
  task: '任务已创建',
  result: '已收到生成结果',
  rejected: '请求被服务拒绝，未取得任务编号',
  unknown: '任务状态待确认，请勿反复新建任务',
  local: '任务未提交',
}

function failureStage(details: GenerationFailure, uncertain = false): GenerationFailure['stage'] {
  if (taskIdentifier(details.taskId)) return 'task'
  if (uncertain || !['local', 'rejected', 'unknown', 'result'].includes(details.stage)) return 'unknown'
  return details.stage
}

export function generationFailureStageLabel(details: GenerationFailure): string {
  return FAILURE_STAGE_LABELS[failureStage(details)]
}

export function formatGenerationFailure(details: GenerationFailure): string {
  return [
    `失败原因：${details.message}`,
    `状态：${generationFailureStageLabel(details)}`,
    details.taskId && `TaskID：${details.taskId}`,
    details.requestId && `RequestID：${details.requestId}`,
    details.submissionId && `提交编号（幂等键）：${details.submissionId}`,
    details.code && `错误码：${details.code}`,
    details.httpStatus && `HTTP 状态：${details.httpStatus}`,
    details.operationCode && `操作类型：${details.operationCode}`,
    details.modelVersionId && `模型 ID：${details.modelVersionId}`,
    details.workspaceId && `空间 ID：${details.workspaceId}`,
    details.canvasId && `画布 ID：${details.canvasId}`,
    `失败时间：${details.failedAt || '未记录'}`,
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
