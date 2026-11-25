import type { Node } from '@xyflow/react'
import { normalizeAiTaskStatus } from '@/api/business'
import type { CanvasResultHistoryEntry } from '@/utils/canvasElements'

interface CanvasTaskIdentity {
  taskId?: unknown
  taskRunId?: unknown
}

const failedTaskStatuses = new Set([
  'failed',
  'error',
  'payment_failed',
  'cancelled',
  'expired',
  'submit_failed',
  'result_sync_failed',
])

/**
 * 提交中（submitting、还没拿到 task_id）的节点最多能合理地停留多久。
 *
 * 超过此时间可以提示核对原提交。客户端耗时无法证明服务端没有受理。
 */
export const CANVAS_SUBMIT_STALE_MS = 11 * 60_000

export const CANVAS_SUBMISSION_UNKNOWN_MESSAGE = '尚未确认本次提交。请按提交编号核对任务记录，避免重复生成'

export const CANVAS_RESULT_SYNC_DELAYED_MESSAGE = '任务已完成，结果暂未同步，可重新同步原任务'

function isLegacySubmissionReservation(data: Record<string, unknown>, status: string): boolean {
  return Boolean(data.taskIdempotencyKey) && (status === 'queued' || (status === 'preparing' && data.kind === 'audio'))
}

/**
 * 判断一个 submitting 节点该怎么善后：
 * 短窗口内只提示原提交者。超过窗口后协作者也可提示核对，均不重新发送生成请求。
 */
export function classifyOrphanSubmission(
  data: Record<string, unknown> = {},
  options: { now: number; submittingInThisPage: boolean; currentUserId?: number },
): 'none' | 'unknown' {
  if (options.submittingInThisPage) return 'none'
  const status = normalizeAiTaskStatus(data.taskStatus)
  if (status !== 'submitting' && !isLegacySubmissionReservation(data, status)) return 'none'
  if (Number(data.taskId || 0) > 0) return 'none'
  const startedAt = Date.parse(String(data.taskStartedAt || ''))
  const age = Number.isFinite(startedAt) ? options.now - startedAt : Number.POSITIVE_INFINITY
  if (age >= CANVAS_SUBMIT_STALE_MS) return 'unknown'
  if (options.currentUserId !== undefined && Number(data.taskSubmitterId) !== options.currentUserId) return 'none'
  return 'unknown'
}

export function isCanvasSubmissionUnresolved(data: Record<string, unknown> = {}): boolean {
  if (Number(data.taskId || 0) > 0) return false
  const status = normalizeAiTaskStatus(data.taskStatus)
  return (
    status === 'submission_unknown' ||
    status === 'submitting' ||
    isLegacySubmissionReservation(data, status) ||
    (status === 'submit_failed' &&
      (data.taskSubmitInterrupted === true ||
        (data.taskFailure as { stage?: string } | undefined)?.stage === 'unknown'))
  )
}

/** Saved failures are historical snapshots; verify their task before displaying them. */
export function restoreCanvasTaskState(data: Record<string, unknown> = {}): Record<string, unknown> {
  const status = normalizeAiTaskStatus(data.taskStatus)
  if (status === 'result_sync_failed' && (data.videoAudioComposition as { failed?: boolean } | undefined)?.failed)
    return data
  const taskId = Number(data.taskId)
  const hasTaskId = Number.isSafeInteger(taskId) && taskId > 0
  if (
    !hasTaskId &&
    (status === 'reconnecting' ||
      status === 'status_query_failed' ||
      (status === 'submit_failed' && isCanvasSubmissionUnresolved(data)))
  ) {
    return {
      ...data,
      taskStatus: 'submission_unknown',
      taskError: CANVAS_SUBMISSION_UNKNOWN_MESSAGE,
      taskErrorHistorical: true,
      taskSubmitInterrupted: true,
      taskProgress: 0,
      taskStatusQueryFailures: 0,
    }
  }
  if (hasTaskId && (status === 'submission_unknown' || status === 'submitting' || status === 'submit_failed')) {
    return { ...data, taskStatus: 'reconnecting', taskError: '', taskErrorHistorical: true }
  }
  if (hasTaskId && status === 'failed' && String(data.taskError || '').includes('结果同步超时')) {
    return { ...data, taskStatus: 'result_sync_delayed', taskError: CANVAS_RESULT_SYNC_DELAYED_MESSAGE }
  }
  if (status === 'status_query_failed') return { ...data, taskErrorHistorical: true }
  if (!failedTaskStatuses.has(status) && status !== 'reconnecting') return data
  // Querying a payment_failed task can retry settlement; reopening must not initiate that.
  if (status === 'payment_failed' || !hasTaskId) {
    return { ...data, taskErrorHistorical: true }
  }
  return {
    ...data,
    taskStatus: 'reconnecting',
    taskError: '',
    taskErrorHistorical: true,
    taskStatusQueryFailures: 0,
  }
}

