/**
 * 全局视频生成登记表：让智能成片和爆款复制任务在页面卸载后仍可恢复同一 Promise。
 * 跨标签页租约同步生成占用与工作区切换锁，避免重复出片、重复计费及账号间继承任务。
 */
import { useUiStore } from '@/stores/ui'

/**
 * 整片视频生成「全局在途登记表」—— 让生成真正脱离组件,切到别的页面也继续。
 *
 * 背景:整片生成是 server 端任务,前端 await 轮询。这个 await 链卸载后并不会停(JS promise 不随组件卸载中断),
 * 但「这次生成的结果 promise」原本只被那个组件局部持有 —— 组件卸载后没人持有它,
 * 重新进来的新组件不知道「同项目已有一次生成在跑」,于是:
 *   ① 自动生成 effect 误判「没视频」→ 再发起一次(重复出片、重复计费);
 *   ② UI 也接不上正在跑的那次。
 *
 * 把这个结果 promise 按 workspaceId + projectId 存到模块级登记表(活在组件之外),就能:
 *   - 重新进来先查「该项目是否已在生成」→ 是则【订阅同一个 promise】拿结果,不重启;
 *   - 真正实现「切走 / 在别的页面也继续加载」。
 */
export type VideoGenResult = { url: string; assetId: number }
/** 使用全局登记表的视频生成流程。 */
export type VideoGenScope = 'smart' | 'hot-copy'

/** 在途生成的账号、项目、任务及生命周期元数据。 */
export interface RunningVideoGenMeta {
  scope: VideoGenScope
  ownerScope: string
  projectId: number
  workspaceId: number
  taskId: number
  generationId: string
  status: 'preparing' | 'processing' | 'reconnecting'
  startedAt: number
  updatedAt: number
}

/** 模块内登记的生成 Promise 与其可更新元数据。 */
export interface RunningVideoGenEntry {
  promise: Promise<VideoGenResult>
  meta: RunningVideoGenMeta
}

/** 当前标签页内按复合键登记的在途生成。 */
const running = new Map<string, RunningVideoGenEntry>()
/** 当前认证账号作用域，所有查询和新登记均据此隔离。 */
let activeOwnerScope = 'anon'
/** 存在活动生成时展示的工作区切换拦截文案。 */
const WORKSPACE_SWITCH_LOCK_REASON = '当前视频处理中，暂不支持切换团队'
/** 本模块写入全局工作区切换锁的来源标识。 */
const WORKSPACE_SWITCH_LOCK_SOURCE = 'video-generation-registry'
/** 跨标签页生成租约的本地存储键前缀。 */
const LEASE_PREFIX = 'zzh.video-gen-lease.v1.'
/** 租约失去心跳后允许存活的最长时间。 */
const LEASE_TTL_MS = 5 * 60 * 1000
/** 活动任务刷新租约的心跳周期。 */
const LEASE_HEARTBEAT_MS = 30 * 1000
/** 当前标签页的唯一租约所有者标识。 */
const registryTabId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
/** 每个在途生成对应的租约心跳定时器。 */
const leaseHeartbeats = new Map<string, ReturnType<typeof setInterval>>()
/** 最近租约过期边界对应的工作区锁重检定时器。 */
let leaseExpiryTimer: ReturnType<typeof setTimeout> | null = null

/** 将账号作用域规范化为稳定字符串，空值归入匿名作用域。 */
function normalizeOwnerScope(value: unknown): string {
  return String(value ?? '').trim() || 'anon'
}

/** 跨标签页视频生成租约，记录持有标签页和过期时间。 */
interface VideoGenLease extends RunningVideoGenMeta {
  tabId: string
  expiresAt: number
}

/** 安全取得跨标签页租约使用的 localStorage。 */
function leaseStorage(): Storage | null {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

/** 将内存登记键编码为本地租约存储键。 */
function leaseKey(key: string): string {
  return `${LEASE_PREFIX}${encodeURIComponent(key)}`
}

/** 读取仍在有效期内的租约，并主动清理过期或损坏数据。 */
function readLeaseByRegistryKey(key: string): VideoGenLease | null {
  const storage = leaseStorage()
  if (!storage) return null
  const storageKey = leaseKey(key)
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) || 'null') as VideoGenLease | null
    const expiresAt = Number(parsed?.expiresAt || 0)
    if (!parsed || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      storage.removeItem(storageKey)
      return null
    }
    return parsed
  } catch {
    storage.removeItem(storageKey)
    return null
  }
}

