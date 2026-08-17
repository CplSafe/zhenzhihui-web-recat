import { describe, expect, it, vi } from 'vitest'
import { createKeyedSingleFlight, createSingleFlight } from '@/utils/singleFlight'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

describe('singleFlight', () => {
  it('shares one promise between concurrent callers and starts fresh after it settles', async () => {
    const singleFlight = createSingleFlight<number>()
    const firstRequest = deferred<number>()
    const firstFactory = vi.fn(() => firstRequest.promise)

    const first = singleFlight.run(firstFactory)
    const duplicate = singleFlight.run(firstFactory)

    expect(duplicate).toBe(first)
    expect(firstFactory).toHaveBeenCalledTimes(1)

    firstRequest.resolve(7)
    await expect(first).resolves.toBe(7)

    const nextFactory = vi.fn(async () => 8)
    await expect(singleFlight.run(nextFactory)).resolves.toBe(8)
    expect(nextFactory).toHaveBeenCalledTimes(1)
  })

  it('returns a catchable rejection and releases the failed request', async () => {
    const singleFlight = createSingleFlight<number>()
    const failure = new Error('session unavailable')

    await expect(singleFlight.run(async () => Promise.reject(failure))).rejects.toBe(failure)
    await expect(singleFlight.run(async () => 9)).resolves.toBe(9)

    const synchronousFailure = new Error('synchronous failure')
    await expect(
      singleFlight.run(() => {
        throw synchronousFailure
      }),
    ).rejects.toBe(synchronousFailure)
  })

  it('does not let an older request clear the active request created after reset', async () => {
    const singleFlight = createSingleFlight<number>()
    const oldRequest = deferred<number>()
    const activeRequest = deferred<number>()
    const unexpectedFactory = vi.fn(async () => 99)

    const oldPromise = singleFlight.run(() => oldRequest.promise)
    singleFlight.reset()
    const activePromise = singleFlight.run(() => activeRequest.promise)

    oldRequest.resolve(1)
    await expect(oldPromise).resolves.toBe(1)

    expect(singleFlight.run(unexpectedFactory)).toBe(activePromise)
    expect(unexpectedFactory).not.toHaveBeenCalled()

    activeRequest.resolve(2)
    await expect(activePromise).resolves.toBe(2)
  })
})

describe('keyedSingleFlight', () => {
  it('shares one promise per key and keeps different keys independent', async () => {
    const keyed = createKeyedSingleFlight<string>()
    const first = deferred<string>()
    const second = deferred<string>()
    const factoryA = vi.fn(() => first.promise)
    const factoryB = vi.fn(() => second.promise)

    const a1 = keyed.run(2, factoryA)
    const a2 = keyed.run(2, factoryA)
    const b1 = keyed.run(3, factoryB)

    // 同 key 共享，不同 key 各走各的——否则 ws2 的调用会拿到 ws3 的成员
    expect(a2).toBe(a1)
    expect(b1).not.toBe(a1)
    expect(factoryA).toHaveBeenCalledTimes(1)
    expect(factoryB).toHaveBeenCalledTimes(1)

    first.resolve('members-of-2')
    second.resolve('members-of-3')
    await expect(a1).resolves.toBe('members-of-2')
    await expect(b1).resolves.toBe('members-of-3')
  })

  it('starts a fresh request once the in-flight one settles, so mutations are never served stale data', async () => {
    const keyed = createKeyedSingleFlight<number>()
    const before = vi.fn(async () => 1)
    const after = vi.fn(async () => 2)

    await expect(keyed.run(2, before)).resolves.toBe(1)
    // 成员增删后紧跟的重拉必须真的打网络
    await expect(keyed.run(2, after)).resolves.toBe(2)
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('releases a failed request and supports resetting one key or all keys', async () => {
    const keyed = createKeyedSingleFlight<number>()
    const failure = new Error('members unavailable')

    await expect(keyed.run(2, async () => Promise.reject(failure))).rejects.toBe(failure)
    await expect(keyed.run(2, async () => 5)).resolves.toBe(5)

    const pending = deferred<number>()
    const held = keyed.run(2, () => pending.promise)
    keyed.reset(2)
    const replacement = vi.fn(async () => 6)
    expect(keyed.run(2, replacement)).not.toBe(held)
    expect(replacement).toHaveBeenCalledTimes(1)

    const other = deferred<number>()
    keyed.run(3, () => other.promise)
    keyed.reset()
    const afterResetAll = vi.fn(async () => 7)
    await expect(keyed.run(3, afterResetAll)).resolves.toBe(7)
    expect(afterResetAll).toHaveBeenCalledTimes(1)

    pending.resolve(0)
    other.resolve(0)
  })
})
