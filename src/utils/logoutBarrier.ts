/**
 * 退出登录写入屏障：账号退出后阻止仍在运行的旧页面异步回调继续保存草稿。
 * 屏障同时保存在内存与 sessionStorage，以覆盖页面卸载和同标签页重挂载窗口。
 */
/** 持久化退出屏障的键前缀。 */
const STORAGE_PREFIX = 'zzh.logout-draft-write-barrier.v1.'
/** 当前标签页已阻断写入的用户作用域。 */
const blockedOwners = new Set<string>()

/** 将用户作用域规范化为空白安全的字符串。 */
function normalizeOwnerScope(ownerScope: unknown): string {
  return String(ownerScope ?? '').trim() || 'anon'
}

/** 构建指定用户的退出屏障存储键。 */
function storageKey(ownerScope: unknown): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(normalizeOwnerScope(ownerScope))}`
}

/** 检查 sessionStorage 中是否仍存在该用户的退出屏障。 */
function persistentBarrierExists(ownerScope: unknown): boolean {
  try {
    return globalThis.localStorage?.getItem(storageKey(ownerScope)) === '1'
  } catch {
    return false
  }
}

/** 退出清理后立即建立跨标签页屏障，阻止卸载回调或在途请求重新创建草稿。 */
export function beginLogoutDraftWriteBarrier(ownerScope: unknown = ''): void {
  const owner = normalizeOwnerScope(ownerScope)
  blockedOwners.add(owner)
  try {
    globalThis.localStorage?.setItem(storageKey(owner), '1')
  } catch {
    /* Storage may be unavailable. The in-memory barrier still protects this tab. */
  }
}

/** 仅为新认证账号解除草稿写入屏障。 */
export function releaseLogoutDraftWriteBarrier(ownerScope: unknown = ''): void {
  const owner = normalizeOwnerScope(ownerScope)
  blockedOwners.delete(owner)
  try {
    globalThis.localStorage?.removeItem(storageKey(owner))
  } catch {
    /* Storage may be unavailable. */
  }
}

/** 判断指定用户是否已禁止草稿写入。 */
export function isLogoutDraftWriteBlocked(ownerScope: unknown = ''): boolean {
  const owner = normalizeOwnerScope(ownerScope)
  return blockedOwners.has(owner) || persistentBarrierExists(owner)
}
