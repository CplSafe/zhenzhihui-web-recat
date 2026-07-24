import {
  BusinessApiError,
  cancelAiTask,
  createAiResponse,
  createAiTask,
  getAiTask,
  getAiTaskId,
  streamAiResponse,
  waitForAiTask,
} from '@/api/business'
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
  it('reuses one idempotency key when retrying a non-streaming explicit script model', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'provider unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: { output_text: '脚本完成' } }))
    vi.stubGlobal('fetch', fetchMock)

    const request = createAiResponse({
      workspaceId: 7,
      operationCode: 'responses.multimodal',
      modelVersionId: 93,
      prompt: '生成脚本',
    })
    await vi.runAllTimersAsync()

    await expect(request).resolves.toMatchObject({ output_text: '脚本完成' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body || '{}')))
    expect(bodies[0].idempotency_key).toMatch(/^resp_/)
    expect(bodies[1].idempotency_key).toBe(bodies[0].idempotency_key)
    expect(bodies[1]).toEqual(bodies[0])
  })

  it('passes the caller AbortSignal through and cancels a non-streaming explicit script request', async () => {
    const controller = new AbortController()
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal || undefined
          requestSignal?.addEventListener('abort', () => reject(new Error('fetch aborted')), { once: true })
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = createAiResponse({
      workspaceId: 7,
      operationCode: 'responses.multimodal',
      modelVersionId: 93,
      prompt: '生成脚本',
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort()

    await expect(request).rejects.toMatchObject({
      name: 'BusinessApiError',
      cause: 'aborted',
      message: '网络请求已取消',
    })
    expect(requestSignal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('streams with the explicitly selected model without loading or switching model candidates', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response('event: response.output_text.done\ndata: {"text":"脚本完成"}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      streamAiResponse({
        workspaceId: 7,
        operationCode: 'responses.multimodal',
        modelVersionId: 92,
        prompt: '生成脚本',
        params: { max_output_tokens: 100 },
      }),
    ).resolves.toMatchObject({ text: '脚本完成' })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/v1/ai/responses?stream=true')
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body || '{}'))
    expect(body).toMatchObject({
      workspace_id: 7,
      model_version_id: 92,
      operation_code: 'responses.multimodal',
    })
  })

  it.each([
    {
      label: 'non-streaming',
      invoke: (signal: AbortSignal) =>
        createAiResponse({
          workspaceId: 73,
          operationCode: 'responses.multimodal',
          modelPlanCandidates: ['team-pro'],
          prompt: '生成脚本',
          signal,
        }),
    },
    {
      label: 'streaming',
      invoke: (signal: AbortSignal) =>
        streamAiResponse({
          workspaceId: 73,
          operationCode: 'responses.multimodal',
          modelPlanCandidates: ['team-pro'],
          prompt: '生成脚本',
          signal,
        }),
    },
  ])('passes workspace and cancellation through the automatic $label model lookup', async ({ invoke }) => {
    const controller = new AbortController()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const request = invoke(controller.signal)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/api/v1/ai/models?')
    expect(String(url)).toContain('workspace_id=73')
    expect(String(url)).toContain('operation_code=responses.multimodal')
    expect(init?.signal).toBeTruthy()
    controller.abort()

    await expect(request).rejects.toMatchObject({
      name: 'BusinessApiError',
      cause: 'aborted',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('cancels an automatic-model provider retry during backoff without issuing another paid request', async () => {
    const controller = new AbortController()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 94,
              enabled: true,
              operation_codes: ['responses.multimodal'],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ message: 'provider task failed' }, 503))
    vi.stubGlobal('fetch', fetchMock)

    const request = createAiResponse({
      workspaceId: 74,
      operationCode: 'responses.multimodal',
      modelPlanCandidates: ['team-pro'],
      prompt: '生成脚本',
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    controller.abort()

    await expect(request).rejects.toMatchObject({
      name: 'BusinessApiError',
      cause: 'aborted',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('workspace_id=74')
    expect(String(fetchMock.mock.calls[1]![0])).toContain('/api/v1/ai/responses')
  })

  it('reuses one idempotency key when an automatic non-streaming model is retried', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 95,
              enabled: true,
              operation_codes: ['responses.multimodal'],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ message: 'provider task failed' }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: { output_text: '自动模型脚本完成' } }))
    vi.stubGlobal('fetch', fetchMock)

    const request = createAiResponse({
      workspaceId: 75,
      operationCode: 'responses.multimodal',
      modelPlanCandidates: ['team-pro'],
      prompt: '生成脚本',
    })
    await vi.runAllTimersAsync()

    await expect(request).resolves.toMatchObject({ output_text: '自动模型脚本完成' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const responseBodies = fetchMock.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body || '{}')))
    expect(responseBodies[0]).toMatchObject({
      model_version_id: 95,
      idempotency_key: expect.stringMatching(/^resp_/),
    })
    expect(responseBodies[1]).toEqual(responseBodies[0])
  })

  it('does not switch automatic models after an ambiguous provider failure', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 96,
              enabled: true,
              operation_codes: ['responses.multimodal'],
            },
            {
              id: 97,
              enabled: true,
              operation_codes: ['responses.multimodal'],
            },
          ],
        }),
      )
      .mockImplementation(() => Promise.resolve(jsonResponse({ message: 'provider task failed' }, 503)))
    vi.stubGlobal('fetch', fetchMock)

    const request = createAiResponse({
      workspaceId: 76,
      operationCode: 'responses.multimodal',
      modelPlanCandidates: ['team-pro'],
      prompt: '生成脚本',
    })
    const rejection = expect(request).rejects.toMatchObject({
      name: 'BusinessApiError',
      status: 503,
    })
    await vi.runAllTimersAsync()
    await rejection

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const responseBodies = fetchMock.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body || '{}')))
    expect(responseBodies).toHaveLength(3)
    expect(responseBodies.every((body) => body.model_version_id === 96)).toBe(true)
    expect(new Set(responseBodies.map((body) => body.idempotency_key))).toHaveProperty('size', 1)
  })

  it('does not switch automatic models after an ambiguous network failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 98,
              enabled: true,
              operation_codes: ['responses.multimodal'],
            },
            {
              id: 99,
              enabled: true,
              operation_codes: ['responses.multimodal'],
            },
          ],
        }),
      )
      .mockRejectedValueOnce(new TypeError('connection reset after submit'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createAiResponse({
        workspaceId: 77,
        operationCode: 'responses.multimodal',
        modelPlanCandidates: ['team-pro'],
        prompt: '生成脚本',
      }),
    ).rejects.toMatchObject({
      name: 'BusinessApiError',
      status: 0,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const responseBody = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body || '{}'))
    expect(responseBody.model_version_id).toBe(98)
  })

  it('still falls back when the server explicitly rejects the automatic model selection', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 100,
              enabled: true,
              operation_codes: ['responses.multimodal'],
            },
            {
              id: 101,
              enabled: true,
              operation_codes: ['responses.multimodal'],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code_string: 'MODEL_NOT_FOUND',
            message: 'model is no longer available',
          },
          400,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { output_text: '候选模型脚本完成' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createAiResponse({
        workspaceId: 78,
        operationCode: 'responses.multimodal',
        modelPlanCandidates: ['team-pro'],
        prompt: '生成脚本',
      }),
    ).resolves.toMatchObject({ output_text: '候选模型脚本完成' })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const responseBodies = fetchMock.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body || '{}')))
    expect(responseBodies.map((body) => body.model_version_id)).toEqual([100, 101])
  })

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

  it('fails closed on INVALID_MODEL_PARAMS without removing audio or changing the idempotency key', async () => {
    const errorPayload = {
      code: 10001,
      code_string: 'INVALID_MODEL_PARAMS',
      message: '模型参数无效，请检查参数后重试',
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(errorPayload, 400))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createAiTask({
        workspaceId: 7,
        capability: 'video',
        operationCode: 'video.generate',
        modelVersionId: 91,
        modelVersion: { id: 91 },
        idempotencyKey: 'seedance-invalid-params',
        prompt: '生成视频',
        params: {
          duration: 10,
          resolution: '720p',
          ratio: '16:9',
          generate_audio: true,
        },
        inputAssets: [
          { asset_id: 101, role: 'image' },
          { asset_id: 102, role: 'image' },
        ],
      }),
    ).rejects.toMatchObject({
      message: errorPayload.message,
      status: 400,
      code: errorPayload.code,
      response: errorPayload,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body || '{}'))
    expect(body.idempotency_key).toBe('seedance-invalid-params')
    expect(body.input_assets).toEqual([
      { asset_id: 101, role: 'image' },
      { asset_id: 102, role: 'image' },
    ])
    expect(body.params).toEqual({
      duration: 10,
      resolution: '720p',
      ratio: '16:9',
      generate_audio: true,
    })
  })

  it.each([
    ['video.generate', 'image'],
    ['video.edit', 'video'],
    ['video.replicate', 'reference_image'],
  ])('does not drop input assets and retry when %s rejects the %s role', async (operationCode, role) => {
    const errorPayload = {
      code_string: 'INPUT_ASSET_ROLE_NOT_ALLOWED',
      message: `input asset role ${role} is not allowed`,
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(errorPayload, 400))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createAiTask({
        workspaceId: 7,
        capability: 'video',
        operationCode,
        modelVersionId: 91,
        modelVersion: { id: 91 },
        idempotencyKey: `${operationCode}-role-error`,
        prompt: '生成视频',
        params: { duration: 10 },
        inputAssets: [{ asset_id: 101, role }],
      }),
    ).rejects.toMatchObject({
      message: errorPayload.message,
      status: 400,
      code: errorPayload.code_string,
      response: errorPayload,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body || '{}'))
    expect(body.input_assets).toEqual([{ asset_id: 101, role }])
  })

  it('does not resubmit identical video params when INVALID_MODEL_PARAMS cannot be fixed by removing audio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          code: 10001,
          code_string: 'INVALID_MODEL_PARAMS',
          message: '模型参数无效，请检查参数后重试',
        },
        400,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createAiTask({
        workspaceId: 7,
        capability: 'video',
        operationCode: 'video.generate',
        modelVersionId: 91,
        modelVersion: { id: 91 },
        idempotencyKey: 'seedance-invalid-duration',
        prompt: '生成视频',
        params: { duration: 10, ratio: '16:9' },
        inputAssets: [{ asset_id: 101, role: 'image' }],
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 10001,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
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
