import {
  createAiTask,
  getAiTask,
  getAiTaskId,
  normalizeAiTaskStatus,
  uploadAssetFile,
  waitForAiTask,
} from '@/api/business'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function rejectWhenAborted(signal: AbortSignal | null | undefined): Promise<never> {
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

describe('AI task response normalization', () => {
  it('reads all supported task ID aliases and normalizes status values', () => {
    expect(getAiTaskId({ id: '11' })).toBe(11)
    expect(getAiTaskId({ task_id: 12 })).toBe(12)
    expect(getAiTaskId({ taskId: 13 })).toBe(13)
    expect(getAiTaskId({ id: 0, task_id: 14 })).toBe(14)
    expect(normalizeAiTaskStatus(' CANCELED ')).toBe('cancelled')
    expect(normalizeAiTaskStatus('PAYMENT-FAILED')).toBe('payment_failed')
  })

  it('returns an already completed aliased task without polling', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      waitForAiTask({
        workspaceId: 7,
        task: { taskId: '21', status: 'COMPLETED' },
        intervalMs: 0,
      }),
    ).resolves.toMatchObject({ id: 21, status: 'completed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts the provider state alias as the canonical task status', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      waitForAiTask({
        workspaceId: 7,
        task: { task_id: 23, state: 'COMPLETED' },
        intervalMs: 0,
      }),
    ).resolves.toMatchObject({ id: 23, status: 'completed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('unwraps task lifecycle envelopes returned by getAiTask', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task: { task_id: 24, status: 'PROCESSING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { task: { taskId: 25, state: 'COMPLETED' } } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAiTask({ workspaceId: 7, taskId: 24 })).resolves.toMatchObject({
      id: 24,
      status: 'processing',
    })
    await expect(getAiTask({ workspaceId: 7, taskId: 25 })).resolves.toMatchObject({
      id: 25,
      status: 'completed',
    })
  })

  it('unwraps task envelopes returned by createAiTask before callers read the task ID', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task: { task_id: 27, status: 'PROCESSING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { task: { taskId: 28, state: 'COMPLETED' } } }))
    vi.stubGlobal('fetch', fetchMock)
    const baseArgs = {
      workspaceId: 7,
      capability: 'image',
      operationCode: 'image.text_to_image',
      modelVersionId: 91,
      modelVersion: { id: 91 },
      prompt: 'test',
      params: {},
      inputAssets: [],
    }

    await expect(createAiTask(baseArgs)).resolves.toMatchObject({ id: 27, status: 'processing' })
    await expect(createAiTask(baseArgs)).resolves.toMatchObject({ id: 28, status: 'completed' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps polling nested lifecycle responses until the nested task is terminal', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task: { task_id: 26, status: 'PROCESSING' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { task: { task_id: 26, status: 'COMPLETED' } } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      waitForAiTask({
        workspaceId: 7,
        task: { task_id: 26, status: 'PROCESSING' },
        intervalMs: 0,
      }),
    ).resolves.toMatchObject({ id: 26, status: 'completed' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats the American canceled spelling as a failed terminal state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        task_id: 22,
        status: 'CANCELED',
        error_message: 'cancelled by provider',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      waitForAiTask({
        workspaceId: 7,
        task: { taskId: 22, status: 'PROCESSING' },
        intervalMs: 0,
      }),
    ).rejects.toMatchObject({
      name: 'BusinessApiError',
      code: 'TASK_CANCELLED',
      response: expect.objectContaining({ id: 22, status: 'cancelled' }),
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('object-storage upload lifecycle', () => {
  it('does not start metadata creation when the only caller is already cancelled', async () => {
    const file = new File(['image'], 'cancelled.png', { type: 'image/png' })
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    controller.abort()

    await expect(uploadAssetFile({ workspaceId: 7, file, signal: controller.signal })).rejects.toMatchObject({
      name: 'BusinessApiError',
      code: 'ASSET_UPLOAD_ABORTED',
      cause: 'aborted',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shares metadata creation, object upload, and completion for concurrent calls with the same file', async () => {
    const file = new File(['image'], 'shared.png', { type: 'image/png' })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/assets') {
        return Promise.resolve(
          jsonResponse({
            asset: { id: 61, name: 'shared.png' },
            upload: { url: 'https://storage.example.com/upload/61', form_fields: {} },
          }),
        )
      }
      if (url === 'https://storage.example.com/upload/61') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/v1/assets/61/complete?workspace_id=7') {
        return Promise.resolve(jsonResponse({ id: 61, status: 'active' }))
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const [first, second] = await Promise.all([
      uploadAssetFile({ workspaceId: 7, file }),
      uploadAssetFile({ workspaceId: 7, file }),
    ])

    expect(first).toMatchObject({ asset: { id: 61, status: 'active' } })
    expect(second).toMatchObject({ asset: { id: 61, status: 'active' } })
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/assets')).toHaveLength(1)
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input) === 'https://storage.example.com/upload/61'),
    ).toHaveLength(1)
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/assets/61/complete?workspace_id=7'),
    ).toHaveLength(1)
  })

  it('lets one caller abort while another keeps waiting for shared metadata creation', async () => {
    const file = new File(['image'], 'metadata.png', { type: 'image/png' })
    const firstController = new AbortController()
    let metadataSignal: AbortSignal | null | undefined
    let resolveMetadata!: (response: Response) => void
    const metadataResponse = new Promise<Response>((resolve) => {
      resolveMetadata = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/assets') {
        metadataSignal = init?.signal
        return Promise.race([metadataResponse, rejectWhenAborted(init?.signal)])
      }
      if (url === 'https://storage.example.com/upload/63') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/v1/assets/63/complete?workspace_id=7') {
        return Promise.resolve(jsonResponse({ id: 63, status: 'active' }))
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const firstCaller = uploadAssetFile({ workspaceId: 7, file, signal: firstController.signal })
    const secondCaller = uploadAssetFile({ workspaceId: 7, file })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    firstController.abort()
    await expect(firstCaller).rejects.toMatchObject({
      name: 'BusinessApiError',
      code: 'ASSET_UPLOAD_ABORTED',
      cause: 'aborted',
    })
    expect(metadataSignal?.aborted).toBe(false)

    resolveMetadata(
      jsonResponse({
        asset: { id: 63, name: 'metadata.png' },
        upload: { url: 'https://storage.example.com/upload/63', form_fields: {} },
      }),
    )
    await expect(secondCaller).resolves.toMatchObject({ asset: { id: 63, status: 'active' } })
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/assets')).toHaveLength(1)
  })

  it('aborts shared metadata creation when its final waiter is cancelled', async () => {
    const file = new File(['image'], 'metadata-cancelled.png', { type: 'image/png' })
    const controller = new AbortController()
    let metadataSignal: AbortSignal | null | undefined
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/assets') {
        metadataSignal = init?.signal
        return rejectWhenAborted(init?.signal)
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const request = uploadAssetFile({ workspaceId: 7, file, signal: controller.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort()

    await expect(request).rejects.toMatchObject({
      name: 'BusinessApiError',
      code: 'ASSET_UPLOAD_ABORTED',
      cause: 'aborted',
    })
    expect(metadataSignal?.aborted).toBe(true)
  })

  it('does not replace an in-flight upload when its credential age crosses the refresh window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const file = new File(['video'], 'slow.mp4', { type: 'video/mp4' })
    let resolveStorageUpload!: (response: Response) => void
    const storageUpload = new Promise<Response>((resolve) => {
      resolveStorageUpload = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/assets') {
        return Promise.resolve(
          jsonResponse({
            asset: { id: 62, name: 'slow.mp4' },
            upload: { url: 'https://storage.example.com/upload/62', form_fields: {} },
          }),
        )
      }
      if (url === 'https://storage.example.com/upload/62') return storageUpload
      if (url === '/api/v1/assets/62/complete?workspace_id=7') {
        return Promise.resolve(jsonResponse({ id: 62, status: 'active' }))
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = uploadAssetFile({ workspaceId: 7, file })
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input) === 'https://storage.example.com/upload/62'),
      ).toHaveLength(1),
    )
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1)
    const second = uploadAssetFile({ workspaceId: 7, file })

    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/assets')).toHaveLength(1)
    resolveStorageUpload(new Response(null, { status: 204 }))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/assets')).toHaveLength(1)
  })

  it('lets one caller time out without aborting the shared object upload for another caller', async () => {
    vi.useFakeTimers()
    const file = new File(['video'], 'video.mp4', { type: 'video/mp4' })
    let resolveStorageUpload!: (response: Response) => void
    const storageUpload = new Promise<Response>((resolve) => {
      resolveStorageUpload = resolve
    })
    let sharedUploadSignal: AbortSignal | null | undefined
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/assets') {
        return Promise.resolve(
          jsonResponse({
            asset: { id: 71, name: 'video.mp4' },
            upload: { url: 'https://storage.example.com/upload/71', form_fields: {} },
          }),
        )
      }
      if (url === 'https://storage.example.com/upload/71') {
        sharedUploadSignal = init?.signal
        return storageUpload
      }
      if (url === '/api/v1/assets/71/complete?workspace_id=7') {
        return Promise.resolve(jsonResponse({ id: 71, status: 'active' }))
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const firstCaller = uploadAssetFile({
      workspaceId: 7,
      file,
      uploadTimeoutMs: 50,
    })
    const secondCaller = uploadAssetFile({
      workspaceId: 7,
      file,
      uploadTimeoutMs: 500,
    })
    const firstRejection = expect(firstCaller).rejects.toMatchObject({
      name: 'BusinessApiError',
      code: 'ASSET_UPLOAD_TIMEOUT',
      response: expect.objectContaining({ asset_id: 71, retryable: true }),
    })
    await vi.advanceTimersByTimeAsync(50)
    await firstRejection

    expect(sharedUploadSignal?.aborted).toBe(false)
    resolveStorageUpload(new Response(null, { status: 204 }))
    await expect(secondCaller).resolves.toMatchObject({ asset: { id: 71, status: 'active' } })

    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/assets')).toHaveLength(1)
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input) === 'https://storage.example.com/upload/71'),
    ).toHaveLength(1)
  })

  it('aborts the object upload when its final waiter times out', async () => {
    vi.useFakeTimers()
    const file = new File(['video'], 'single-timeout.mp4', { type: 'video/mp4' })
    let uploadSignal: AbortSignal | null | undefined
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/assets') {
        return Promise.resolve(
          jsonResponse({
            asset: { id: 73, name: 'single-timeout.mp4' },
            upload: { url: 'https://storage.example.com/upload/73', form_fields: {} },
          }),
        )
      }
      if (url === 'https://storage.example.com/upload/73') {
        uploadSignal = init?.signal
        return rejectWhenAborted(init?.signal)
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const request = uploadAssetFile({
      workspaceId: 7,
      file,
      uploadTimeoutMs: 50,
    })
    const rejection = expect(request).rejects.toMatchObject({
      name: 'BusinessApiError',
      code: 'ASSET_UPLOAD_TIMEOUT',
      cause: 'timeout',
    })
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input) === 'https://storage.example.com/upload/73'),
      ).toHaveLength(1),
    )
    await vi.advanceTimersByTimeAsync(50)

    await rejection
    expect(uploadSignal?.aborted).toBe(true)
  })

  it('retries an aborted object stage on the same asset without stale cleanup replacing the retry', async () => {
    vi.useFakeTimers()
    const file = new File(['video'], 'retry-timeout.mp4', { type: 'video/mp4' })
    let uploadAttempts = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/assets') {
        return Promise.resolve(
          jsonResponse({
            asset: { id: 75, name: 'retry-timeout.mp4' },
            upload: { url: 'https://storage.example.com/upload/75', form_fields: {} },
          }),
        )
      }
      if (url === 'https://storage.example.com/upload/75') {
        uploadAttempts += 1
        if (uploadAttempts === 1) return rejectWhenAborted(init?.signal)
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/v1/assets/75/complete?workspace_id=7') {
        return Promise.resolve(jsonResponse({ id: 75, status: 'active' }))
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = uploadAssetFile({ workspaceId: 7, file, uploadTimeoutMs: 50 })
    const firstRejection = expect(first).rejects.toMatchObject({
      code: 'ASSET_UPLOAD_TIMEOUT',
      cause: 'timeout',
    })
    await vi.waitFor(() => expect(uploadAttempts).toBe(1))

    vi.advanceTimersByTime(50)
    const retry = uploadAssetFile({ workspaceId: 7, file })

    await firstRejection
    await expect(retry).resolves.toMatchObject({ asset: { id: 75, status: 'active' } })
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/assets')).toHaveLength(1)
    expect(uploadAttempts).toBe(2)
  })

  it('lets one caller abort without cancelling shared completion for another caller', async () => {
    const file = new File(['image'], 'complete.png', { type: 'image/png' })
    const firstController = new AbortController()
    let completeSignal: AbortSignal | null | undefined
    let resolveComplete!: (response: Response) => void
    const completeResponse = new Promise<Response>((resolve) => {
      resolveComplete = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/assets') {
        return Promise.resolve(
          jsonResponse({
            asset: { id: 72, name: 'complete.png' },
            upload: { url: 'https://storage.example.com/upload/72', form_fields: {} },
          }),
        )
      }
      if (url === 'https://storage.example.com/upload/72') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/v1/assets/72/complete?workspace_id=7') {
        completeSignal = init?.signal
        return Promise.race([completeResponse, rejectWhenAborted(init?.signal)])
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const firstCaller = uploadAssetFile({ workspaceId: 7, file, signal: firstController.signal })
    const secondCaller = uploadAssetFile({ workspaceId: 7, file })
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/assets/72/complete?workspace_id=7'),
      ).toHaveLength(1),
    )

    firstController.abort()
    await expect(firstCaller).rejects.toMatchObject({
      name: 'BusinessApiError',
      code: 'ASSET_UPLOAD_ABORTED',
      cause: 'aborted',
      response: expect.objectContaining({ asset_id: 72, upload_succeeded: true }),
    })
    expect(completeSignal?.aborted).toBe(false)

    resolveComplete(jsonResponse({ id: 72, status: 'active' }))
    await expect(secondCaller).resolves.toMatchObject({ asset: { id: 72, status: 'active' } })
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/assets/72/complete?workspace_id=7'),
    ).toHaveLength(1)
  })

  it('aborts completion when its final waiter is cancelled', async () => {
    const file = new File(['image'], 'complete-cancelled.png', { type: 'image/png' })
    const controller = new AbortController()
    let completeSignal: AbortSignal | null | undefined
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/assets') {
        return Promise.resolve(
          jsonResponse({
            asset: { id: 74, name: 'complete-cancelled.png' },
            upload: { url: 'https://storage.example.com/upload/74', form_fields: {} },
          }),
        )
      }
      if (url === 'https://storage.example.com/upload/74') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/v1/assets/74/complete?workspace_id=7') {
        completeSignal = init?.signal
        return rejectWhenAborted(init?.signal)
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const request = uploadAssetFile({ workspaceId: 7, file, signal: controller.signal })
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/assets/74/complete?workspace_id=7'),
      ).toHaveLength(1),
    )
    controller.abort()

    await expect(request).rejects.toMatchObject({
      name: 'BusinessApiError',
      code: 'ASSET_UPLOAD_ABORTED',
      cause: 'aborted',
      response: expect.objectContaining({ asset_id: 74, upload_succeeded: true }),
    })
    expect(completeSignal?.aborted).toBe(true)
  })

  it('retries completion on the same asset without uploading the object again', async () => {
    vi.useFakeTimers()
    const file = new File(['image'], 'image.png', { type: 'image/png' })
    let completeAttempts = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/assets') {
        return Promise.resolve(
          jsonResponse({
            asset: { id: 81, name: 'image.png' },
            upload: { url: 'https://storage.example.com/upload/81', form_fields: {} },
          }),
        )
      }
      if (url === 'https://storage.example.com/upload/81') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/v1/assets/81/complete?workspace_id=7') {
        completeAttempts += 1
        if (completeAttempts <= 3) return Promise.resolve(jsonResponse({ message: 'temporary' }, 503))
        return Promise.resolve(jsonResponse({ id: 81, status: 'active' }))
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const firstAttempt = uploadAssetFile({ workspaceId: 7, file })
    const firstRejection = expect(firstAttempt).rejects.toMatchObject({
      name: 'BusinessApiError',
      code: 'ASSET_COMPLETE_PENDING',
      response: expect.objectContaining({ asset_id: 81, upload_succeeded: true }),
    })
    await vi.runAllTimersAsync()
    await firstRejection

    await expect(uploadAssetFile({ workspaceId: 7, file })).resolves.toMatchObject({
      asset: { id: 81, status: 'active' },
    })

    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/assets')).toHaveLength(1)
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input) === 'https://storage.example.com/upload/81'),
    ).toHaveLength(1)
    expect(completeAttempts).toBe(4)
  })
})
