import { normalizeAiTaskStatus } from '@/api/business'

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
 * 节点在发出「创建任务」请求之前就被标成 submitting 并同步到云端，之后只有发起请求的那个页面
 * 能把它推进到下一状态。页面在请求途中被刷新 / 关闭 / 切走，这个状态就成了孤儿：轮询只认 task_id，
 * 界面也没有超时，于是永远显示「生成中」，而且「生成中」的节点不允许再次提交——用户连重试都点不动。
 * 创建任务请求自身最长 10 分钟超时（图片同步出图），再留 1 分钟余量：超过它还在 submitting，
 * 就一定不是哪个页面还在等响应了。
 */
export const CANVAS_SUBMIT_STALE_MS = 11 * 60_000

/** 提交中断后写给用户的说明 */
export const CANVAS_SUBMIT_INTERRUPTED_MESSAGE = '上次提交没有完成（页面在提交过程中被关闭或网络中断），请重新生成'

/**
 * 判断一个 submitting 节点该怎么善后：
 * - none：不是孤儿提交（不在 submitting、已有 task_id，或本页正在提交）；
 * - resume：还在合理窗口内且存了幂等键 → 用同一个幂等键重发，后端去重保证只建一个任务、只扣一次费；
 * - interrupted：超出窗口，或旧数据没存幂等键 → 结束「生成中」，标成提交中断，让用户自己决定是否重来。
 */
export function classifyOrphanSubmission(
  data: Record<string, unknown> = {},
  options: { now: number; submittingInThisPage: boolean },
): 'none' | 'resume' | 'interrupted' {
  if (options.submittingInThisPage) return 'none'
  if (normalizeAiTaskStatus(data.taskStatus) !== 'submitting') return 'none'
  if (Number(data.taskId || 0) > 0) return 'none'
  const startedAt = Date.parse(String(data.taskStartedAt || ''))
  const age = Number.isFinite(startedAt) ? options.now - startedAt : Number.POSITIVE_INFINITY
  const key = String(data.taskIdempotencyKey || '').trim()
  const hasRequest = Boolean(data.generationRequest && typeof data.generationRequest === 'object')
  if (age < CANVAS_SUBMIT_STALE_MS && key && hasRequest) return 'resume'
  // 时间戳在未来（设备时钟不准）也按窗口内处理，但没存幂等键的仍只能标中断
  if (age < 0 && key && hasRequest) return 'resume'
  return 'interrupted'
}

/** 重新生成时能否沿用上次中断那一次的幂等键：只有上次确实是提交中断、且请求内容原样未变才行 */
export function reusableInterruptedIdempotencyKey(data: Record<string, unknown> = {}, nextRequest: unknown): string {
  if (data.taskSubmitInterrupted !== true) return ''
  const key = String(data.taskIdempotencyKey || '').trim()
  if (!key) return ''
  try {
    return JSON.stringify(data.generationRequest) === JSON.stringify(nextRequest) ? key : ''
  } catch {
    return ''
  }
}

/** Saved failures are historical snapshots; verify their task before displaying them. */
export function restoreCanvasTaskState(data: Record<string, unknown> = {}): Record<string, unknown> {
  const status = normalizeAiTaskStatus(data.taskStatus)
  if (!failedTaskStatuses.has(status) && status !== 'reconnecting') return data
  const taskId = Number(data.taskId)
  // Querying a payment_failed task can retry settlement; reopening must not initiate that.
  if (status === 'payment_failed' || !Number.isSafeInteger(taskId) || taskId <= 0) {
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
  if (!status || (succeeded && args.hasResult)) {
    return { running: false, failed: false, title: '', detail: '', progress }
  }
  if (status === 'submitting') {
    return { running: true, failed: false, title: '正在提交任务', detail: '等待服务确认任务', progress }
  }
  if (status === 'reconnecting') {
    return { running: true, failed: false, title: '正在核对任务状态', detail: '正在读取上次任务的最新状态' }
  }
  if (['pending', 'queued', 'created'].includes(status)) {
    return { running: true, failed: false, title: '已进入生成队列', detail: '等待模型开始处理', progress }
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
    title: '正在生成内容',
    detail: progress ? `${Math.round(progress)}%` : '模型处理中',
    progress,
  }
}
