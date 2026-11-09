/** 将接口中的未知值收敛为普通记录。 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** 兼容对象或 JSON 字符串形式的项目记录。 */
export function parseRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value)
  if (record) return record
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return null
  }
}

/** 将候选标识规范化为正整数；无效值返回 0。 */
export function positiveInteger(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}
