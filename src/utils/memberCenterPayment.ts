/**
 * 会员中心支付状态工具：提供提交互斥、订单轮询去重以及支付后团队空间识别。
 * 所有判断均绑定用户和工作区作用域，避免切换账号或团队后旧请求更新当前界面。
 */
/** 防止用户重复发起支付提交的内存锁。 */
export interface MemberCenterPaymentLock {
  current: boolean
}

/** 支付后可能出现的工作区最小结构。 */
export interface MemberCenterWorkspaceCandidate {
  id?: unknown
  type?: unknown
  name?: unknown
  status?: unknown
  workspace_status?: unknown
  workspaceStatus?: unknown
}

/** 从刷新后的工作区列表识别新购团队所需的信息。 */
export interface ResolvePurchasedTeamWorkspaceOptions {
  targetWorkspaceId?: number
  orderedTeamName?: string
  workspaceBaselineIds?: readonly number[]
}

/** 支付流程绑定的用户和工作区快照。 */
export interface MemberCenterPaymentScope {
  userId: unknown
  workspaceId: unknown
}

/** 支付订单的统一判定结果。支付专用字段优先于容易混淆的业务订单 status。 */
export interface MemberCenterPaymentOrderState {
  status: string
  hasPaidEvidence: boolean
}

/**
 * 兼容后端不同版本的支付订单字段。
 * payment_status 一旦存在，就不能再被通用 status 覆盖，避免业务订单已创建却被误判为已付款。
 */
export function resolveMemberCenterPaymentOrderState(order: any): MemberCenterPaymentOrderState {
  if (!order || typeof order !== 'object') return { status: '', hasPaidEvidence: false }
  const paymentStatus = String(order.payment_status ?? order.paymentStatus ?? '').trim()
  const genericStatus = String(order.status ?? order.order_status ?? order.orderStatus ?? '').trim()
  const status = (paymentStatus || genericStatus).toLowerCase()
  const paidAt = order.paid_at ?? order.paidAt ?? order.payment_paid_at ?? order.paymentPaidAt
  const tradeNo =
    order.provider_trade_no ??
    order.providerTradeNo ??
    order.trade_no ??
    order.tradeNo ??
    order.alipay_trade_no ??
    order.alipayTradeNo
  return {
    status,
    hasPaidEvidence: status === 'paid' && Boolean(paymentStatus || paidAt || tradeNo),
  }
}

/** 会员购买/续费只有在订阅权益确实变化后才允许展示成功。 */
export function hasMemberCenterSubscriptionChanged(before: any, after: any): boolean {
  if (!after || typeof after !== 'object') return false
  const activeAfter = Boolean(after.active ?? after.is_active ?? after.isActive)
  if (!before || typeof before !== 'object') return activeAfter
  const activeBefore = Boolean(before.active ?? before.is_active ?? before.isActive)
  const beforeExpiry = memberCenterSubscriptionExpiry(before)
  const afterExpiry = memberCenterSubscriptionExpiry(after)
  if (afterExpiry > beforeExpiry) return true
  if (!activeBefore && activeAfter) return true
  const beforePlan = String(before.plan_id ?? before.planId ?? before.plan_code ?? before.planCode ?? '')
  const afterPlan = String(after.plan_id ?? after.planId ?? after.plan_code ?? after.planCode ?? '')
  return Boolean(afterPlan) && afterPlan !== beforePlan && activeAfter
}

/** 充值只有在可用积分确实增加后才允许展示到账成功。 */
export function hasMemberCenterWalletIncreased(before: unknown, after: any): boolean {
  const beforeValue = Number(before)
  const afterValue = Number(after?.available ?? after?.balance)
  return Number.isFinite(beforeValue) && Number.isFinite(afterValue) && afterValue > beforeValue
}

function memberCenterSubscriptionExpiry(subscription: any): number {
  const raw =
    subscription?.current_period_end ??
    subscription?.currentPeriodEnd ??
    subscription?.expire_at ??
    subscription?.expires_at ??
    subscription?.expired_at ??
    subscription?.end_at ??
    subscription?.end_time
  if (!raw) return 0
  if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw
  const parsed = Date.parse(String(raw))
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 后端金额以分为单位，展示时不得四舍五入成整元。
 * 例如 1 分必须显示为 0.01，否则会把真实付费套餐误导为免费。
 */
export function formatPriceCents(cents: unknown): string {
  const normalizedCents = Number(cents)
  const yuan = Number.isFinite(normalizedCents) ? Math.max(0, normalizedCents) / 100 : 0
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2)
}

/** 为支付异步任务生成稳定的用户作用域。 */
export function getMemberCenterPaymentUserScope(user: any): string {
  return String(user?.id ?? user?.user_id ?? user?.userId ?? user?.account_id ?? user?.uid ?? '').trim()
}

