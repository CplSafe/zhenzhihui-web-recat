/** 有效会员变更只比较后端等级，不用价格或购买周期推测等级。 */
export function resolveMemberPlanAction({
  active,
  purchased,
  hasHistory,
  currentRank,
  targetRank,
}: {
  active: boolean
  purchased: boolean
  hasHistory: boolean
  currentRank: number | null
  targetRank: number | null
}): { text: string; disabled: boolean; reason: string; intent: 'subscribe' | 'upgrade' } {
  if (purchased) return { text: '续费', disabled: false, reason: '', intent: 'subscribe' }
  if (!active) return { text: hasHistory ? '重新开通' : '开通', disabled: false, reason: '', intent: 'subscribe' }
  // 仅可靠等级能确认降级时拦截；其余套餐允许下单，由后端校验购买资格。
  if (currentRank !== null && targetRank !== null && targetRank < currentRank) {
    return {
      text: '不可降级',
      disabled: true,
      reason: '当前会员有效期内不能降级，到期后可重新选择套餐',
      intent: 'upgrade',
    }
  }
  return { text: '购买', disabled: false, reason: '', intent: 'upgrade' }
}

/** 缺失或非法等级保留为未知，0 是有效等级。 */
export function memberPlanRank(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const rank = Number(value)
  return Number.isFinite(rank) && rank >= 0 ? rank : null
}
