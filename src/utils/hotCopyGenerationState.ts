/**
 * 爆款复制生成状态决策：从草稿记录恢复当前生成，并决定继续轮询、等待建单或失败。
 * 为“已创建生成占位但任务 ID 尚未回写”的短暂窗口保留宽限期，避免误报第三条失败记录。
 */
/** 可参与恢复判断的最小生成记录。 */
export interface HotCopyGenerationStateRecord {
  id?: unknown
  status?: unknown
  taskId?: unknown
  idempotencyKey?: unknown
  createdAt?: unknown
}

/** 从任务对象中读取创建任务时使用的幂等键，兼容历史接口的蛇形/驼峰字段。 */
export function getHotCopyTaskIdempotencyKey(task: any): string {
  if (!task || typeof task !== 'object') return ''
  const containers = [task, task.meta, task.metadata, task.request, task.input, task.params]
  for (const container of containers) {
    if (!container || typeof container !== 'object') continue
    const value = container.idempotency_key ?? container.idempotencyKey
    if (String(value || '').trim()) return String(value).trim()
  }
  return ''
}

/** 用幂等键在服务端任务列表中找回爆款复制任务。 */
export function findHotCopyTaskByIdempotencyKey(tasks: unknown, idempotencyKey: unknown): any | null {
  const expected = String(idempotencyKey || '').trim()
  if (!expected || !Array.isArray(tasks)) return null
  return tasks.find((task) => getHotCopyTaskIdempotencyKey(task) === expected) || null
}

/** 当前应绑定到界面的爆款复制生成状态。 */
export interface HotCopyActiveGenerationState {
  videoGenerating: boolean
  vidGenTaskId: number
  generationId: string
}

/** 生成记录等待服务端任务 ID 回写的最长宽限时间。 */
export const HOT_COPY_PENDING_TASK_GRACE_MS = 5 * 60 * 1000

/** 待恢复生成可采取的动作。 */
export type HotCopyPendingRecoveryAction = 'recover-result' | 'resume-task' | 'wait' | 'fail' | 'stop'

/** 待恢复生成的决策结果。 */
export interface HotCopyPendingRecoveryDecision {
  action: HotCopyPendingRecoveryAction
  taskId: number
  /** Remaining task-creation grace period. Only populated for "wait". */
  delayMs: number
}

/** 生成恢复决策所需的草稿与页面状态。 */
export interface HotCopyPendingRecoveryInput {
  generations: HotCopyGenerationStateRecord[]
  taskId?: unknown
  videoGenerating?: unknown
  hasResult?: unknown
  now?: number
  graceMs?: number
}

/** 创建付费任务前一次云端草稿检查的最小结果。 */
export interface HotCopyPaidTaskCheckpointResult {
  draft?: unknown
  creativeConflict?: boolean
}

/** 两阶段保存中，创作配置预保存与最终任务恢复占位的写入模式。 */
export type HotCopyGenerationCheckpointMode = 'creative-only' | 'task-progress'

/** 付费任务能否继续提交的显式判定。 */
export type HotCopyPaidTaskCheckpointDecision =
  | { ok: true }
  | {
      ok: false
      reason: 'save-error' | 'creative-conflict' | 'draft-not-saved'
      message: string
    }

/**
 * 只有云端明确返回已保存、且没有内容冲突的草稿时，才允许创建付费任务。
 * 网络异常、外来流程或无法确认保存都会 fail closed，避免扣费任务与项目草稿失联。
 */
export function resolveHotCopyPaidTaskCheckpoint(
  result?: HotCopyPaidTaskCheckpointResult | null,
  saveError?: unknown,
): HotCopyPaidTaskCheckpointDecision {
  if (saveError) {
    return {
      ok: false,
      reason: 'save-error',
      message: '生成配置保存失败，视频任务尚未启动；请检查网络后重试',
    }
  }
  if (result?.creativeConflict) {
    return {
      ok: false,
      reason: 'creative-conflict',
      message: '项目已在其他页面修改，视频任务尚未启动；请刷新确认后重试',
    }
  }
  if (!result?.draft) {
    return {
      ok: false,
      reason: 'draft-not-saved',
      message: '生成配置未能保存到当前项目，视频任务尚未启动；请重新进入项目后重试',
    }
  }
  return { ok: true }
}

