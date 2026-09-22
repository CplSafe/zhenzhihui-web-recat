import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSharedRequestCache, resetAllSharedRequestCaches } from '@/utils/sharedRequestCache'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('sharedRequestCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-18T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    resetAllSharedRequestCaches()
  })

  it('同 key 的并发 acquire 只发一次请求，结果共享；全部释放后才中止', async () => {
    const cache = createSharedRequestCache<string>({ ttlMs: 1000 })
    const pending: Array<ReturnType<typeof deferred<string>>> = []
    // 像 fetch 一样：被 abort 后以错误拒绝。没有持有者在等的拒绝不能变成 unhandled rejection
    const loader = vi.fn((signal: AbortSignal) => {
      const d = deferred<string>()
      signal.addEventListener('abort', () => d.reject(new Error('aborted')))
      pending.push(d)
      return d.promise
    })

    const a = cache.acquire('ws:1', loader)
    const b = cache.acquire('ws:1', loader)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(a.promise).toBe(b.promise)

    const signal = loader.mock.calls[0][0]
    a.release()
    expect(signal.aborted).toBe(false) // 还有 b 在等
    pending[0].resolve('catalog')
    await expect(b.promise).resolves.toBe('catalog')
    expect(cache.peek('ws:1')).toEqual({ value: 'catalog', fresh: true })

    b.release()
    expect(signal.aborted).toBe(true) // 最后一个持有者释放：已完成的请求也 abort，无害且语义一致
    b.release() // 重复 release 不会把计数减成负数
    expect(cache.acquire('ws:1', loader)).toBeTruthy()
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('最后一个持有者在请求返回前释放：中止请求，晚到的结果不写缓存', async () => {
    const cache = createSharedRequestCache<string>({ ttlMs: 1000 })
    const d = deferred<string>()
    const lease = cache.acquire('ws:1', () => d.promise)
    lease.release()
    d.resolve('stale')
    await d.promise
    await Promise.resolve()
    expect(cache.peek('ws:1')).toBeNull()
  })

  it('TTL 内 peek 为 fresh，过期后仍返回旧值但 fresh=false；shouldCache 为 false 的结果不入缓存', async () => {
    const cache = createSharedRequestCache<{ ok: boolean }>({ ttlMs: 1000, shouldCache: (v) => v.ok })
    const bad = cache.acquire('k', async () => ({ ok: false }))
    await bad.promise
    expect(cache.peek('k')).toBeNull()
    bad.release()

    const good = cache.acquire('k', async () => ({ ok: true }))
    await good.promise
    good.release()
    expect(cache.peek('k')?.fresh).toBe(true)
    vi.advanceTimersByTime(1001)
    expect(cache.peek('k')).toEqual({ value: { ok: true }, fresh: false })
  })

  it('订阅者能收到别的持有者刷新到的新值；force 无视进行中的请求另起一次', async () => {
    const cache = createSharedRequestCache<number>({ ttlMs: 1000 })
    const listener = vi.fn()
    const unsubscribe = cache.subscribe('k', listener)

    const first = deferred<number>()
    const a = cache.acquire('k', () => first.promise)
    const second = deferred<number>()
    const loader2 = vi.fn(() => second.promise)
    const b = cache.acquire('k', loader2, { force: true })
    expect(loader2).toHaveBeenCalledTimes(1)
    expect(a.promise).not.toBe(b.promise)

    second.resolve(2)
    await b.promise
    expect(listener).toHaveBeenCalledWith(2)
    first.resolve(1)
    await a.promise
    // 旧请求也会写缓存（它没被中止），但订阅者以最后写入为准，这是可接受的竞争；主要保证不丢通知
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    a.release()
    b.release()
    cache.invalidate('k')
    expect(cache.peek('k')).toBeNull()
  })

  it('resetAllSharedRequestCaches 清空所有实例并中止进行中的请求', () => {
    const cache = createSharedRequestCache<string>({ ttlMs: 1000 })
    const loader = vi.fn((_signal: AbortSignal) => new Promise<string>(() => undefined))
    cache.acquire('k', loader)
    resetAllSharedRequestCaches()
    expect(loader.mock.calls[0]?.[0]?.aborted).toBe(true)
    expect(cache.peek('k')).toBeNull()
  })
})
