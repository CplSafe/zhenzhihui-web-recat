/**
 * 任务进度解析工具：统一按 0～100 的百分比契约展示后端进度。
 * 小数值不会再被猜测为 0～1 比例，比例字段必须由接口显式提供。
 */
/** 只接受完整十进制百分比文本，拒绝混杂单位或非数字内容。 */
const NUMERIC_PERCENT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

/** 按任务中心 0～100 契约规范化百分比；1 和 0.5 分别表示 1% 和 0.5%，不猜测为比例。 */
export function normalizeProgressPercent(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined

  let normalized: number
  if (typeof value === 'string') {
    let text = value.trim()
    if (!text) return undefined
    if (text.endsWith('%')) text = text.slice(0, -1).trim()
    if (!NUMERIC_PERCENT_PATTERN.test(text)) return undefined
    normalized = Number(text)
  } else {
    normalized = value
  }

  if (!Number.isFinite(normalized)) return undefined
  const clamped = Math.max(0, Math.min(100, normalized))
  return Math.round(clamped * 100) / 100
}

/** 从 AI 任务响应的兼容字段中读取第一个有效百分比。 */
export function readAiTaskProgress(task: unknown): number | undefined {
  if (!task || typeof task !== 'object') return undefined
  const record = task as Record<string, unknown>
  const candidates = [record.progress, record.progress_percent, record.progressPercent, record.percentage]
  for (const candidate of candidates) {
    const progress = normalizeProgressPercent(candidate)
    if (progress !== undefined) return progress
  }
  return undefined
}
