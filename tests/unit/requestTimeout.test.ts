import { getSession, uploadMyAvatar } from '@/api/auth'
import { listWorkspaces } from '@/api/business'
import { DEFAULT_API_REQUEST_TIMEOUT_MS, withRequestTimeout } from '@/api/requestTimeout'
import { afterEach, describe, expect, it, vi } from 'vitest'

function rejectWhenAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    if (signal?.aborted) {
      rejectAbort()
      return
    }
    signal?.addEventListener('abort', rejectAbort, { once: true })
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('withRequestTimeout', () => {
  it('uses the default timeout and clears its timer after aborting', async () => {
    vi.useFakeTimers()
    let receivedSignal: AbortSignal | undefined

    const request = withRequestTimeout(
      (signal) => {
        receivedSignal = signal
        return rejectWhenAborted(signal)
      },
      { defaultTimeoutMs: 100 },
    )
    const rejection = expect(request).rejects.toMatchObject({
      name: 'RequestAbortError',
      abortCause: 'timeout',
    })

    await vi.advanceTimersByTimeAsync(100)
    await rejection

    expect(receivedSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports caller cancellation separately and removes the external listener', async () => {
    vi.useFakeTimers()
    const externalController = new AbortController()
    const removeListener = vi.spyOn(externalController.signal, 'removeEventListener')

    const request = withRequestTimeout((signal) => rejectWhenAborted(signal), {
      signal: externalController.signal,
      timeoutMs: 1_000,
    })
    const rejection = expect(request).rejects.toMatchObject({
      name: 'RequestAbortError',
      abortCause: 'aborted',
    })

    externalController.abort()
    await rejection

    expect(removeListener).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps zero as an explicit no-timeout override', async () => {
    vi.useFakeTimers()
    const execute = vi.fn(async (signal: AbortSignal | undefined) => signal)

    await expect(
      withRequestTimeout(execute, {
        timeoutMs: 0,
        defaultTimeoutMs: 1,
      }),
    ).resolves.toBeUndefined()

    expect(execute).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('API request timeout mapping', () => {
  it('times out auth requests even when the response body stalls', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: () => rejectWhenAborted(init?.signal || undefined),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const request = getSession()
    const rejection = expect(request).rejects.toMatchObject({
      name: 'AuthApiError',
      message: '网络请求超时，请稍后重试',
      cause: 'timeout',
    })

    await vi.advanceTimersByTimeAsync(DEFAULT_API_REQUEST_TIMEOUT_MS)
    await rejection

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('applies the default timeout to ordinary business requests', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      rejectWhenAborted(init?.signal || undefined),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = listWorkspaces()
    const rejection = expect(request).rejects.toMatchObject({
      name: 'BusinessApiError',
      message: '网络请求超时，请稍后重试',
      cause: 'timeout',
    })

    await vi.advanceTimersByTimeAsync(DEFAULT_API_REQUEST_TIMEOUT_MS)
    await rejection

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps avatar uploads on the explicit no-timeout path', async () => {
    vi.useFakeTimers()
    let resolveFetch: ((value: Response) => void) | undefined
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = uploadMyAvatar(new File(['avatar'], 'avatar.png', { type: 'image/png' }))
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)

    resolveFetch?.(
      new Response(JSON.stringify({ data: { url: '/avatar.png' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(request).resolves.toEqual({ url: '/avatar.png' })
  })
})
