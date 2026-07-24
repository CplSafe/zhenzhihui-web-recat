import type { GenerationOperationCode } from './generationModelCatalog'

/** 一条智能成片视频队列所属的不可变页面会话。 */
export interface SmartVideoQueueOwner {
  sessionId: number
  workspaceId: number
  projectId: number
}

/** 队列安全工具只依赖的最小任务结构。 */
export interface SmartVideoQueueJobLike {
  id?: unknown
  idempotencyKey?: unknown
  checkpointState?: unknown
  context?: {
    sessionId?: unknown
    workspaceId?: unknown
    projectId?: unknown
  } | null
}

export interface RejectedSmartVideoQueueJob<T extends SmartVideoQueueJobLike> {
  job: T
  id: string
  reason: string
}

export interface RestoredSmartVideoQueue<T extends SmartVideoQueueJobLike> {
  jobs: T[]
  rejected: RejectedSmartVideoQueueJob<T>[]
}

/** 单个付费视频任务在用户确认时锁定的报价。 */
export interface LockedSmartVideoQuotedCost {
  operationCode: Extract<GenerationOperationCode, 'video.generate' | 'video.edit'>
  modelVersionId: number
  estimatedCost: number
  batchTotalCost: number
  balanceAtQuote: number
  batchSize: number
  quotedAt: number
}

export interface SmartVideoReestimate {
  operationCode: Extract<GenerationOperationCode, 'video.generate' | 'video.edit'>
  modelVersionId: number
  estimatedCost: number
  balance: number
  canAfford: boolean
}

const positiveInteger = (value: unknown): number => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

const queueJobId = (job: SmartVideoQueueJobLike): string => String(job?.id || '').trim()

/** 返回队列与预期 owner 不一致的明确原因；空字符串表示可以继续。 */
export function getSmartVideoQueueOwnershipError(
  queue: readonly SmartVideoQueueJobLike[],
  owner: SmartVideoQueueOwner,
): string {
  const expectedSessionId = positiveInteger(owner.sessionId)
  const expectedWorkspaceId = positiveInteger(owner.workspaceId)
  const expectedProjectId = positiveInteger(owner.projectId)
  if (!expectedSessionId || !expectedWorkspaceId || !expectedProjectId) {
    return '视频生成队列缺少有效的页面会话、工作空间或项目归属'
  }
  if (!Array.isArray(queue) || !queue.length) return ''

  const seenIds = new Set<string>()
  const seenIdempotencyKeys = new Set<string>()
  for (const job of queue) {
    const id = queueJobId(job)
    if (!id) return '视频生成队列包含缺少任务 ID 的记录'
    if (seenIds.has(id)) return '视频生成队列包含重复任务 ID'
    seenIds.add(id)
    const idempotencyKey = String(job.idempotencyKey || '').trim()
    if (!idempotencyKey) return '视频生成队列包含缺少幂等键的记录'
    if (seenIdempotencyKeys.has(idempotencyKey)) return '视频生成队列包含重复幂等键'
    seenIdempotencyKeys.add(idempotencyKey)

    const context = job.context
    if (
      positiveInteger(context?.sessionId) !== expectedSessionId ||
      positiveInteger(context?.workspaceId) !== expectedWorkspaceId ||
      positiveInteger(context?.projectId) !== expectedProjectId
    ) {
      return '视频生成队列与当前页面会话、工作空间或项目不一致'
    }
  }
  return ''
}

/**
 * 后端草稿中的 saved 只能说明旧页面曾写入过，不能作为本次页面会话的执行凭证。
 * 仅接纳属于当前 workspace/project 的任务，重绑当前 session，并统一改为 pending，
 * 让调用方在创建付费任务前重新写入一次完整云端恢复快照。
 */