/** 写入或续期当前标签页拥有的生成租约。 */
function writeLease(key: string, meta: RunningVideoGenMeta): void {
  const storage = leaseStorage()
  if (!storage) return
  try {
    storage.setItem(
      leaseKey(key),
      JSON.stringify({
        ...meta,
        ownerScope: normalizeOwnerScope(meta.ownerScope),
        tabId: registryTabId,
        expiresAt: Date.now() + LEASE_TTL_MS,
      } satisfies VideoGenLease),
    )
  } catch {
    /* Storage may be unavailable or full. */
  }
}

/** 仅删除当前标签页拥有的租约，避免误删其他标签页任务。 */
function removeOwnedLease(key: string): void {
  const storage = leaseStorage()
  if (!storage) return
  try {
    const lease = readLeaseByRegistryKey(key)
    if (!lease || lease.tabId === registryTabId) storage.removeItem(leaseKey(key))
  } catch {
    /* Storage may be unavailable. */
  }
}

/** 停止指定生成的租约心跳。 */
function stopLeaseHeartbeat(key: string): void {
  const timer = leaseHeartbeats.get(key)
  if (timer) clearInterval(timer)
  leaseHeartbeats.delete(key)
}

/** 启动租约心跳，并在登记项被替换后自动停止。 */
function startLeaseHeartbeat(key: string, entry: RunningVideoGenEntry): void {
  stopLeaseHeartbeat(key)
  writeLease(key, entry.meta)
  const timer = setInterval(() => {
    if (running.get(key) !== entry) {
      stopLeaseHeartbeat(key)
      return
    }
    writeLease(key, entry.meta)
  }, LEASE_HEARTBEAT_MS)
  leaseHeartbeats.set(key, timer)
}

/** 扫描本地租约后得到的有效租约状态与最近过期时间。 */
interface StoredLeaseState {
  hasLease: boolean
  nextExpiryAt: number
}

/** 扫描指定账号的有效跨标签页租约，并返回最近过期边界。 */
function readStoredLeaseStateForOwner(ownerScope: string): StoredLeaseState {
  const storage = leaseStorage()
  if (!storage) return { hasLease: false, nextExpiryAt: 0 }
  const owner = normalizeOwnerScope(ownerScope)
  const now = Date.now()
  let hasLease = false
  let nextExpiryAt = 0
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const storageKey = storage.key(index)
    if (!storageKey?.startsWith(LEASE_PREFIX)) continue
    try {
      const parsed = JSON.parse(storage.getItem(storageKey) || 'null') as VideoGenLease | null
      const expiresAt = Number(parsed?.expiresAt || 0)
      if (!parsed || !Number.isFinite(expiresAt) || expiresAt <= now) {
        storage.removeItem(storageKey)
        continue
      }
      if (normalizeOwnerScope(parsed.ownerScope) !== owner) continue
      hasLease = true
      nextExpiryAt = nextExpiryAt ? Math.min(nextExpiryAt, expiresAt) : expiresAt
    } catch {
      storage.removeItem(storageKey)
    }
  }
  return { hasLease, nextExpiryAt }
}

/** 在最近租约过期后重新同步切换锁，防止后台标签页退出后锁永久残留。 */
function scheduleLeaseExpirySync(nextExpiryAt: number): void {
  if (leaseExpiryTimer) {
    clearTimeout(leaseExpiryTimer)
    leaseExpiryTimer = null
  }
  if (!(nextExpiryAt > 0)) return

  // Re-check just after the nearest lease boundary. A background tab may stop
  // heartbeating without producing another storage event, so the UI lock must
  // not remain stuck until some unrelated user action happens.
  const delay = Math.min(Math.max(nextExpiryAt - Date.now() + 1, 1), 2_147_483_647)
  leaseExpiryTimer = setTimeout(() => {
    leaseExpiryTimer = null
    syncWorkspaceSwitchLock()
  }, delay)
  // Vitest runs this browser module in Node; a distant live lease must not keep
  // the test process alive. Browser timeout handles simply do not expose this.
  ;(leaseExpiryTimer as unknown as { unref?: () => void })?.unref?.()
}

