import { getAiTaskId, normalizeAiTaskStatus, type AiTaskSubmission } from '@/api/business'
import { STUDIO_OPERATIONS, type StudioOperation } from '@/api/studioHistory'
import type { StudioResultBatch } from '@/components/studio/StudioResultFeed/StudioResultFeed'
import { isDefiniteSubmissionRejection } from './submissionRecovery'

export interface StudioGenerationIntent {
  operation: StudioOperation
  idempotencyKey: string
  batch: Omit<StudioResultBatch, 'items'>
  itemId: string
  taskId?: number
  mediaPending?: true
  submission?: AiTaskSubmission
}

export const STUDIO_TASK_SYNCING = '正在核对原任务，请勿重复提交'
export const STUDIO_MEDIA_PENDING = '任务已完成，正在等待产物可用'

const FAILED_TASK_STATUSES = new Set(['failed', 'error', 'payment_failed', 'cancelled', 'expired'])
const KNOWN_TASK_STATUSES = new Set([
  ...FAILED_TASK_STATUSES,
  'succeeded',
  'completed',
  'success',
  'submitting',
  'pending',
  'processing',
  'queued',
  'running',
])

export function studioGenerationStorageKey(workspaceId: number, userId: number) {
  return workspaceId > 0 && userId > 0 ? `zzh:studio-pending:v1:${workspaceId}:${userId}` : ''
}

export function readStudioGenerationIntents(key: string): StudioGenerationIntent[] {
  if (!key) return []
  const records: StudioGenerationIntent[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const itemKey = localStorage.key(index)
    if (!itemKey?.startsWith(`${key}:`)) continue
    const encoded = localStorage.getItem(itemKey)
    if (!encoded) continue
    const record: StudioGenerationIntent = JSON.parse(encoded)
    if (!record?.itemId || !record.operation || !record.idempotencyKey || !record.batch?.id) {
      throw new Error('创作任务记录无法读取')
    }
    records.push(record)
  }
  return records
}

export function readStudioGenerationIntent(key: string, itemId: string): StudioGenerationIntent | undefined {
  if (!key) return undefined
  const encoded = localStorage.getItem(`${key}:${itemId}`)
  return encoded ? JSON.parse(encoded) : undefined
}

export function isSameStudioGenerationIntent(
  current: StudioGenerationIntent | undefined,
  expected: StudioGenerationIntent,
) {
  return (
    current?.itemId === expected.itemId &&
    current.idempotencyKey === expected.idempotencyKey &&
    current.taskId === expected.taskId &&
    current.mediaPending === expected.mediaPending
  )
}

export function updateStudioGenerationIntent(
  key: string,
  itemId: string,
  intent?: StudioGenerationIntent,
  expected?: StudioGenerationIntent,
) {
  if (!key) throw new Error('请登录后重新进入创作台')
  if (expected && !isSameStudioGenerationIntent(readStudioGenerationIntent(key, itemId), expected)) return null
  const itemKey = `${key}:${itemId}`
  if (intent) localStorage.setItem(itemKey, JSON.stringify(intent))
  else localStorage.removeItem(itemKey)
  return readStudioGenerationIntents(key)
}

type StudioSubmissionBody = {
  workspace_id?: unknown
  model_version_id?: unknown
  operation_code?: StudioOperation
  idempotency_key?: unknown
  prompt?: unknown
  input_assets?: unknown
  params?: unknown
}

function hasMediaUrl(value: unknown): boolean {
  if (typeof value === 'string') return /(?:https?:|blob:|data:)/i.test(value)
  return !!value && typeof value === 'object' && Object.values(value).some(hasMediaUrl)
}

/** Studio 只可持久化以稳定素材 ID 为输入的同一工作空间请求。 */
export function readStudioSubmissionIdentity(submission: AiTaskSubmission, workspaceId: number) {
  const body: StudioSubmissionBody = JSON.parse(submission.body)
  const operation = body?.operation_code
  const idempotencyKey = body?.idempotency_key
  const input = body?.input_assets
  const validAssets =
    input === undefined ||
    (Array.isArray(input) &&
      input.every(
        (asset) =>
          asset &&
          Object.keys(asset).every((key) => key === 'asset_id' || key === 'role') &&
          Number.isSafeInteger(Number(asset.asset_id)) &&
          Number(asset.asset_id) > 0 &&
          !hasMediaUrl(asset.role),
      ))
  const allowedFields = new Set([
    'workspace_id',
    'model_version_id',
    'operation_code',
    'idempotency_key',
    'prompt',
    'input_assets',
    'params',
  ])
  if (
    typeof submission.stream !== 'boolean' ||
    body?.workspace_id !== workspaceId ||
    !Number.isSafeInteger(Number(body.model_version_id)) ||
    Number(body.model_version_id) <= 0 ||
    !Object.keys(body).every((field) => allowedFields.has(field)) ||
    !operation ||
    !STUDIO_OPERATIONS.includes(operation) ||
    (body.prompt !== undefined && typeof body.prompt !== 'string') ||
    typeof idempotencyKey !== 'string' ||
    !idempotencyKey ||
    (submission.stream && operation === 'video.generate') ||
    !validAssets ||
    hasMediaUrl(body.params)
  ) {
    throw new Error('无法安全记录该创作请求，请重新选择素材或参数')
  }
  return { operation, idempotencyKey }
}

type StudioTaskReceipt = { taskId: number; status: string }

/** 这里接受建单和轮询错误中的任务信封，避免把 HTTP 状态当作任务状态。 */
export function readStudioErrorReceipt(error: unknown): StudioTaskReceipt | undefined {
  const failure = error as { response?: unknown; taskId?: unknown }
  function read(value: unknown, depth: number, explicitTask = false): StudioTaskReceipt | undefined {
    if (!value || typeof value !== 'object' || depth > 3) return undefined
    const record = value as Record<string, unknown>
    const task = read(record.task, depth + 1, true) ?? read(record.data, depth + 1)
    if (task) return task
    const taskId = getAiTaskId(record)
    const status = normalizeAiTaskStatus(record.status ?? record.state)
    if (
      taskId &&
      (explicitTask ||
        KNOWN_TASK_STATUSES.has(status) ||
        getAiTaskId({ taskId: record.taskId, task_id: record.task_id }))
    ) {
      return { taskId, status }
    }
  }
  return read(failure?.response, 0) ?? read({ taskId: failure?.taskId }, 0)
}

/** 仅可信的任务终态或首次明确拒绝允许结束原操作。 */
export function isStudioGenerationRejected(error: unknown, attempts: number, taskId?: number) {
  if (attempts === 0 && !taskId) return true
  const remote = readStudioErrorReceipt(error)
  if (remote) return (!taskId || remote.taskId === taskId) && FAILED_TASK_STATUSES.has(remote.status)
  const failure = error as { submissionMayHaveSucceeded?: boolean }
  return attempts === 1 && !taskId && !failure?.submissionMayHaveSucceeded && isDefiniteSubmissionRejection(error)
}

export function isStudioMediaPending(error: unknown, taskId?: number): boolean {
  const failure = error as { code?: string; taskId?: number; smartVideoTaskId?: number }
  return Boolean(
    taskId &&
    failure?.code === 'TASK_MEDIA_PENDING' &&
    getAiTaskId({ taskId: failure.taskId ?? failure.smartVideoTaskId }) === taskId,
  )
}
