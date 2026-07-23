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
  const beforeIds = new Set(workspaceBaselineIds.map((id) => Math.floor(Number(id) || 0)).filter((id) => id > 0))
  const isNewTeamWorkspace = (workspace: T): boolean => {
    const id = Math.floor(Number(workspace?.id) || 0)
    return id > 0 && isTeamWorkspace(workspace) && !beforeIds.has(id)
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
