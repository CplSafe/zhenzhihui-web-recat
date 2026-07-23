/**
 * 创意项目标题持久化决策：在延迟保存前比较基准、目标与服务端最新标题。
 * 用所有权判断阻止旧页面覆盖另一页面刚生成或手动修改的名称。
 */
/** 标题同步的三种处理决定。 */
export type CreativeProjectTitleWriteDecision = 'already-saved' | 'write' | 'conflict'

/** 去除标题首尾空白并兼容空值。 */
const normalizeTitle = (value: unknown): string => String(value || '').trim()
/** 判断项目标题是否仍为默认的“未命名”状态。 */
export const isUnnamedProjectTitle = (value: unknown): boolean => {
  const title = normalizeTitle(value)
  return !title || title.includes('未命名')
}

/** 在发出无 CAS 的标题更新前确认延迟同步仍拥有服务端标题，拦截旧标签页覆盖。 */
export function resolveCreativeProjectTitleWrite(
  expectedTitle: unknown,
  intendedTitle: unknown,
  latestTitle: unknown,
): CreativeProjectTitleWriteDecision {
  const expected = normalizeTitle(expectedTitle)
  const intended = normalizeTitle(intendedTitle)
  const latest = normalizeTitle(latestTitle)

  if (latest === intended) return 'already-saved'
  if (expected) return latest === expected ? 'write' : 'conflict'
  return latest && !isUnnamedProjectTitle(latest) ? 'conflict' : 'write'
}
