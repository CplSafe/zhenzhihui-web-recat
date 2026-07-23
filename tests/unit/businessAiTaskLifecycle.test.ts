import { BusinessApiError, cancelAiTask, createAiTask, getAiTask, getAiTaskId, waitForAiTask } from '@/api/business'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AI task identifier boundaries', () => {
  it('reads id, task_id and taskId aliases while skipping a zero alias', () => {
    expect(getAiTaskId({ id: 11 })).toBe(11)
    expect(getAiTaskId({ task_id: '12' })).toBe(12)
    expect(getAiTaskId({ taskId: 13 })).toBe(13)
    expect(getAiTaskId({ id: 0, task_id: 14 })).toBe(14)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, '1.5', '', null])(
    'rejects the invalid task ID boundary %j',
    (value) => {
      expect(getAiTaskId({ id: value })).toBe(0)
    },
  )

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    'does not issue a cancellation request for invalid task ID %j',
    (taskId) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      expect(() => cancelAiTask({ workspaceId: 7, taskId })).toThrow('任务 ID 无效')
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('sends one POST to the exact task cancellation endpoint', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ data: { id: 23, status: 'cancelled' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(cancelAiTask({ workspaceId: 7, taskId: 23 })).resolves.toMatchObject({
      id: 23,
      status: 'cancelled',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/v1/ai/tasks/23/cancel?workspace_id=7')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST', credentials: 'include' })
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    'does not query an invalid task ID %j',
    async (taskId) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(getAiTask({ workspaceId: 7, taskId })).rejects.toThrow('任务 ID 无效')
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})

describe('paid AI task submission safety', () => {
  it('reuses one generated idempotency key when a transient 5xx response is retried', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'response lost' }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: { task_id: 31, status: 'PROCESSING' } }))
    vi.stubGlobal('fetch', fetchMock)

    const request = createAiTask({
      workspaceId: 7,
      capability: 'video',
      operationCode: 'video.generate',
      modelVersionId: 91,
      modelVersion: { id: 91 },
      prompt: '生成视频',
      params: { duration: 10 },
      inputAssets: [{ asset_id: 101, role: 'image' }],
    })
    await vi.runAllTimersAsync()

    await expect(request).resolves.toMatchObject({ id: 31, status: 'processing' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body || '{}')))
    expect(bodies[0].idempotency_key).toMatch(/^task_/)
    expect(bodies[1].idempotency_key).toBe(bodies[0].idempotency_key)
    expect(bodies[1]).toEqual(bodies[0])
  })

  it.each([
    { id: 0, status: 'processing' },
    { task_id: 0, status: 'processing' },
    { taskId: 0, status: 'processing' },
    { status: 'processing' },
  ])('fails closed when task creation returns no positive task ID: %j', async (payload) => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: payload }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createAiTask({
        workspaceId: 7,
        capability: 'video',
        operationCode: 'video.generate',
        modelVersionId: 91,
        modelVersion: { id: 91 },
        params: {},
        inputAssets: [],
      }),
    ).rejects.toMatchObject({
      name: 'BusinessApiError',
      code: 'INVALID_TASK_ID',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('AI task polling terminal states and recovery', () => {
  it.each([
    ['payment_failed', 'INSUFFICIENT_CREDITS'],
    ['cancelled', 'TASK_CANCELLED'],
    ['expired', 'TASK_CANCELLED'],
  ] as const)('maps %s to the expected business error without another poll', async (status, code) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      waitForAiTask({
        workspaceId: 7,
        task: { id: 41, status },
        intervalMs: 0,
      }),
    ).rejects.toMatchObject({
      name: 'BusinessApiError',
      code,
      response: expect.objectContaining({ id: 41, status }),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('recovers after consecutive transient polling errors and preserves the task ID', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'temporary one' }, 503))
      .mockResolvedValueOnce(jsonResponse({ message: 'temporary two' }, 429))
      .mockResolvedValueOnce(jsonResponse({ data: { taskId: 51, status: 'COMPLETED' } }))
    vi.stubGlobal('fetch', fetchMock)

    const request = waitForAiTask({
      workspaceId: 7,
      task: { task_id: 51, status: 'PROCESSING' },
      intervalMs: 0,
      timeoutMs: 60_000,
    })
    await vi.runAllTimersAsync()

    await expect(request).resolves.toMatchObject({ id: 51, status: 'completed' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.every(([input]) => String(input).includes('/api/v1/ai/tasks/51?workspace_id=7'))).toBe(
      true,
    )
  })

  it('stops after the bounded number of consecutive transient polling errors', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchMock = vi.fn(async () => jsonResponse({ message: 'still unavailable' }, 503))
    vi.stubGlobal('fetch', fetchMock)

    const request = waitForAiTask({
      workspaceId: 7,
      task: { id: 52, status: 'processing' },
      intervalMs: 0,
      timeoutMs: 120_000,
    })
    const rejection = expect(request).rejects.toMatchObject({
      name: 'BusinessApiError',
      message: 'AI 任务状态查询连续失败，请稍后重试',
      status: 503,
      cause: expect.any(BusinessApiError),
    })
    await vi.runAllTimersAsync()
    await rejection
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('aborts deterministically while waiting for the next poll', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const request = waitForAiTask({
      workspaceId: 7,
      task: { id: 61, status: 'processing' },
      intervalMs: 10_000,
      signal: controller.signal,
    })
    controller.abort()

    await expect(request).rejects.toMatchObject({
      name: 'BusinessApiError',
      cause: 'aborted',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects task ID zero before polling or returning a misleading result', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      waitForAiTask({ workspaceId: 7, task: { id: 0, status: 'processing' }, intervalMs: 0 }),
    ).rejects.toBeInstanceOf(BusinessApiError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