export function restoreSmartVideoQueueForOwner<T extends SmartVideoQueueJobLike>(
  queue: readonly T[],
  owner: SmartVideoQueueOwner,
): RestoredSmartVideoQueue<T> {
  const expectedWorkspaceId = positiveInteger(owner.workspaceId)
  const expectedProjectId = positiveInteger(owner.projectId)
  const expectedSessionId = positiveInteger(owner.sessionId)
  const jobs: T[] = []
  const rejected: RejectedSmartVideoQueueJob<T>[] = []
  const seenIds = new Set<string>()
  const seenIdempotencyKeys = new Set<string>()

  for (const original of Array.isArray(queue) ? queue : []) {
    const id = queueJobId(original)
    const idempotencyKey = String(original?.idempotencyKey || '').trim()
    const context = original?.context
    let reason = ''
    if (!expectedSessionId || !expectedWorkspaceId || !expectedProjectId) {
      reason = '当前项目归属无效'
    } else if (!id) {
      reason = '缺少任务 ID'
    } else if (seenIds.has(id)) {
      reason = '任务 ID 重复'
    } else if (!idempotencyKey) {
      reason = '缺少幂等键'
    } else if (seenIdempotencyKeys.has(idempotencyKey)) {
      reason = '幂等键重复'
    } else if (
      positiveInteger(context?.workspaceId) !== expectedWorkspaceId ||
      positiveInteger(context?.projectId) !== expectedProjectId
    ) {
      reason = '任务不属于当前工作空间或项目'
    }

    if (reason) {
      rejected.push({ job: original, id, reason })
      continue
    }

    seenIds.add(id)
    seenIdempotencyKeys.add(idempotencyKey)
    jobs.push({
      ...original,
      id,
      idempotencyKey,
      checkpointState: 'pending',
      context: {
        ...context,
        sessionId: expectedSessionId,
        workspaceId: expectedWorkspaceId,
        projectId: expectedProjectId,
      },
    } as T)
  }

  return { jobs, rejected }
}

/**
 * 用任务提交前的重新估价校验用户确认的锁定报价。
 * 返回空字符串表示价格、模型身份与余额均仍有效。
 */
export function getSmartVideoQuoteValidationError(
  quote: LockedSmartVideoQuotedCost | null | undefined,
  current: SmartVideoReestimate,
): string {
  if (!quote) return '视频任务缺少用户已确认的锁定报价，请重新生成'
  if (
    quote.operationCode !== current.operationCode ||
    positiveInteger(quote.modelVersionId) !== positiveInteger(current.modelVersionId)
  ) {
    return '视频任务的模型或操作类型已变化，请重新确认费用'
  }

  const quotedCost = Number(quote.estimatedCost)
  const quotedBatchTotal = Number(quote.batchTotalCost)
  const quotedBalance = Number(quote.balanceAtQuote)
  const quotedBatchSize = positiveInteger(quote.batchSize)
  const quotedAt = Number(quote.quotedAt)
  const currentCost = Number(current.estimatedCost)
  const balance = Number(current.balance)
  if (
    !Number.isFinite(quotedCost) ||
    quotedCost < 0 ||
    !Number.isFinite(quotedBatchTotal) ||
    quotedBatchTotal < quotedCost ||
    !Number.isFinite(quotedBalance) ||
    quotedBalance < quotedBatchTotal ||
    !quotedBatchSize ||
    !Number.isFinite(quotedAt) ||
    quotedAt <= 0 ||
    !Number.isFinite(currentCost) ||
    currentCost < 0 ||
    !Number.isFinite(balance) ||
    balance < 0
  ) {
    return '视频任务报价无效，请重新确认费用'
  }
  if (Math.abs(quotedCost - currentCost) > 1e-6) {
    return `视频生成费用已由 ${quotedCost} 积分变为 ${currentCost} 积分，请重新确认后生成`
  }
  if (!current.canAfford || currentCost > balance) {
    return `当前余额 ${balance} 积分不足，尚未创建付费任务`
  }
  return ''
}
