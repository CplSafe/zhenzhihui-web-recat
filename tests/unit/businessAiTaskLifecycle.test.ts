import {
  BusinessApiError,
  cancelAiTask,
  createAiResponse,
  createAiTask,
  estimateAiTaskCost,
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
  it.each(['image', 'video'])(
    'keeps %s upscale estimation and submission valid with an empty saved prompt',
    async (kind) => {
      const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
        String(url).includes('estimate-cost')
          ? jsonResponse({ data: { estimated_cost: 10, balance: 100, can_afford: true } })
          : jsonResponse({ data: { id: 55, status: 'pending' } }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const request = {
        workspaceId: 11,
        modelVersionId: 47,
        operationCode: `${kind}.upscale`,
        prompt: '',
        params: { scale: 2 },
        inputAssets: [{ asset_id: 99, role: kind }],
      }
      await estimateAiTaskCost(request)
      await createAiTask({ ...request, capability: kind, modelVersion: { id: 47 } })
      const [estimate, submitted] = fetchMock.mock.calls.map((call) =>
        JSON.parse(String((call as unknown as [unknown, RequestInit])[1].body)),
      )
      expect(estimate.prompt.trim()).not.toBe('')
      expect(submitted).toMatchObject(estimate)
    },
  )
  it('submits video upscale without requiring a generation description', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 55, status: 'pending' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      createAiTask({
        workspaceId: 11,
        capability: 'video',
        operationCode: 'video.upscale',
        modelVersionId: 47,
        modelVersion: { id: 47 },
        prompt: '',
        params: { resolution: '2k' },
        inputAssets: [{ asset_id: 99, role: 'video' }],
      }),
    ).resolves.toMatchObject({ id: 55 })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.prompt).toContain('参考视频')
    expect(body.input_assets).toEqual([{ asset_id: 99, role: 'video' }])
  })
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
    async (taskId) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(cancelAiTask({ workspaceId: 7, taskId })).rejects.toThrow('任务 ID 无效')
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
  it.each(['', '   ', undefined])(
    'fills an empty tool prompt at the HTTP boundary for estimation and saved-task retries: %j',
    async (prompt) => {
      const bodies: Record<string, unknown>[] = []
      const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body))
        bodies.push(body)
        if (!String(body.prompt || '').trim())
          return jsonResponse({ code: 10001, message: '请求体格式不合法，请检查 JSON 结构' }, 400)
        return String(url).includes('estimate-cost')
          ? jsonResponse({ data: { estimated_cost: 10, balance: 100, can_afford: true } })
          : jsonResponse({ data: { id: 901, status: 'queued' } }, 201)
      })
      vi.stubGlobal('fetch', fetchMock)
      const params = { tool: 'image.relight', tool_version: 1, tool_params: { mode: 'manual', brightness: 65 } }
      const inputAssets = [{ asset_id: 501, role: 'reference_image' }]
      await estimateAiTaskCost({
        workspaceId: 7,
        modelVersionId: 42,
        operationCode: 'image.image_to_image',
        prompt,
        params,
        inputAssets,
      })
      await expect(
        createAiTask({
          workspaceId: 7,
          capability: 'image',
          modelVersionId: 42,
          modelVersion: { id: 42 },
          operationCode: 'image.image_to_image',
          idempotencyKey: 'old-canvas-tool-key',
          prompt,
          params,
          inputAssets,
        }),
      ).resolves.toMatchObject({ id: 901 })
      expect(bodies).toHaveLength(2)
      expect(bodies[0]).toMatchObject({ prompt: '请按工具参数处理参考图片。', params, input_assets: inputAssets })
      expect(bodies[1]).toMatchObject({ ...bodies[0], idempotency_key: 'old-canvas-tool-key' })
    },
  )
  it('waits for a slow image response body without aborting or creating another paid request at two minutes', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null | undefined
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal
      return new Response(
        new ReadableStream({
          start(controller) {
            const timer = setTimeout(() => {
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ data: { id: 15320, status: 'succeeded' } })))
              controller.close()
            }, 150_000)
            signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                controller.error(new DOMException('aborted', 'AbortError'))
              },
              { once: true },
            )
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const request = createAiTask({
      workspaceId: 7,
      capability: 'image',
      operationCode: 'image.text_to_image',
      modelVersionId: 27,
      modelVersion: { id: 27 },
      prompt: 'Slow image',
      inputAssets: [],
    })
    const completed = expect(request).resolves.toMatchObject({ id: 15320, status: 'succeeded' })
    await vi.advanceTimersByTimeAsync(120_001)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(30_000)
    await completed
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps input_assets as an empty array when no reference image is selected', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { task_id: 30, status: 'pending' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createAiTask({
        workspaceId: 7,
        capability: 'video',
        operationCode: 'video.generate',
        modelVersionId: 91,
        modelVersion: { id: 91 },
        prompt: '生成视频',
        params: { duration: 5 },
        inputAssets: [],
      }),
    ).resolves.toMatchObject({ id: 30, status: 'pending' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    const body = JSON.parse(String(requestInit?.body || '{}'))
    expect(body).toHaveProperty('input_assets')
    expect(body.input_assets).toEqual([])
  })

  it('rejects a video request with no description before any paid task submission', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createAiTask({
        workspaceId: 11,
        capability: 'video',
        operationCode: 'video.generate',
        modelVersionId: 25,
        modelVersion: { id: 25 },
        prompt: '',
        params: { duration: 5, resolution: '768P', ratio: '16:9' },
        inputAssets: [
          { asset_id: 13303, role: 'audio' },
          { asset_id: 13203, role: 'image' },
        ],
      }),
    ).rejects.toThrow('请输入视频描述后再生成')
    expect(fetchMock).not.toHaveBeenCalled()
  })

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

  it('reuses the caller idempotency key for a canvas storyboard response', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ data: { output_text: '[{"title":"开场","prompt":"篮球入网"}]' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createAiResponse({
        workspaceId: 7,
        operationCode: 'responses.multimodal',
        modelVersionId: 93,
        idempotencyKey: 'canvas-storyboard-test',
        prompt: '生成分镜',
      }),
    ).resolves.toMatchObject({ output_text: '[{"title":"开场","prompt":"篮球入网"}]' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    const body = JSON.parse(String(init.body || '{}'))
    expect(String(url)).toContain('/api/v1/ai/responses')
    expect(body).toMatchObject({
      workspace_id: 7,
      operation_code: 'responses.multimodal',
      model_version_id: 93,
      idempotency_key: 'canvas-storyboard-test',
    })
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
        prompt: '生成一段视频',
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

  it('waits at least as long as the backend poll_after_ms asks for', async () => {
    // 后端用 poll_after_ms 声明「至少隔这么久再来问」，拥堵时会调大它做退避。
    // 之前这个字段被完全忽略，前端始终按自己的固定间隔轮询，把「请求过于频繁」打了回来。
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 61, status: 'PROCESSING', poll_after_ms: 30_000 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 61, status: 'COMPLETED' } }))
    vi.stubGlobal('fetch', fetchMock)

    const request = waitForAiTask({
      workspaceId: 7,
      task: { id: 61, status: 'PROCESSING', poll_after_ms: 30_000 },
      intervalMs: 4000,
      timeoutMs: 10 * 60_000,
    })

    // 基础间隔到点时不能就去查——后端要求的是 30 秒。
    await vi.advanceTimersByTimeAsync(4000)
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(26_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.runAllTimersAsync()
    await expect(request).resolves.toMatchObject({ id: 61, status: 'completed' })
  })

  it('keeps the caller interval when poll_after_ms is absent, shorter or invalid', async () => {
    // poll_after_ms 是下限而不是替代值：它比基础间隔短（线上海螺就是 2000）时不该提高轮询频率。
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 62, status: 'PROCESSING', poll_after_ms: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 62, status: 'COMPLETED' } }))
    vi.stubGlobal('fetch', fetchMock)

    const request = waitForAiTask({
      workspaceId: 7,
      task: { id: 62, status: 'PROCESSING', poll_after_ms: 2000 },
      intervalMs: 4000,
      timeoutMs: 10 * 60_000,
    })

    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).not.toHaveBeenCalled()

    // poll_after_ms=0 同样不会退化成空转轮询，仍按基础间隔等待。
    await vi.advanceTimersByTimeAsync(2001)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3999)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.runAllTimersAsync()
    await expect(request).resolves.toMatchObject({ id: 62, status: 'completed' })
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

