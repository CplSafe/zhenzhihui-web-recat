/**
 * 新团队订单恢复工具：持久化支付与异步建团之间的意图，并兼容旧版会话存储。
 * 数据按用户和套餐隔离，借助幂等键及 24 小时活动期避免重复下单或跨账号恢复。
 */
/** 待恢复订单的本地存储键前缀。 */
const STORAGE_PREFIX = 'zzh.pending-new-team-order.v1'
// 支付与异步建团是两个阶段。订单支付后，团队空间可能需要较长时间才出现在
// workspace 列表中，因此恢复信息不能和“支付链接复用 10 分钟”共用短 TTL。
export const PENDING_NEW_TEAM_ORDER_TTL_MS = 24 * 60 * 60 * 1000

/** 可跨刷新恢复的新团队购买意图。 */
export interface PendingNewTeamOrderIntent {
  userId: string
  planId: number
  teamName: string
  idempotencyKey: string
  createdAt: number
  workspaceBaselineIds: number[]
  orderId?: number
  newWorkspaceId?: number
  status?: 'pending' | 'paid'
  updatedAt?: number
}

/** 将候选标识规范化为正整数。 */
function normalizePositiveId(value: unknown): number {
  const id = Math.floor(Number(value) || 0)
  return id > 0 ? id : 0
}

/** 将用户标识规范化为稳定字符串。 */
function normalizeUserId(value: unknown): string {
  return String(value || '').trim()
}

/** 构建按用户和套餐隔离的订单恢复键。 */
function storageKey(userId: unknown, planId: unknown): string {
  const user = normalizeUserId(userId)
  const plan = normalizePositiveId(planId)
  return user && plan ? `${STORAGE_PREFIX}.u${encodeURIComponent(user)}.p${plan}` : ''
}

/** 安全取得长期本地存储；受浏览器策略限制时返回 null。 */
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** 取得旧版 sessionStorage，用于迁移和降级。 */
function legacyStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** 校验并规范化持久化的订单意图，拒绝字段不完整的数据。 */
function normalizeIntent(value: unknown): PendingNewTeamOrderIntent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<PendingNewTeamOrderIntent>
  const userId = normalizeUserId(record.userId)
  const planId = normalizePositiveId(record.planId)
  const teamName = String(record.teamName || '').trim()
  const idempotencyKey = String(record.idempotencyKey || '').trim()
  const createdAt = Number(record.createdAt || 0)
  if (
    !userId ||
    !planId ||
    !teamName ||
    !/^[a-z0-9]+$/i.test(idempotencyKey) ||
    !Number.isFinite(createdAt) ||
    createdAt <= 0
  ) {
    return null
  }
  const workspaceBaselineIds = [
    ...new Set(
      (Array.isArray(record.workspaceBaselineIds) ? record.workspaceBaselineIds : [])
        .map(normalizePositiveId)
        .filter(Boolean),
    ),
  ]
  const orderId = normalizePositiveId(record.orderId)
  const newWorkspaceId = normalizePositiveId(record.newWorkspaceId)
  const rawStatus = String(record.status || '')
    .trim()
    .toLowerCase()
  const status = rawStatus === 'paid' ? 'paid' : rawStatus === 'pending' ? 'pending' : undefined
  const updatedAtValue = Number(record.updatedAt || 0)
  const updatedAt = Number.isFinite(updatedAtValue) && updatedAtValue > 0 ? updatedAtValue : 0
  return {
    userId,
    planId,
    teamName,
    idempotencyKey,
    createdAt,
    workspaceBaselineIds,
    ...(orderId ? { orderId } : {}),
    ...(newWorkspaceId ? { newWorkspaceId } : {}),
    ...(status ? { status } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  }
}

/** 判断订单意图是否仍处于允许恢复的活动窗口。 */
function isIntentCurrent(intent: PendingNewTeamOrderIntent, now: number): boolean {
  const lastActivityAt = Math.max(intent.createdAt, Number(intent.updatedAt || 0))
  return now - lastActivityAt >= 0 && now - lastActivityAt < PENDING_NEW_TEAM_ORDER_TTL_MS
}

/** 返回订单创建或最近更新中的较新时间。 */
function intentActivityAt(intent: PendingNewTeamOrderIntent): number {
  return Math.max(intent.createdAt, Number(intent.updatedAt || 0))
}

/** 从指定存储中安全删除订单意图。 */
function removeStoredIntent(target: Storage | null, key: string): void {
  if (!target) return
  try {
    target.removeItem(key)
  } catch {
    /* Storage may be unavailable. */
  }
}

/** 将订单意图写入指定存储，并用布尔值报告是否成功。 */
function writeStoredIntent(target: Storage | null, key: string, intent: PendingNewTeamOrderIntent): boolean {
  if (!target) return false
  try {
    target.setItem(key, JSON.stringify(intent))
    return true
  } catch {
    return false
  }
}

