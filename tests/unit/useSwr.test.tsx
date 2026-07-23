import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSwr } from '@/composables/useSwr'
import { clearAllCache, setCache } from '@/utils/swrCache'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('useSwr', () => {
  beforeEach(() => {
    clearAllCache()
    window.sessionStorage.clear()
  })

  afterEach(() => clearAllCache())

  it('uses fallback without fetching while disabled', () => {
    const fetcher = vi.fn().mockResolvedValue('network')
    const { result } = renderHook(() => useSwr('disabled', fetcher, { enabled: false, fallback: 'fallback' }))

    expect(result.current).toMatchObject({ data: 'fallback', loading: false, fromCache: false })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('exposes the first request loading state then publishes fresh data', async () => {
    const pending = deferred<string>()
    const fetcher = vi.fn(() => pending.promise)
    const { result } = renderHook(() => useSwr('first-load', fetcher, { fallback: 'fallback' }))

    expect(result.current).toMatchObject({ data: 'fallback', loading: true, fromCache: false })
    expect(fetcher).toHaveBeenCalledOnce()
    act(() => pending.resolve('fresh'))
    await waitFor(() => expect(result.current).toMatchObject({ data: 'fresh', loading: false }))
  })

  it('renders a cached value immediately without a loading flash', () => {
    setCache('cached-hook', 'cached')
    const fetcher = vi.fn().mockResolvedValue('network')
    const { result } = renderHook(() => useSwr('cached-hook', fetcher, { ttl: 60_000 }))

    expect(result.current).toMatchObject({ data: 'cached', loading: false, fromCache: true })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('manual refresh starts a new request and ignores an older in-flight result', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { result } = renderHook(() => useSwr('refresh-race', fetcher, { fallback: 'fallback' }))

    expect(fetcher).toHaveBeenCalledOnce()
    act(() => result.current.refresh())
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))

    act(() => second.resolve('newest'))
    await waitFor(() => expect(result.current.data).toBe('newest'))
    act(() => first.resolve('stale'))
    await Promise.resolve()
    await Promise.resolve()
    expect(result.current.data).toBe('newest')
  })

  it('ignores a request that resolves after unmount', async () => {
    const pending = deferred<string>()
    const fetcher = vi.fn(() => pending.promise)
    const { unmount } = renderHook(() => useSwr('unmounted', fetcher))
    unmount()

    act(() => pending.resolve('late'))
    await Promise.resolve()
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