/** 严格校验工作区和项目 ID，禁止无效 ID 降级为跨空间匹配。 */
function normalizeRegistryIdentity(
  workspaceId: number,
  projectId: number,
): { workspaceId: number; projectId: number } | null {
  const normalizedWorkspaceId = Number(workspaceId)
  const normalizedProjectId = Number(projectId)
  if (
    !Number.isSafeInteger(normalizedWorkspaceId) ||
    normalizedWorkspaceId <= 0 ||
    !Number.isSafeInteger(normalizedProjectId) ||
    normalizedProjectId <= 0
  ) {
    return null
  }
  return { workspaceId: normalizedWorkspaceId, projectId: normalizedProjectId }
}

/** 构建包含账号、流程、工作区和项目的全局登记键。 */
function buildKey(
  scope: VideoGenScope,
  workspaceId: number,
  projectId: number,
  ownerScope = activeOwnerScope,
): string | null {
  const identity = normalizeRegistryIdentity(workspaceId, projectId)
  return identity ? `${normalizeOwnerScope(ownerScope)}:${scope}:${identity.workspaceId}:${identity.projectId}` : null
}

/** 根据当前账号的内存任务及跨标签页租约同步工作区切换锁。 */
function syncWorkspaceSwitchLock() {
  const storedLeaseState = readStoredLeaseStateForOwner(activeOwnerScope)
  scheduleLeaseExpirySync(storedLeaseState.nextExpiryAt)
  const hasRunningForActiveOwner =
    Array.from(running.values()).some((entry) => entry.meta.ownerScope === activeOwnerScope) ||
    storedLeaseState.hasLease
  useUiStore
    .getState()
    .setWorkspaceSwitchLockSource(
      WORKSPACE_SWITCH_LOCK_SOURCE,
      hasRunningForActiveOwner,
      hasRunningForActiveOwner ? WORKSPACE_SWITCH_LOCK_REASON : '',
    )
}

/** 设置登记表读写使用的认证账号作用域。 */
export function setVideoGenOwnerScope(ownerScope: unknown): void {
  activeOwnerScope = normalizeOwnerScope(ownerScope)
  syncWorkspaceSwitchLock()
}

/** 退出登录时摘除指定账号的全部本地任务与租约，但不取消服务端生成。 */
export function detachRunningVideoGensForOwner(ownerScope: unknown): number {
  const normalizedOwner = normalizeOwnerScope(ownerScope)
  let removed = 0
  let removedLeases = 0
  for (const [key, entry] of running.entries()) {
    if (entry.meta.ownerScope !== normalizedOwner) continue
    running.delete(key)
    stopLeaseHeartbeat(key)
    removeOwnedLease(key)
    removed += 1
  }
  const storage = leaseStorage()
  if (storage) {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const storageKey = storage.key(index)
      if (!storageKey?.startsWith(LEASE_PREFIX)) continue
      try {
        const lease = JSON.parse(storage.getItem(storageKey) || 'null') as VideoGenLease | null
        if (lease && normalizeOwnerScope(lease.ownerScope) === normalizedOwner) {
          storage.removeItem(storageKey)
          removedLeases += 1
        }
      } catch {
        storage.removeItem(storageKey)
      }
    }
  }
  if (removed || removedLeases) syncWorkspaceSwitchLock()
  return removed
}

/** 该项目当前是否有在途整片生成 */
export function isVideoGenRunning(scope: VideoGenScope, workspaceId: number, projectId: number): boolean {
  const key = buildKey(scope, workspaceId, projectId)
  return key !== null && (running.has(key) || Boolean(readLeaseByRegistryKey(key)))
}

/** 当前会话里是否存在任意在途整片生成 */
export function isAnyVideoGenRunning(): boolean {
  return (
    Array.from(running.values()).some((entry) => entry.meta.ownerScope === activeOwnerScope) ||
    readStoredLeaseStateForOwner(activeOwnerScope).hasLease
  )
}

/** 取该项目在途生成的结果 promise(无则 null);可 await 拿 { url, assetId } */
export function getRunningVideoGen(
  scope: VideoGenScope,
  workspaceId: number,
  projectId: number,
): Promise<VideoGenResult> | null {
  const key = buildKey(scope, workspaceId, projectId)
  return key ? running.get(key)?.promise || null : null
}

/** 读取指定项目在当前标签页中的在途生成元数据。 */
export function getRunningVideoGenMeta(
  scope: VideoGenScope,
  workspaceId: number,
  projectId: number,
): RunningVideoGenMeta | null {
  const key = buildKey(scope, workspaceId, projectId)
  return key ? running.get(key)?.meta || null : null
}

