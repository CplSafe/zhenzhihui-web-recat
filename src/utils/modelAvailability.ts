/** 空目录不能证明套餐无权限；只有明确的订阅记录才展示会员建议。 */
export function emptyModelMessage(label: string, subscription: any, now = Date.now()): string {
  const raw =
    subscription?.current_period_end ||
    subscription?.currentPeriodEnd ||
    subscription?.expire_at ||
    subscription?.expires_at ||
    subscription?.expired_at ||
    subscription?.end_at ||
    subscription?.end_time
  const expiry = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(String(raw || ''))
  const purchased = Boolean(
    subscription?.plan_id || subscription?.planId || subscription?.plan_code || subscription?.plan_name,
  )
  if (purchased && Number.isFinite(expiry) && expiry <= now) {
    return '当前会员已到期，请续费或购买其他会员；请选择包含当前功能权益的会员'
  }
  // active=false 也可能是取消或停用，不等于到期；查询失败(undefined)不能当作未购买。
  if (subscription !== undefined && !purchased && !subscription?.active) {
    return `当前空间尚未开通会员，且暂无可用的${label}；请查看包含当前功能权益的会员`
  }
  return `当前空间暂无可用的${label}，请刷新重试；若仍不可用，请联系平台管理员检查功能开放及模型授权`
}

export function membershipAction(message: string): 'renew' | 'purchase' | null {
  if (message.startsWith('当前会员已到期')) return 'renew'
  if (message.startsWith('当前空间尚未开通会员，且暂无可用')) return 'purchase'
  return null
}

export function teamModelMessage(message: string, canPurchase: boolean): string {
  if (canPurchase || !membershipAction(message)) return message
  return membershipAction(message) === 'renew'
    ? '当前团队会员已到期，请联系团队所有者续费或购买包含当前功能权益的会员'
    : '当前团队尚未开通会员，请联系团队所有者购买包含当前功能权益的会员'
}
