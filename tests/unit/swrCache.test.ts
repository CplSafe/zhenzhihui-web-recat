import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllCache, invalidate, peekCache, setCache, subscribe, swrFetch } from '@/utils/swrCache'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('swrCache', () => {
  beforeEach(() => {
    clearAllCache()
    window.sessionStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-21T04:00:00.000Z'))
  })

  afterEach(() => {
    clearAllCache()
    vi.useRealTimers()
  })

  it('fetches once on a cache miss and persists the result', async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1 })

    await expect(swrFetch('item', fetcher)).resolves.toEqual({ data: { id: 1 }, fromCache: false })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(peekCache('item')).toEqual({ id: 1 })
    expect(JSON.parse(window.sessionStorage.getItem('swr:item') || '{}')).toMatchObject({ value: { id: 1 } })
  })

  it('deduplicates concurrent cache misses', async () => {
    const pending = deferred<string>()
    const fetcher = vi.fn(() => pending.promise)
    const first = swrFetch('shared', fetcher)
    const second = swrFetch('shared', fetcher)

    expect(fetcher).toHaveBeenCalledOnce()
    pending.resolve('fresh')
    await expect(Promise.all([first, second])).resolves.toEqual([
      { data: 'fresh', fromCache: false },
      { data: 'fresh', fromCache: false },
    ])
  })

  it('returns a fresh cache entry without starting a background request', async () => {
    setCache('fresh', 'cached')
    const fetcher = vi.fn().mockResolvedValue('network')

    await expect(swrFetch('fresh', fetcher, { ttl: 1000 })).resolves.toEqual({
      data: 'cached',
      fromCache: true,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns stale data immediately and publishes a successful background refresh', async () => {
    setCache('stale', 'old')
    vi.advanceTimersByTime(1001)
    const pending = deferred<string>()
    const onRevalidate = vi.fn()
    const subscriber = vi.fn()
    const unsubscribe = subscribe('stale', subscriber)

    await expect(swrFetch('stale', () => pending.promise, { ttl: 1000, onRevalidate })).resolves.toEqual({
      data: 'old',
      fromCache: true,
    })
    pending.resolve('new')
    await vi.runAllTimersAsync()
    await Promise.resolve()

    expect(onRevalidate).toHaveBeenCalledWith('new')
    expect(subscriber).toHaveBeenCalledWith('new')
    expect(peekCache('stale')).toBe('new')
    unsubscribe()
  })

  it('retains stale data when background revalidation fails', async () => {
    setCache('stale-error', 'old')
    vi.advanceTimersByTime(1001)
    const onRevalidate = vi.fn()

    await expect(
      swrFetch('stale-error', () => Promise.reject(new Error('offline')), { ttl: 1000, onRevalidate }),
    ).resolves.toEqual({ data: 'old', fromCache: true })
    await Promise.resolve()
    await Promise.resolve()

    expect(onRevalidate).not.toHaveBeenCalled()
    expect(peekCache('stale-error')).toBe('old')
  })

  it('can operate in memory-only mode', async () => {
    await swrFetch('memory', () => Promise.resolve('value'), { persist: false })
    expect(peekCache('memory', false)).toBe('value')
    expect(window.sessionStorage.getItem('swr:memory')).toBeNull()

    invalidate('memory', false)
    expect(peekCache('memory', false)).toBeUndefined()
  })

  it('does not let an invalidated in-flight request repopulate the cache', async () => {
    const pending = deferred<string>()
    const request = swrFetch('invalidated-flight', () => pending.promise)

    invalidate('invalidated-flight')
    pending.resolve('stale')
    await expect(request).resolves.toEqual({ data: 'stale', fromCache: false })
    expect(peekCache('invalidated-flight')).toBeUndefined()
  })

  it('does not let an in-flight request repopulate a cache cleared during logout', async () => {
    const pending = deferred<string>()
    const request = swrFetch('logout-flight', () => pending.promise)

    clearAllCache()
    pending.resolve('stale-account-data')
    await request
    expect(peekCache('logout-flight')).toBeUndefined()
  })

  it('invalidates only the requested key and clearAllCache preserves unrelated session data', () => {
    setCache('first', 1)
    setCache('second', 2)
    window.sessionStorage.setItem('unrelated', 'keep')

    invalidate('first')
    expect(peekCache('first')).toBeUndefined()
    expect(peekCache('second')).toBe(2)

    clearAllCache()
    expect(peekCache('second')).toBeUndefined()
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep')
  })

  it('unsubscribes without affecting other listeners', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribe('events', first)
    const unsubscribeSecond = subscribe('events', second)

    setCache('events', 1)
    unsubscribeFirst()
    setCache('events', 2)
    unsubscribeSecond()
    setCache('events', 3)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })
})
