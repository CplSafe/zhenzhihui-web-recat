import { describe, expect, it, vi } from 'vitest'
import { createSingleFlight } from '@/utils/singleFlight'

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