describe('image generation streaming', () => {
  it('forwards previews and returns the settled task using the image task endpoint', async () => {
    const preview = { b64_json: 'cHJldmlldw==', output_format: 'png', partial_image_index: 0 }
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          `event: image.partial\ndata: ${JSON.stringify(preview)}\n\nevent: image.completed\ndata: {"id":321,"status":"succeeded"}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onImagePartial = vi.fn()
    const result = await createAiTask({
      workspaceId: 7,
      capability: 'image',
      operationCode: 'image.text_to_image',
      modelVersionId: 92,
      prompt: 'draw',
      params: { stream: true },
      onImagePartial,
    })
    expect(result).toMatchObject({ id: 321, status: 'succeeded' })
    expect(onImagePartial).toHaveBeenCalledWith(preview)
    const imageRequest = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/v1/ai/tasks?stream=true'))!
    expect(imageRequest).toBeDefined()
    expect(JSON.parse(String(imageRequest[1]?.body))).toMatchObject({
      model_version_id: 92,
      workspace_id: 7,
      params: { stream: true },
    })
  })

  it.each([
    'event: image.partial\ndata: {"b64_json":"preview"}\n\n',
    'event: image.error\ndata: {"message":"生成失败","code_string":"INVALID_PARAMS"}\n\n',
  ])('rejects failed or truncated image streams', async (events) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(events, { headers: { 'Content-Type': 'text/event-stream' } })),
    )
    await expect(
      createAiTask({
        workspaceId: 7,
        capability: 'image',
        operationCode: 'image.text_to_image',
        modelVersionId: 92,
        prompt: 'draw',
        params: { stream: true },
      }),
    ).rejects.toThrow()
  })
})
