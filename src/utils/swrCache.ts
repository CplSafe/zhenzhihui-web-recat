/**
 * swrCache — 通用「先返缓存、后台刷新」(stale-while-revalidate)请求缓存。
 *
 * 解决什么问题:
 *   每次进页面都重复打同一个接口、且要等网络回来才有数据。本工具让你
 *   「立刻拿到上次的数据渲染 UI,同时后台静默请求最新数据,回来后再更新」。
 *
 * 两层存储:
 *   1) 内存(Map)        —— 本次会话最快,组件间共享,不重复请求。
 *   2) sessionStorage   —— 同一标签页内刷新 / 跳走再回来也能「秒出」上次数据;
 *                          关闭标签页即失效(适合 banner 这类时效内容)。
 *
 * ────────────────────────────────────────────────────────────────
 * 用法一:命令式(任意 .ts 里)
 *
 *   import { swrFetch } from '@/utils/swrCache'
 *
 *   const { data, fromCache } = await swrFetch('banners', () => listBanners(), {
 *     ttl: 5 * 60_000,                 // 缓存被视为「新鲜」的时长(可选,默认 5 分钟)
 *     onRevalidate: (fresh) => {       // 后台刷新拿到新数据时回调(可选)
 *       setBanners(fresh)
 *     },
 *   })
 *   // data: 有缓存就是缓存值(可能稍旧),没缓存就是这次请求的最新值
 *   // fromCache: true 表示 data 来自缓存、且已在后台发起刷新
 *
 * 用法二:React 里更省心,直接用配套 hook(见 src/composables/useSwr.ts):
 *
 *   const { data, loading } = useSwr('banners', () => listBanners(), { ttl: 300_000 })
 *
 * ────────────────────────────────────────────────────────────────
 * 注意:
 *   - key 要全局唯一且稳定(同一份数据用同一个 key)。带参数时自己拼,如 `user:${id}`。
 *   - fetcher 抛错时:有缓存则保留旧缓存(不污染),错误向上抛;无缓存则抛给调用方处理。
 *   - 值会被 JSON 序列化进 sessionStorage,故只缓存可 JSON 化的纯数据(不要塞函数/DOM)。
 */

interface CacheEntry<T> {
  /** 缓存的数据 */
  value: T
  /** 写入时间戳(ms),用于判断是否过了 TTL */
  ts: number
}

export interface SwrOptions<T> {
  /** 缓存「新鲜期」(ms)。在此期间命中缓存不会触发后台刷新。默认 5 分钟。 */
  ttl?: number
  /** 后台刷新成功拿到新数据时回调(命令式用法下用它更新 UI)。 */
  onRevalidate?: (fresh: T) => void
  /** 是否写入 sessionStorage 以跨刷新保活。默认 true。设 false 则仅内存。 */
  persist?: boolean
}

export interface SwrResult<T> {
  /** 数据:命中缓存则为缓存值,否则为本次请求结果。 */
  data: T
  /** true = data 来自缓存(此时已在后台发起刷新)。 */
  fromCache: boolean
}

const DEFAULT_TTL = 5 * 60_000
const STORAGE_PREFIX = 'swr:'

/** 进程内缓存:Map<key, entry>。组件/模块共享。 */
const memoryCache = new Map<string, CacheEntry<unknown>>()

/** 同一 key 正在进行的请求,用于去重(并发调用只发一次网络请求)。 */
const inflight = new Map<string, Promise<unknown>>()

/** 订阅者:key 变更时通知(供 useSwr 等响应式刷新)。 */
const subscribers = new Map<string, Set<(value: unknown) => void>>()

function readSession<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.ts === 'number') return parsed as CacheEntry<T>
    return null
  } catch {
    return null
  }
}

function writeSession<T>(key: string, entry: CacheEntry<T>): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry))
  } catch {
    /* 隐私模式 / 配额满 / SSR 等场景静默降级为仅内存 */
  }
}

/** 读缓存:优先内存,内存没有再回填 sessionStorage。 */
function readCache<T>(key: string, persist: boolean): CacheEntry<T> | null {
  const mem = memoryCache.get(key) as CacheEntry<T> | undefined
  if (mem) return mem
  if (!persist) return null
  const ses = readSession<T>(key)
  if (ses) memoryCache.set(key, ses) // 回填内存,后续更快
  return ses
}

/** 写缓存:同时写内存与 sessionStorage,并通知订阅者。 */
function writeCache<T>(key: string, value: T, persist: boolean): void {
  const entry: CacheEntry<T> = { value, ts: Date.now() }
  memoryCache.set(key, entry)
  if (persist) writeSession(key, entry)
  notify(key, value)
}

function notify(key: string, value: unknown): void {
  const subs = subscribers.get(key)
  if (subs) subs.forEach((fn) => fn(value))
}

/** 实际发起请求,并对同 key 并发去重。 */
function revalidate<T>(key: string, fetcher: () => Promise<T>, persist: boolean): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing

  const p = fetcher()
    .then((fresh) => {
      writeCache(key, fresh, persist)
      return fresh
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, p)
  return p
}

/**
 * 先返缓存、后台刷新的取数主入口。
 *
 * @param key      缓存键(全局唯一、稳定)
 * @param fetcher  实际取数函数(返回 Promise)
 * @param options  见 SwrOptions
 * @returns        { data, fromCache } —— 见 SwrResult
 */
export async function swrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: SwrOptions<T> = {},
): Promise<SwrResult<T>> {
  const { ttl = DEFAULT_TTL, onRevalidate, persist = true } = options
  const cached = readCache<T>(key, persist)

  if (cached) {
    const isStale = Date.now() - cached.ts > ttl
    // 缓存已过新鲜期 → 后台静默刷新(不阻塞,失败也不影响已返回的旧值)
    if (isStale) {
      revalidate(key, fetcher, persist)
        .then((fresh) => onRevalidate?.(fresh))
        .catch(() => {
          /* 刷新失败:保留旧缓存,不打断用户 */
        })
    }
    return { data: cached.value, fromCache: true }
  }

  // 无缓存:必须等首个请求
  const fresh = await revalidate(key, fetcher, persist)
  return { data: fresh, fromCache: false }
}

/** 同步读缓存值(没有则 undefined)。用于初始化 state 时秒出。 */
export function peekCache<T>(key: string, persist = true): T | undefined {
  return readCache<T>(key, persist)?.value
}

/** 手动写入缓存(如乐观更新 / 提交后回填)。 */
export function setCache<T>(key: string, value: T, persist = true): void {
  writeCache(key, value, persist)
}

/** 失效指定 key(下次 swrFetch 会重新请求)。 */
export function invalidate(key: string, persist = true): void {
  memoryCache.delete(key)
  if (persist) {
    try {
      sessionStorage.removeItem(STORAGE_PREFIX + key)
    } catch {
      /* ignore */
    }
  }
}

/** 清空所有 SWR 缓存(如退出登录)。 */
export function clearAllCache(): void {
  memoryCache.clear()
  inflight.clear()
  try {
    const toRemove: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(STORAGE_PREFIX)) toRemove.push(k)
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k))
  } catch {
    /* ignore */
  }
}

/**
 * 订阅某 key 的更新。返回取消订阅函数。
 * 主要给 useSwr 用,业务一般不直接调用。
 */
export function subscribe<T>(key: string, fn: (value: T) => void): () => void {
  let set = subscribers.get(key)
  if (!set) {
    set = new Set()
    subscribers.set(key, set)
  }
  set.add(fn as (value: unknown) => void)
  return () => {
    set?.delete(fn as (value: unknown) => void)
    if (set && set.size === 0) subscribers.delete(key)
  }
}
