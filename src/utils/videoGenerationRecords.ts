/**
 * 视频生成记录定位与不可变更新工具：优先使用 generationId，旧数据再回退 taskId。
 * 精确匹配可避免错误标识更新第一条记录或把其他生成误标为失败、发布。
 */
interface VideoGenerationRecord {
  id?: unknown
  taskId?: unknown
}

/** 判断记录是否属于指定生成 ID，缺少生成 ID 时才使用任务 ID 兼容匹配。 */
function matchesVideoGeneration(generation: VideoGenerationRecord, generationId: string, taskId: number): boolean {
  return generationId
    ? String(generation?.id || '') === generationId
    : taskId > 0 && Number(generation?.taskId || 0) === taskId
}

/** 在生成列表中查找与 generationId 或 taskId 精确对应的记录。 */
export function findVideoGeneration<T extends VideoGenerationRecord>(
  generations: unknown,
  generationId: unknown,
  taskId: unknown,
): T | undefined {
  if (!Array.isArray(generations)) return undefined
  const normalizedGenerationId = String(generationId || '').trim()
  const normalizedTaskId = Number(taskId || 0) || 0
  return generations.find((generation) =>
    matchesVideoGeneration(generation, normalizedGenerationId, normalizedTaskId),
  ) as T | undefined
}

/** 仅更新命中的生成记录；找不到目标时保持原列表不变。 */
export function updateVideoGeneration<T extends VideoGenerationRecord>(
  generations: readonly T[],
  generationId: unknown,
  taskId: unknown,
  update: (generation: T) => T,
): T[] {
  const normalizedGenerationId = String(generationId || '').trim()
  const normalizedTaskId = Number(taskId || 0) || 0
  return generations.map((generation) => {
    if (!matchesVideoGeneration(generation, normalizedGenerationId, normalizedTaskId)) return generation
    const recordTaskId = Number(generation?.taskId || 0) || 0
    if (normalizedTaskId > 0 && recordTaskId > 0 && recordTaskId !== normalizedTaskId) return generation
    return update(generation)
  })
}