/** 判断异步支付结果是否仍属于当前用户与工作区。 */
export function isSameMemberCenterPaymentScope(
  expected: MemberCenterPaymentScope,
  current: MemberCenterPaymentScope,
): boolean {
  const expectedUserId = String(expected?.userId ?? '').trim()
  const currentUserId = String(current?.userId ?? '').trim()
  const expectedWorkspaceId = Math.floor(Number(expected?.workspaceId) || 0)
  const currentWorkspaceId = Math.floor(Number(current?.workspaceId) || 0)
  return (
    Boolean(expectedUserId) &&
    expectedUserId === currentUserId &&
    expectedWorkspaceId > 0 &&
    expectedWorkspaceId === currentWorkspaceId
  )
}

/** 获取会员中心所有支付入口共用的同步互斥锁。 */
export function tryAcquireMemberCenterPayment(lock: MemberCenterPaymentLock): boolean {
  if (lock.current) return false
  lock.current = true
  return true
}

/** 释放会员支付提交锁。 */
export function releaseMemberCenterPayment(lock: MemberCenterPaymentLock): void {
  lock.current = false
}

/** 每个订单只登记一条轮询并返回所有权令牌，防止旧轮询清理同 ID 的新轮询。 */
export function tryTrackMemberCenterOrder(activeOrders: Map<number, symbol>, orderId: number): symbol | null {
  const normalizedOrderId = Math.floor(Number(orderId) || 0)
  if (normalizedOrderId <= 0 || activeOrders.has(normalizedOrderId)) return null
  const token = Symbol(`member-center-order-${normalizedOrderId}`)
  activeOrders.set(normalizedOrderId, token)
  return token
}

/** 仅在令牌仍匹配时停止跟踪订单，避免旧轮询删除新轮询状态。 */
export function stopTrackingMemberCenterOrder(activeOrders: Map<number, symbol>, orderId: number, token: symbol): void {
  const normalizedOrderId = Math.floor(Number(orderId) || 0)
  if (normalizedOrderId > 0 && activeOrders.get(normalizedOrderId) === token) {
    activeOrders.delete(normalizedOrderId)
  }
}

/** 识别订单创建的团队空间：优先后端精确 ID，其次团队名，最后比较下单前基线差异。 */
export function resolvePurchasedTeamWorkspace<T extends MemberCenterWorkspaceCandidate>(
  workspaces: readonly T[],
  { targetWorkspaceId = 0, orderedTeamName = '', workspaceBaselineIds = [] }: ResolvePurchasedTeamWorkspaceOptions,
): T | null {
  const isTeamWorkspace = (workspace: T): boolean => {
    const type = String(workspace?.type ?? '')
      .trim()
      .toLowerCase()
    return Boolean(type) && type !== 'personal'
  }
  const isActivatedWorkspace = (workspace: T): boolean => {
    const status = String(workspace?.status ?? workspace?.workspace_status ?? workspace?.workspaceStatus ?? '')
      .trim()
      .toLowerCase()
    // 旧接口不返回状态时保持兼容；明确的待支付/待激活状态绝不能作为购买成功凭据。
    return (
      !status ||
      !/(activation_pending|pending_activation|payment_pending|pending_payment|unpaid|inactive|disabled)/.test(status)
    )
  }
  const beforeIds = new Set(workspaceBaselineIds.map((id) => Math.floor(Number(id) || 0)).filter((id) => id > 0))
  const isNewTeamWorkspace = (workspace: T): boolean => {
    const id = Math.floor(Number(workspace?.id) || 0)
    return id > 0 && isTeamWorkspace(workspace) && isActivatedWorkspace(workspace) && !beforeIds.has(id)
  }

  const normalizedTargetId = Math.floor(Number(targetWorkspaceId) || 0)
  if (normalizedTargetId > 0) {
    const exact = workspaces.find(
      (workspace) => Number(workspace?.id) === normalizedTargetId && isNewTeamWorkspace(workspace),
    )
    if (exact) return exact
  }

  const normalizedTeamName = String(orderedTeamName || '')
    .trim()
    .toLowerCase()
  if (normalizedTeamName && beforeIds.size) {
    const namedCandidates = workspaces.filter(
      (workspace) =>
        isNewTeamWorkspace(workspace) &&
        String(workspace?.name ?? '')
          .trim()
          .toLowerCase() === normalizedTeamName,
    )
    if (namedCandidates.length === 1) return namedCandidates[0]
    if (namedCandidates.length > 1) return null
  }

  if (!beforeIds.size) return null

  const newTeamCandidates = workspaces.filter(isNewTeamWorkspace)
  return newTeamCandidates.length === 1 ? newTeamCandidates[0] : null
}
