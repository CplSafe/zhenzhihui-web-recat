/**
 * 智能成片活动生成选择器：从草稿记录中确定当前应恢复的任务。
 * 时间相同时保留服务端已认定的任务所有者，防止旧本地自动保存抢占生成状态。
 */
/** 可参与活动任务选择的最小生成记录。 */
export interface SmartActiveGeneration {
  id?: unknown
  status?: unknown
  taskId?: unknown
  createdAt?: unknown
}

export interface SmartVideoGenerationActivityInput {
  generations?: SmartActiveGeneration[]
  taskId?: unknown
  queueLength?: unknown
  localRunning?: boolean
  draining?: boolean
  registered?: boolean
}

/**
 * 区分真实执行者与持久化恢复凭证。visibleActive 可用于短暂展示恢复态；staleRecoveryState
 * 则表示页面已没有任何执行者，调用方应在宽限后结束幽灵 processing，不能再用 visibleActive 反向阻止清理。
 */
export function deriveSmartVideoGenerationActivity(input: SmartVideoGenerationActivityInput): {
  runtimeActive: boolean
  persistedActive: boolean
  visibleActive: boolean
  staleRecoveryState: boolean
} {
  const generations = Array.isArray(input.generations) ? input.generations : []
  const processing = generations.filter((generation) => String(generation?.status || '') === 'processing')
  const runtimeActive = Boolean(input.localRunning || input.draining || input.registered)
  const persistedActive =
    Number(input.taskId || 0) > 0 ||
    Number(input.queueLength || 0) > 0 ||
    processing.some((generation) => Number(generation?.taskId || 0) > 0)
  return {
    runtimeActive,
    persistedActive,
    visibleActive: runtimeActive || persistedActive,
    staleRecoveryState:
      !runtimeActive && (processing.length > 0 || Number(input.taskId || 0) > 0 || Number(input.queueLength || 0) > 0),
  }
}

/** 选择最新的 processing 生成，并返回其记录 ID 与后端任务 ID。 */
export function resolveSmartActiveTask(
  generations: SmartActiveGeneration[],
  serverTaskId = 0,
): { generationId: string; taskId: number } {
  const preferredTaskId = Number(serverTaskId || 0) || 0
  const owner = (Array.isArray(generations) ? generations : [])
    .filter((generation) => String(generation?.status || '') === 'processing')
    .map((generation, index) => ({
      generation,
      index,
      createdAt: Number(generation?.createdAt || 0) || 0,
      taskId: Number(generation?.taskId || 0) || 0,
    }))
    .sort(
      (left, right) =>
        right.createdAt - left.createdAt ||
        Number(right.taskId === preferredTaskId) - Number(left.taskId === preferredTaskId) ||
        left.index - right.index,
    )[0]

  return owner
    ? {
        generationId: String(owner.generation.id || ''),
        taskId: owner.taskId,
      }
    : { generationId: '', taskId: 0 }
}