/** 当前用户失去项目权限时摘除本地登记，但不取消服务端生成任务。 */
export function detachRunningVideoGen(scope: VideoGenScope, workspaceId: number, projectId: number): boolean {
  const key = buildKey(scope, workspaceId, projectId)
  if (!key) return false
  const removed = running.delete(key)
  if (removed) {
    stopLeaseHeartbeat(key)
    removeOwnedLease(key)
    syncWorkspaceSwitchLock()
  }
  return removed
}

/** 主动摘除一条已由页面判定为过期/作废的登记；底层 Promise 可继续收尾，但不再参与页面恢复。 */
export function removeRunningVideoGen(scope: VideoGenScope, workspaceId: number, projectId: number): void {
  detachRunningVideoGen(scope, workspaceId, projectId)
}

/** 按流程反查最近启动的在途项目，供 /smart、/hot-copy 根路由恢复项目绑定。 */
export function findRunningVideoGen(scope: VideoGenScope, workspaceId: number): RunningVideoGenEntry | null {
  const ws = Number(workspaceId)
  if (!(ws > 0)) return null
  const matches = Array.from(running.values()).filter(
    (entry) =>
      entry.meta.ownerScope === activeOwnerScope && entry.meta.scope === scope && entry.meta.workspaceId === ws,
  )
  return matches.sort((a, b) => Number(b.meta.startedAt || 0) - Number(a.meta.startedAt || 0))[0] || null
}

/** 更新指定在途生成元数据并立即续写跨标签页租约。 */
export function updateRunningVideoGenMeta(
  scope: VideoGenScope,
  workspaceId: number,
  projectId: number,
  patch: Partial<Omit<RunningVideoGenMeta, 'scope' | 'workspaceId' | 'projectId'>>,
): void {
  const identity = normalizeRegistryIdentity(workspaceId, projectId)
  if (!identity) return
  const key = buildKey(scope, identity.workspaceId, identity.projectId)
  if (!key) return
  const entry = running.get(key)
  if (!entry) return
  entry.meta = {
    ...entry.meta,
    ...patch,
    scope,
    ownerScope: entry.meta.ownerScope,
    workspaceId: identity.workspaceId,
    projectId: identity.projectId,
    updatedAt: Date.now(),
  }
  writeLease(key, entry.meta)
}

/**
 * 登记一次在途生成:把结果 promise 按 workspaceId + projectId 存下,完成/失败后自动摘除。
 * 任一 id 无效(0)时不登记,直接返回原 promise；绝不回退为跨工作区的 projectId 匹配。
 */
export function trackVideoGen(
  scope: VideoGenScope,
  workspaceId: number,
  projectId: number,
  p: Promise<VideoGenResult>,
  metadata: Partial<Omit<RunningVideoGenMeta, 'scope' | 'workspaceId' | 'projectId'>> = {},
): Promise<VideoGenResult> {
  const identity = normalizeRegistryIdentity(workspaceId, projectId)
  if (!identity) return p
  const ownerScope = normalizeOwnerScope(metadata.ownerScope ?? activeOwnerScope)
  const key = buildKey(scope, identity.workspaceId, identity.projectId, ownerScope)
  if (!key) return p
  const existing = running.get(key)
  const now = Date.now()
  const meta: RunningVideoGenMeta = {
    scope,
    ownerScope,
    projectId: identity.projectId,
    workspaceId: identity.workspaceId,
    taskId: Number(metadata.taskId ?? existing?.meta.taskId ?? 0) || 0,
    generationId: String(metadata.generationId ?? existing?.meta.generationId ?? ''),
    status: metadata.status || existing?.meta.status || 'preparing',
    startedAt: Number(metadata.startedAt ?? existing?.meta.startedAt ?? now) || now,
    updatedAt: now,
  }
  if (existing?.promise === p) {
    existing.meta = meta
    writeLease(key, meta)
    syncWorkspaceSwitchLock()
    return p
  }
  const entry = { promise: p, meta }
  running.set(key, entry)
  startLeaseHeartbeat(key, entry)
  syncWorkspaceSwitchLock()
  void p
    .catch(() => {
      /* 失败也要摘除,避免卡住后续重试 */
    })
    .finally(() => {
      if (running.get(key)?.promise === p) {
        running.delete(key)
        stopLeaseHeartbeat(key)
        removeOwnedLease(key)
      }
      syncWorkspaceSwitchLock()
    })
  return p
}

/** 监听其他标签页的租约变化，并重新同步空间切换锁。 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key.startsWith(LEASE_PREFIX)) syncWorkspaceSwitchLock()
  })
}