/**
 * 创作配置预保存不得提前制造 taskId=0 的 processing；只有最终付费门禁才写任务恢复记录。
 * 使用泛型保留完整生成记录字段，供草稿持久化直接复用。
 */
export function mergeHotCopyGenerationCheckpoint<T extends HotCopyGenerationStateRecord>(
  current: readonly T[],
  generation: T,
  mode: HotCopyGenerationCheckpointMode,
): T[] {
  const generations = Array.isArray(current) ? current.slice() : []
  if (mode === 'creative-only') return generations

  const generationId = String(generation?.id || '')
  const index = generations.findIndex((item) => String(item?.id || '') === generationId)
  if (index >= 0) generations[index] = generation
  else generations.unshift(generation)
  return generations
}

/** 项目活动任务始终跟随最新 processing 记录，而不是最后到达的浏览器回调。 */
export function resolveHotCopyActiveGenerationState(
  generations: HotCopyGenerationStateRecord[],
): HotCopyActiveGenerationState {
  const active = (Array.isArray(generations) ? generations : [])
    .map((generation, index) => ({
      generation,
      index,
      createdAt: Number(generation?.createdAt || 0) || 0,
    }))
    .filter(({ generation }) => String(generation?.status || '') === 'processing')
    .sort((left, right) => right.createdAt - left.createdAt || left.index - right.index)

  const owner = active[0]?.generation
  if (!owner) {
    return { videoGenerating: false, vidGenTaskId: 0, generationId: '' }
  }

  return {
    videoGenerating: true,
    vidGenTaskId: Number(owner.taskId || 0) || 0,
    generationId: String(owner.id || ''),
  }
}

/**
 * 决定刷新后的页面如何恢复尚未持久化供应商 taskId 的生成记录。
 * 已完成结果优先于“无任务”停止分支，使其他标签页或后台回调写入的结果能够恢复。
 */
export function resolveHotCopyPendingRecovery(input: HotCopyPendingRecoveryInput): HotCopyPendingRecoveryDecision {
  const generations = Array.isArray(input.generations) ? input.generations : []
  const processing = generations
    .map((generation, index) => ({
      generation,
      index,
      createdAt: Number(generation?.createdAt || 0) || 0,
      taskId: Number(generation?.taskId || 0) || 0,
    }))
    .filter(({ generation }) => String(generation?.status || '') === 'processing')
    .sort((left, right) => right.createdAt - left.createdAt || left.index - right.index)

  const explicitTaskId = Number(input.taskId || 0) || 0
  const taskId = explicitTaskId || processing.find((item) => item.taskId > 0)?.taskId || 0
  const declaredGenerating = Boolean(input.videoGenerating)
  const hasActiveGeneration = processing.length > 0

  // Terminal persistence clears both the active flag and processing record.
  // Check this before "stop" so a result that arrived during polling is applied.
  if (Boolean(input.hasResult) && !declaredGenerating && !hasActiveGeneration) {
    return { action: 'recover-result', taskId, delayMs: 0 }
  }

  if (taskId > 0) return { action: 'resume-task', taskId, delayMs: 0 }
  if (!declaredGenerating && !hasActiveGeneration) return { action: 'stop', taskId: 0, delayMs: 0 }

  const pendingStartedAt = processing.find((item) => item.taskId <= 0)?.createdAt || 0
  if (!(pendingStartedAt > 0)) return { action: 'fail', taskId: 0, delayMs: 0 }

  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now()
  const graceMs =
    Number.isFinite(input.graceMs) && Number(input.graceMs) >= 0
      ? Number(input.graceMs)
      : HOT_COPY_PENDING_TASK_GRACE_MS
  const elapsed = Math.max(0, now - pendingStartedAt)
  const remaining = Math.max(0, graceMs - elapsed)

  if (remaining > 0) return { action: 'wait', taskId: 0, delayMs: remaining }
  return { action: 'fail', taskId: 0, delayMs: 0 }
}