/** 读取并校验指定用户、套餐和有效期内的订单意图。 */
function readStoredIntent(
  target: Storage | null,
  key: string,
  expectedUserId: string,
  expectedPlanId: number,
  now: number,
): PendingNewTeamOrderIntent | null {
  if (!target) return null
  try {
    const intent = normalizeIntent(JSON.parse(target.getItem(key) || 'null'))
    if (
      !intent ||
      intent.userId !== expectedUserId ||
      intent.planId !== expectedPlanId ||
      !isIntentCurrent(intent, now)
    ) {
      target.removeItem(key)
      return null
    }
    return intent
  } catch {
    removeStoredIntent(target, key)
    return null
  }
}

/** 读取单个套餐的待恢复订单，并把旧版会话数据迁移到长期存储。 */
export function loadPendingNewTeamOrder(
  userId: unknown,
  planId: unknown,
  now = Date.now(),
): PendingNewTeamOrderIntent | null {
  const key = storageKey(userId, planId)
  if (!key) return null

  const expectedUserId = normalizeUserId(userId)
  const expectedPlanId = normalizePositiveId(planId)
  const target = storage()
  const legacyTarget = legacyStorage()
  const persistentIntent = readStoredIntent(target, key, expectedUserId, expectedPlanId, now)
  const legacyIntent = readStoredIntent(legacyTarget, key, expectedUserId, expectedPlanId, now)
  const intent =
    persistentIntent && legacyIntent
      ? intentActivityAt(legacyIntent) > intentActivityAt(persistentIntent)
        ? legacyIntent
        : persistentIntent
      : persistentIntent || legacyIntent
  if (!intent) return null

  // Previous versions used sessionStorage. Move that entry into persistent
  // storage on first read so a paid order can still recover after closing the
  // tab or browser during the asynchronous team-provisioning phase.
  if (legacyIntent && (intent === persistentIntent || writeStoredIntent(target, key, intent))) {
    removeStoredIntent(legacyTarget, key)
  }
  return intent
}

/** 读取当前认证用户全部仍可恢复的新团队订单。 */
export function loadPendingNewTeamOrders(userId: unknown, now = Date.now()): PendingNewTeamOrderIntent[] {
  const user = normalizeUserId(userId)
  const target = storage()
  const legacyTarget = legacyStorage()
  if (!user || (!target && !legacyTarget)) return []
  const keyPrefix = `${STORAGE_PREFIX}.u${encodeURIComponent(user)}.p`
  const planIds = new Set<number>()

  for (const source of [target, legacyTarget]) {
    if (!source) continue
    const keys = Array.from({ length: source.length }, (_, index) => source.key(index)).filter((key): key is string =>
      Boolean(key?.startsWith(keyPrefix)),
    )
    for (const key of keys) {
      const suffix = key.slice(keyPrefix.length)
      const planId = normalizePositiveId(suffix)
      if (!planId || String(planId) !== suffix) {
        removeStoredIntent(source, key)
        continue
      }
      planIds.add(planId)
    }
  }

  return [...planIds]
    .map((planId) => loadPendingNewTeamOrder(user, planId, now))
    .filter((intent): intent is PendingNewTeamOrderIntent => Boolean(intent))
    .sort(
      (left, right) => Math.max(right.updatedAt || 0, right.createdAt) - Math.max(left.updatedAt || 0, left.createdAt),
    )
}

/** 保存可恢复订单；localStorage 不可用时降级到当前标签页的 sessionStorage。 */
export function savePendingNewTeamOrder(intent: PendingNewTeamOrderIntent): void {
  const normalized = normalizeIntent(intent)
  if (!normalized) return
  const key = storageKey(normalized.userId, normalized.planId)
  const target = storage()
  const legacyTarget = legacyStorage()
  if (!key) return
  if (writeStoredIntent(target, key, normalized)) {
    removeStoredIntent(legacyTarget, key)
    return
  }
  // Keep the old per-tab behavior as a graceful fallback when localStorage is
  // unavailable (privacy mode, quota exhaustion, or policy restrictions).
  writeStoredIntent(legacyTarget, key, normalized)
}

/** 把接口返回的订单和工作区 ID 合并到轮询持有对象，避免后续 paid 写入旧对象时丢失新标识。 */
export function bindPendingNewTeamOrder(
  intent: PendingNewTeamOrderIntent | undefined,
  orderId: unknown,
  newWorkspaceId: unknown,
  now = Date.now(),
): PendingNewTeamOrderIntent | undefined {
  if (!intent) return undefined
  const normalizedOrderId = normalizePositiveId(orderId)
  const normalizedWorkspaceId = normalizePositiveId(newWorkspaceId)
  return {
    ...intent,
    ...(normalizedOrderId ? { orderId: normalizedOrderId } : {}),
    ...(normalizedWorkspaceId ? { newWorkspaceId: normalizedWorkspaceId } : {}),
    status: intent.status || 'pending',
    updatedAt: now,
  }
}

/** 同时清理新旧存储中的指定订单恢复信息。 */
export function clearPendingNewTeamOrder(userId: unknown, planId: unknown): void {
  const key = storageKey(userId, planId)
  if (!key) return
  removeStoredIntent(storage(), key)
  removeStoredIntent(legacyStorage(), key)
}