/** A late poll may only update the generation that originally requested it. */
export function isSameCanvasTask(current: CanvasTaskIdentity, snapshot: CanvasTaskIdentity): boolean {
  const taskId = Number(snapshot.taskId || 0)
  return taskId > 0 && Number(current.taskId || 0) === taskId && current.taskRunId === snapshot.taskRunId
}

const unsettledTaskStatuses = new Set([
  'submitting',
  'submission_unknown',
  'created',
  'queued',
  'pending',
  'preparing',
  'running',
  'processing',
  'reconnecting',
  'status_query_failed',
  'result_pending',
  'result_sync_delayed',
])

function verifiedCanvasResult(data: Record<string, unknown>) {
  if (data.kind !== 'image' && data.kind !== 'video') return
  if (!['succeeded', 'completed', 'success'].includes(normalizeAiTaskStatus(data.taskStatus))) return
  const taskId = Number(data.taskId)
  const assetId = Number(data.assetId)
  if (!Number.isSafeInteger(taskId) || taskId <= 0 || !Number.isSafeInteger(assetId) || assetId <= 0) return
  const history: CanvasResultHistoryEntry[] = Array.isArray(data.resultHistory) ? data.resultHistory : []
  if (history.some((entry) => Number(entry?.taskId) === taskId && Number(entry?.assetId) === assetId))
    return { taskId, assetId, history }
}

/** Repair only an older phase of the same submission. The incoming graph still owns its layout and edits. */
export function preserveCompletedCanvasResults(known: readonly Node[], incoming: Node[]): Node[] {
  const byNodeId = new Map(known.map((node) => [node.id, node.data]))
  let changed = false
  const nodes = incoming.map((node) => {
    const data = node.data
    const status = normalizeAiTaskStatus(data.taskStatus)
    if (!unsettledTaskStatuses.has(status) && !isCanvasSubmissionUnresolved(data)) return node
    const completed = byNodeId.get(node.id)
    if (!completed || completed.kind !== data.kind) return node
    const result = verifiedCanvasResult(completed)
    if (!result) return node

    const { taskId, assetId, history } = result
    const remoteTaskId = Number(data.taskId || 0)
    const runMatches = Boolean(completed.taskRunId) && completed.taskRunId === data.taskRunId
    const keyMatches = Boolean(completed.taskIdempotencyKey) && completed.taskIdempotencyKey === data.taskIdempotencyKey
    if (completed.taskRunId && data.taskRunId && !runMatches) return node
    if (completed.taskIdempotencyKey && data.taskIdempotencyKey && !keyMatches) return node
    if (remoteTaskId !== taskId && !(remoteTaskId === 0 && runMatches && keyMatches)) return node

    // During a retry the old generated asset may still be displayed. Leave independent material replacements alone.
    const remoteAssetId = Number(data.assetId || 0)
    if (
      remoteAssetId !== 0 &&
      remoteAssetId !== assetId &&
      !history.some(
        (entry) =>
          Number(entry?.assetId) === remoteAssetId && Number(entry?.taskId) > 0 && Number(entry.taskId) !== taskId,
      )
    )
      return node
    if (!remoteAssetId && data.resultUrl && data.resultUrl !== completed.resultUrl) return node

    changed = true
    return {
      ...node,
      data: {
        ...data,
        taskId,
        taskRunId: data.taskRunId ?? completed.taskRunId,
        taskIdempotencyKey: data.taskIdempotencyKey ?? completed.taskIdempotencyKey,
        taskStatus: completed.taskStatus,
        taskProgress: 100,
        taskUpdatedAt: completed.taskUpdatedAt,
        taskError: '',
        taskFailure: undefined,
        taskErrorHistorical: false,
        taskSubmitInterrupted: false,
        taskStatusQueryFailures: 0,
        resultSyncAttempts: 0,
        assetId,
        resultUrl: completed.resultUrl,
        assetWorkspaceId: completed.assetWorkspaceId,
        assetSource: completed.assetSource,
        resultHistory: history,
        poster: completed.poster,
        posterAssetId: completed.posterAssetId,
        imageResultAssetIds: completed.imageResultAssetIds,
        videoAudioComposition: completed.videoAudioComposition,
      },
    }
  })
  return changed ? nodes : incoming
}

