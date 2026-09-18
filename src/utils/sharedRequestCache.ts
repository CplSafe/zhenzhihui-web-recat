/**
 * sharedRequestCache — 内存级「单飞 + TTL 缓存 + 引用计数中止」。
 *
 * 解决什么问题:
 *   同一份数据(如某工作空间的模型目录)被多个页面各自挂载时各拉各的,切一次页就重打一遍接口。
 *   本工具让同 key 的并发请求只发一次、结果在 TTL 内直接复用,过期后先给旧值再后台刷新。
 *
 * 与 swrCache 的区别:
 *   - 不落 sessionStorage,只在内存(模型目录随套餐变化,不该跨刷新保活);
 *   - 请求由 AbortSignal 驱动,按持有者计数:最后一个持有者 release() 时才中止,
 *     所以「切空间 / 卸载即中止旧请求」的语义保留,但两个页面同时等同一份数据时不会互相打断。
 *
 * 用法:
 *   const cache = createSharedRequestCache<Catalog>({ ttlMs: 300_000, shouldCache: (c) => !c.error })
 *   const lease = cache.acquire(key, (signal) => load(signal))
 *   lease.promise.then(setState)
 *   // 组件卸载 / key 变化时:
 *   lease.release()
 */

interface CacheEntry<T> {
  value: T
  storedAt: number
}

interface Flight<T> {
  controller: AbortController
  promise: Promise<T>
  holders: number
}

/** 一次 acquire 拿到的持有凭据:promise 与其他持有者共享,release 归还引用。 */
export interface SharedRequestLease<T> {
  promise: Promise<T>
  release: () => void
}

export interface SharedRequestCacheOptions<T> {
  /** 新鲜期(ms):期内直接用缓存不发请求;过期后仍先返回旧值,同时后台刷新。 */
  ttlMs: number
  /** 结果是否值得缓存。例如接口整体失败的目录就不该缓存,下次进页要重试。缺省全部缓存。 */
  shouldCache?: (value: T) => boolean
}

export interface SharedRequestCache<T> {
  /** 读缓存(不发请求);fresh=false 表示已过 TTL,调用方应当在后台刷新。 */
  peek: (key: string) => { value: T; fresh: boolean } | null
  /**
   * 取得(或加入)该 key 的进行中请求。force=true 无视进行中的请求另起一次(手动「重试」用)。
   * 请求成功且 shouldCache 通过时写入缓存并通知订阅者。
   */
  acquire: (
    key: string,
    loader: (signal: AbortSignal) => Promise<T>,
    options?: { force?: boolean },
  ) => SharedRequestLease<T>
  /** 订阅该 key 的缓存更新(别的持有者刷新到新值时也能收到)。返回取消订阅函数。 */
  subscribe: (key: string, listener: (value: T) => void) => () => void
  /** 清掉某个 key(或全部)的缓存;进行中的请求不受影响。 */
  invalidate: (key?: string) => void
  /** 清空缓存与订阅,并中止所有进行中的请求。测试隔离用。 */
  reset: () => void
}

const registry = new Set<SharedRequestCache<unknown>>()

/** 创建一个独立的共享请求缓存。每种数据一个实例,模块级持有即可。 */
export function createSharedRequestCache<T>(options: SharedRequestCacheOptions<T>): SharedRequestCache<T> {
  const { ttlMs, shouldCache } = options
  const entries = new Map<string, CacheEntry<T>>()
  const flights = new Map<string, Flight<T>>()
  const listeners = new Map<string, Set<(value: T) => void>>()

  const notify = (key: string, value: T) => {
    listeners.get(key)?.forEach((listener) => listener(value))
  }

  const cache: SharedRequestCache<T> = {
    peek(key) {
      const entry = entries.get(key)
      if (!entry) return null
      return { value: entry.value, fresh: Date.now() - entry.storedAt < ttlMs }
    },

    acquire(key, loader, options) {
      let flight = flights.get(key)
      if (!flight || options?.force) {
        const controller = new AbortController()
        const next: Flight<T> = { controller, holders: 0, promise: undefined as unknown as Promise<T> }
        next.promise = loader(controller.signal).then((value) => {
          // 已被最后一个持有者中止的请求即使晚些返回也不能写缓存——那是被放弃的空间/版本的数据
          if (controller.signal.aborted) return value
          if (!shouldCache || shouldCache(value)) {
            entries.set(key, { value, storedAt: Date.now() })
            notify(key, value)
          }
          return value
        })
        // 被中止后 loader 通常以 AbortError 拒绝,而此时可能已没有持有者在等——挂一个空 catch,
        // 避免报 unhandled rejection;持有者自己链上的 then/catch 不受影响
        next.promise.catch(() => undefined)
        // 被 force 替换掉的旧 flight 仍由其持有者各自 release,这里只换掉 key 的当前指向
        flights.set(key, next)
        flight = next
      }
      const current = flight
      current.holders += 1
      let released = false
      return {
        promise: current.promise,
        release() {
          if (released) return
          released = true
          current.holders -= 1
          if (current.holders > 0) return
          current.controller.abort()
          if (flights.get(key) === current) flights.delete(key)
        },
      }
    },

    subscribe(key, listener) {
      let set = listeners.get(key)
      if (!set) {
        set = new Set()
        listeners.set(key, set)
      }
      set.add(listener)
      return () => {
        set?.delete(listener)
        if (set && set.size === 0) listeners.delete(key)
      }
    },

    invalidate(key) {
      if (key === undefined) entries.clear()
      else entries.delete(key)
    },

    reset() {
      entries.clear()
      listeners.clear()
      flights.forEach((flight) => flight.controller.abort())
      flights.clear()
    },
  }

  registry.add(cache as SharedRequestCache<unknown>)
  return cache
}

/** 重置所有已创建的共享缓存。测试 setup 里每个用例之后调用,避免用例之间互相串数据。 */
export function resetAllSharedRequestCaches(): void {
  registry.forEach((cache) => cache.reset())
}
