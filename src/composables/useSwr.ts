/**
 * useSwr — swrCache 的 React 封装(先返缓存、后台刷新)。
 *
 * 进组件即「秒出」上次缓存的数据,同时后台静默拉最新,回来后自动重渲染。
 * 底层是 src/utils/swrCache.ts,React 无关逻辑都在那里,这里只做 React 接线。
 *
 * 用法:
 *   const { data, loading, fromCache, refresh } = useSwr(
 *     'banners',                    // 缓存键(唯一稳定;带参数自己拼,如 `user:${id}`)
 *     () => listBanners(),          // 取数函数
 *     { ttl: 5 * 60_000, fallback: [] },
 *   )
 *
 *   - data:      缓存值(可能稍旧)→ 后台刷新后变为最新;无缓存时为 fallback,首拉完成后为最新
 *   - loading:   仅「无缓存的首次请求」期间为 true(有缓存时直接 false,因为已有数据可渲染)
 *   - fromCache: 首帧数据是否来自缓存
 *   - refresh(): 手动强制刷新(忽略 TTL)
 *
 * 注意:enabled=false 时不发请求(用于「等依赖就绪再拉」)。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { peekCache, subscribe, swrFetch, invalidate } from '@/utils/swrCache'

export interface UseSwrOptions<T> {
  /** 新鲜期(ms),默认 5 分钟 */
  ttl?: number
  /** 无缓存时 data 的初始值 */
  fallback?: T
  /** 写不写 sessionStorage,默认 true */
  persist?: boolean
  /** false 则暂不请求(依赖未就绪时用) */
  enabled?: boolean
}

export interface UseSwrResult<T> {
  data: T | undefined
  loading: boolean
  fromCache: boolean
  /** 强制刷新(失效缓存后重新拉) */
  refresh: () => void
}

export function useSwr<T>(key: string, fetcher: () => Promise<T>, options: UseSwrOptions<T> = {}): UseSwrResult<T> {
  const { ttl, fallback, persist = true, enabled = true } = options

  // 初始值优先取缓存,实现「首帧即有数据」
  const cachedInit = peekCache<T>(key, persist)
  const [data, setData] = useState<T | undefined>(cachedInit ?? fallback)
  const [loading, setLoading] = useState<boolean>(enabled && cachedInit === undefined)
  const [fromCache] = useState<boolean>(cachedInit !== undefined)
  // refresh() 递增此值触发 effect 重跑:effect 的 cleanup 会把上一次 load() 的 alive 置 false,
  // 取消仍在途的旧请求,避免旧请求后 resolve 覆盖新数据(手动刷新后闪回旧值)。
  const [refreshTick, setRefreshTick] = useState(0)

  // fetcher 用 ref 持有,避免把它放进 effect 依赖导致重复请求
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const load = useCallback(() => {
    if (!enabled) return
    let alive = true
    swrFetch<T>(key, () => fetcherRef.current(), {
      ttl,
      persist,
      onRevalidate: (fresh) => alive && setData(fresh), // 后台刷新到的新数据
    })
      .then(({ data: d }) => {
        if (alive) setData(d)
      })
      .catch(() => {
        /* 取数失败:保留已有 data(可能是缓存/fallback),交由调用方按需处理 */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [key, ttl, persist, enabled])

  useEffect(() => {
    const cleanup = load()
    // 订阅同 key 的其它来源更新(如别处 setCache / 同页另一个 useSwr 刷新)
    const unsub = subscribe<T>(key, (v) => setData(v))
    return () => {
      cleanup?.()
      unsub()
    }
    // refreshTick 变化 → 先 cleanup(取消上一个 in-flight)再 load,实现「刷新即取消旧请求」
  }, [load, key, refreshTick])

  const refresh = useCallback(() => {
    invalidate(key, persist)
    setLoading(peekCache<T>(key, persist) === undefined)
    setRefreshTick((n) => n + 1) // 交给 effect 重跑(带 cleanup),不再直接 load() 泄漏旧请求
  }, [key, persist])

  return { data, loading, fromCache, refresh }
}
