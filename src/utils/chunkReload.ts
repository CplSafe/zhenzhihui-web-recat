/**
 * 懒加载分片失效的自动恢复。
 *
 * 场景：应用发布新版本后，服务端上一版的 /assets/xxx-<hash>.js|css 被替换掉。
 * 此时仍开着旧页面（或拿到了被缓存的旧 index.html）的浏览器，在进入某个懒加载路由时
 * 会去请求已经不存在的分片，Vite 的预加载助手抛出
 * 「Unable to preload CSS for …」/「Failed to fetch dynamically imported module」。
 *
 * 这类错误刷新一次即可自愈——新的 index.html 指向新的分片名。所以与其把错误页丢给用户，
 * 不如自动刷新一次；只有刷新后仍然失败（真离线、发布产物本身缺失）才展示错误页。
 */

/** 自动刷新的去重键；同一标签页内共享。 */
const RELOAD_MARK_KEY = 'zzh_chunk_reload_at'

/**
 * 两次自动刷新之间的最小间隔。
 *
 * 用时间窗而不是「一次性开关」：同一会话里可能先后经历多次发布，
 * 每次都应当能自愈；但窗口内连续失败说明刷新解决不了，必须停下来把错误暴露给用户，
 * 否则就是无限刷新循环。
 */
const RELOAD_COOLDOWN_MS = 30_000

/** 分片加载失败的错误特征（不同浏览器文案不同，这里全部覆盖）。 */
const CHUNK_ERROR_PATTERNS = [
  /unable to preload css/i,
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /dynamically imported module.*(404|not found)/i,
]

/** 判断一个错误是否属于「分片没取到」。 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false
  const message =
    typeof error === 'string'
      ? error
      : String((error as { message?: unknown })?.message ?? (error as { toString?: () => string })?.toString?.() ?? '')
  if (!message) return false
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

/** 读取上次自动刷新的时间戳；storage 不可用（隐私模式等）时按「从未刷新」处理。 */
function readLastReloadAt(): number {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_MARK_KEY) || 0) || 0
  } catch {
    return 0
  }
}

/**
 * 因分片失效自动刷新一次。
 *
 * @returns 是否已触发刷新。返回 false 表示处于冷却窗口内，调用方应当展示错误页，
 *          而不是继续等待——此时刷新已经被证明救不回来。
 */
export function reloadOnceForChunkFailure(now = Date.now()): boolean {
  const last = readLastReloadAt()
  if (last && now - last < RELOAD_COOLDOWN_MS) return false
  try {
    window.sessionStorage.setItem(RELOAD_MARK_KEY, String(now))
  } catch {
    // storage 写不进去就无法去重，宁可不刷新也不能冒无限刷新的风险
    return false
  }
  window.location.reload()
  return true
}

/**
 * 监听 Vite 的预加载失败事件并自动恢复。
 *
 * Vite 在分片预加载失败时会先在 window 上派发 `vite:preloadError`，再抛出异常。
 * 在这里拦截可以赶在错误冒泡到路由错误边界之前完成刷新，用户完全看不到中间状态。
 */
export function installChunkFailureRecovery(): () => void {
  const onPreloadError = (event: Event) => {
    // 阻止默认行为可避免 Vite 继续把错误抛给页面；刷新触发失败时仍会走错误边界兜底
    if (reloadOnceForChunkFailure()) event.preventDefault()
  }
  window.addEventListener('vite:preloadError', onPreloadError)
  return () => window.removeEventListener('vite:preloadError', onPreloadError)
}