/** 生成耗时读数：「12 秒」「1 分 05 秒」「1 小时 02 分」。非法值返回空串。 */
export function formatCanvasElapsed(seconds: unknown): string {
  const total = Math.floor(Number(seconds))
  if (!Number.isFinite(total) || total < 0) return ''
  if (total < 60) return `${total} 秒`
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours} 小时 ${String(minutes).padStart(2, '0')} 分`
  return `${minutes} 分 ${String(total % 60).padStart(2, '0')} 秒`
}

/** 视频生成的预计进度：前段每秒变化 1.x%，后段逐渐放慢，任务完成前不会显示 100%。 */
export function getCanvasEstimatedVideoProgress(seconds: number | null): number {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return 0
  const elapsed = Math.floor(seconds)
  let progress = 0
  let fastSeconds = 0

  // 用秒数生成稳定的变化量，同一任务刷新或重渲染后不会随机回退。
  while (fastSeconds < elapsed && progress < 90) {
    fastSeconds += 1
    progress += 1.1 + ((fastSeconds * 47) % 70) / 100
  }

  if (elapsed > fastSeconds) {
    progress = 99 - (99 - progress) * Math.exp(-(elapsed - fastSeconds) / 180)
  }
  return Math.min(99, Number(progress.toFixed(2)))
}

/**
 * 节点当前显示的素材是否就是 AI 生成的结果（标题旁的「已生成」对勾据此显示）。
 *
 * 不能只看 taskStatus === succeeded：生成成功后再从素材库/本地替换画面，
 * 状态字段不会被清掉，那张图已经不是生成的了。生成历史只登记验证过的结果 assetId，
 * 当前 assetId 在历史里（含回退到更早的一版）才算。
 */
export function isCanvasGeneratedResult(data: Record<string, unknown> = {}): boolean {
  const assetId = Number(data.assetId || 0)
  if (!Number.isSafeInteger(assetId) || assetId <= 0) return false
  const history = Array.isArray(data.resultHistory) ? data.resultHistory : []
  return history.some((entry: any) => Number(entry?.assetId || 0) === assetId)
}

/** 最近一次成功生成的耗时（秒）；时间戳缺失或状态不是成功时返回 null。 */
export function getCanvasGenerationDuration(data: Record<string, unknown> = {}): number | null {
  if (!['succeeded', 'completed', 'success'].includes(normalizeAiTaskStatus(data.taskStatus))) return null
  const started = Date.parse(String(data.taskStartedAt || ''))
  const finished = Date.parse(String(data.taskUpdatedAt || ''))
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null
  return Math.floor((finished - started) / 1000)
}

export interface CanvasTaskPresentation {
  running: boolean
  failed: boolean
  title: string
  detail: string
  progress?: number
}

/** 将后端真实状态翻译为用户可理解的阶段，不伪造百分比。 */
export function getCanvasTaskPresentation(args: {
  status?: unknown
  progress?: unknown
  hasResult?: boolean
  error?: unknown
}): CanvasTaskPresentation {
  const status = normalizeAiTaskStatus(args.status)
  const rawProgress = Number(args.progress)
  const progress = Number.isFinite(rawProgress) && rawProgress > 0 ? Math.min(100, Math.max(0, rawProgress)) : undefined
  const failed = failedTaskStatuses.has(status)
  const succeeded = ['succeeded', 'completed', 'success'].includes(status)

  if (failed) {
    return { running: false, failed: true, title: '生成失败', detail: String(args.error || '请检查设置后重试') }
  }
  if (status === 'submission_unknown') {
    return { running: false, failed: false, title: '提交待确认', detail: CANVAS_SUBMISSION_UNKNOWN_MESSAGE }
  }
  if (status === 'result_sync_delayed') {
    return { running: false, failed: false, title: '结果待同步', detail: CANVAS_RESULT_SYNC_DELAYED_MESSAGE }
  }
  if (!status || (succeeded && args.hasResult)) {
    return { running: false, failed: false, title: '', detail: '', progress }
  }
  if (status === 'submitting') {
    return { running: true, failed: false, title: '提交中', detail: '等待服务确认任务', progress }
  }
  if (status === 'reconnecting') {
    return { running: true, failed: false, title: '正在恢复任务', detail: '获取最新进度…' }
  }
  if (['pending', 'queued', 'created'].includes(status)) {
    return { running: true, failed: false, title: '排队中', detail: '等待模型开始处理', progress }
  }
  if (status === 'result_pending' || succeeded) {
    return { running: true, failed: false, title: '正在同步生成结果', detail: '任务已完成，正在读取结果', progress }
  }
  if (status === 'status_query_failed') {
    return {
      running: true,
      failed: false,
      title: '任务状态查询异常',
      detail: String(args.error || '暂时无法连接任务服务，将继续自动重试'),
      progress,
    }
  }
  return {
    running: true,
    failed: false,
    title: '生成中',
    detail: progress ? `${Math.round(progress)}%` : '模型处理中',
    progress,
  }
}
