import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelAiTask: vi.fn(),
  buildStoryboardImageParams: vi.fn(),
  createAiTask: vi.fn(),
  estimateAiTaskCost: vi.fn(),
  extractTaskMediaUrls: vi.fn(),
  extractOutputAssetId: vi.fn(),
  findAssetIdByTaskId: vi.fn(),
  getAssetDownloadUrl: vi.fn(),
  getModelParamFields: vi.fn(),
  resolveGeneratedMediaUrls: vi.fn(),
  resolveTaskModel: vi.fn(),
  uploadAssetFile: vi.fn(),
  waitForAiTask: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  cancelAiTask: mocks.cancelAiTask,
  createAiTask: mocks.createAiTask,
  estimateAiTaskCost: mocks.estimateAiTaskCost,
  extractTaskMediaUrls: mocks.extractTaskMediaUrls,
  getAiTaskId: (task: Record<string, unknown> | null | undefined) => {
    const id = Number(task?.id ?? task?.task_id ?? task?.taskId ?? 0)
    return Number.isSafeInteger(id) && id > 0 ? id : 0
  },
  getAssetDownloadUrl: mocks.getAssetDownloadUrl,
  isAbortedTaskError: (error: { cause?: unknown } | null | undefined) => error?.cause === 'aborted',
  normalizeAiTaskStatus: (status: unknown) => {
    const value = String(status || '')
      .trim()
      .toLowerCase()
    return value === 'canceled' ? 'cancelled' : value
  },
  resolveTaskModel: mocks.resolveTaskModel,
  uploadAssetFile: mocks.uploadAssetFile,
  waitForAiTask: mocks.waitForAiTask,
}))

vi.mock('@/utils/taskMedia', () => ({
  extractOutputAssetId: mocks.extractOutputAssetId,
  findAssetIdByTaskId: mocks.findAssetIdByTaskId,
  resolveGeneratedMediaUrls: mocks.resolveGeneratedMediaUrls,
}))

vi.mock('@/utils/storyboardTasks', () => ({
  buildStoryboardImageParams: mocks.buildStoryboardImageParams,
}))

vi.mock('@/utils/modelSchema', () => ({
  getModelParamFields: mocks.getModelParamFields,
  getModelParamFieldNames: (field: Record<string, unknown>) => [
    String(field.name || ''),
    ...((field.aliases as unknown[]) || []).map(String),
  ],
  getModelParamOptionValues: (field: Record<string, unknown>) => (Array.isArray(field.options) ? field.options : []),
  normalizeModelParamName: (value: unknown) =>
    String(value || '')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase(),
}))

import {
  compileShotImageRequestParams,
  ensureAssetId,
  estimateShotImageCost,
  generateShotImage,
  isTerminalShotImageTaskError,
  persistImageAsset,
  refreshAssetUrl,
  resumeShotImageGeneration,
} from '@/api/smartShotImage'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function imageResponse(type = 'image/png') {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    blob: async () => new Blob(['image'], { type }),
  }
}

function resetMocks() {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.buildStoryboardImageParams.mockImplementation((_model, ratio) => ({ ratio, count: 1 }))
  mocks.cancelAiTask.mockResolvedValue(undefined)
  mocks.extractOutputAssetId.mockReturnValue(901)
  mocks.extractTaskMediaUrls.mockReturnValue([])
  mocks.findAssetIdByTaskId.mockResolvedValue(0)
  mocks.getAssetDownloadUrl.mockResolvedValue('https://cdn.example.com/shot.png')
  mocks.getModelParamFields.mockReturnValue([])
  mocks.resolveGeneratedMediaUrls.mockResolvedValue([])
}

function generatedOutputSafetyError(overrides: Record<string, unknown> = {}) {
  return {
    status: 502,
    code: 10502,
    message: '生成内容未通过安全审核，请调整描述或更换参考图后重试。',
    response: {
      code: 10502,
      code_string: 'PROVIDER_FAILED',
      message: '生成内容未通过安全审核，请调整描述或更换参考图后重试。',
      data: {
        id: 3207,
        status: 'failed',
        outputs: [],
        estimated_cost: 5,
        actual_cost: 0,
        ...overrides,
      },
    },
  }
}

function generatedOutputSafetyErrorWithoutActualCost() {
  const error = generatedOutputSafetyError()
  delete (error.response.data as Partial<{ actual_cost: number }>).actual_cost
  return error
}

describe('isTerminalShotImageTaskError', () => {
  it.each([
    {
      label: 'failed status nested under response data task',
      error: { response: { data: { task: { id: 3207, status: 'FAILED' } } } },
    },
    {
      label: 'cancelled status nested under response task',
      error: { response: { task: { id: 3208, status: 'CANCELED' } } },
    },
  ])('recognizes $label as terminal', ({ error }) => {
    expect(isTerminalShotImageTaskError(error)).toBe(true)
  })

  it.each([
    { label: 'HTTP 503 without a terminal task status', error: { status: 503, message: 'upstream unavailable' } },
    { label: 'network timeout', error: { code: 'ETIMEDOUT', message: 'task query timeout' } },
    {
      label: 'nested processing task',
      error: { response: { data: { task: { id: 3209, status: 'processing' } } } },
    },
  ])('does not treat $label as terminal', ({ error }) => {
    expect(isTerminalShotImageTaskError(error)).toBe(false)
  })
})

describe('generateShotImage task lifecycle', () => {
  beforeEach(() => {
    vi.useRealTimers()
    resetMocks()
  })

  it('rejects an explicit image model before task creation when reference-image limits are exceeded', async () => {
    const selectedModel = {
      id: 620,
      display_name: '单参考图模型',
      params_schema: {
        fields: [{ name: 'reference_images', type: 'array', minItems: 1, maxItems: 1 }],
      },
    }
    mocks.getModelParamFields.mockReturnValue(selectedModel.params_schema.fields)

    await expect(
      generateShotImage({
        workspaceId: 7,
        prompt: 'shot',
        refAssetIds: [11, 12],
        modelVersionId: selectedModel.id,
        modelVersion: selectedModel,
      }),
    ).rejects.toThrow('单参考图模型 与当前生成参数不兼容：当前参考图数量 2 不符合1–1 张')

    expect(mocks.createAiTask).not.toHaveBeenCalled()
  })

  it('reuses one idempotency key while retrying task submission', async () => {
    vi.useFakeTimers()
    mocks.createAiTask
      .mockRejectedValueOnce({ status: 503, message: 'upstream unavailable' })
      .mockResolvedValueOnce({ task_id: 41, status: 'PROCESSING' })
    mocks.waitForAiTask.mockResolvedValue({ taskId: 41, status: 'COMPLETED' })

    const onTask = vi.fn()
    const request = generateShotImage({
      workspaceId: 7,
      prompt: 'shot',
      idempotencyKey: 'shot-action-1',
      onTask,
    })
    await vi.runAllTimersAsync()

    await expect(request).resolves.toEqual({
      url: 'https://cdn.example.com/shot.png',
      assetId: 901,
    })
    expect(mocks.createAiTask).toHaveBeenCalledTimes(2)
    expect(mocks.createAiTask.mock.calls[0]?.[0]?.idempotencyKey).toBe('shot-action-1_text_to_image')
    expect(mocks.createAiTask.mock.calls[1]?.[0]?.idempotencyKey).toBe('shot-action-1_text_to_image')
    expect(onTask).toHaveBeenCalledWith(41)
  })

  it.each([
    {
      label: 'text-to-image',
      refAssetIds: undefined,
      operationCode: 'image.text_to_image',
      firstKey: 'shot-output-review-text_text_to_image',
    },
    {
      label: 'image-to-image',
      refAssetIds: [11, 12],
      operationCode: 'image.image_to_image',
      firstKey: 'shot-output-review-image_image_to_image',
    },
  ])('resamples $label once after an explicitly unbilled output-review rejection', async (testCase) => {
    mocks.createAiTask
      .mockRejectedValueOnce(generatedOutputSafetyError())
      .mockResolvedValueOnce({ id: 3208, status: 'processing' })
    mocks.waitForAiTask.mockResolvedValue({ id: 3208, status: 'completed' })

    await expect(
      generateShotImage({
        workspaceId: 7,
        prompt: '足球',
        refAssetIds: testCase.refAssetIds,
        idempotencyKey: `shot-output-review-${testCase.label === 'text-to-image' ? 'text' : 'image'}`,
        allowTextToImageFallback: false,
      }),
    ).resolves.toMatchObject({ assetId: 901 })

    expect(mocks.createAiTask).toHaveBeenCalledTimes(2)
    expect(mocks.createAiTask.mock.calls.map(([args]) => args.operationCode)).toEqual([
      testCase.operationCode,
      testCase.operationCode,
    ])
    expect(mocks.createAiTask.mock.calls.map(([args]) => args.idempotencyKey)).toEqual([
      testCase.firstKey,
      `${testCase.firstKey}_output_safety_retry`,
    ])
    expect(mocks.createAiTask.mock.calls[1]?.[0]).toMatchObject({
      prompt: '足球',
    })
    expect(mocks.createAiTask.mock.calls[1]?.[0]?.inputAssets).toEqual(
      (testCase.refAssetIds || []).map((assetId) => ({ asset_id: assetId, role: 'reference_image' })),
    )
  })

  it.each([
    {
      label: 'input content was rejected',
      error: {
        ...generatedOutputSafetyError(),
        message: '输入内容未通过安全审核，请调整描述后重试。',
        response: {
          ...generatedOutputSafetyError().response,
          message: '输入内容未通过安全审核，请调整描述后重试。',
        },
      },
    },
    {
      label: 'the failed task has already been charged',
      error: generatedOutputSafetyError({ actual_cost: 5 }),
    },
    {
      label: 'the backend omitted the settlement result',
      error: generatedOutputSafetyErrorWithoutActualCost(),
    },
    {
      label: 'the backend returned a nullable settlement result',
      error: generatedOutputSafetyError({ actual_cost: null }),
    },
    {
      label: 'the backend returned a string settlement result',
      error: generatedOutputSafetyError({ actual_cost: '0' }),
    },
    {
      label: 'the failed task has a fractional charge',
      error: generatedOutputSafetyError({ actual_cost: 0.01 }),
    },
    {
      label: 'the failed task still contains an output',
      error: generatedOutputSafetyError({ outputs: [{ asset_id: 99 }] }),
    },
    {
      label: 'the backend omitted outputs',
      error: generatedOutputSafetyError({ outputs: undefined }),
    },
    {
      label: 'the task is not terminally failed',
      error: generatedOutputSafetyError({ status: 'processing' }),
    },
    {
      label: 'the HTTP response is not the documented provider 502',
      error: { ...generatedOutputSafetyError(), status: 500 },
    },
    {
      label: 'the provider machine code is absent',
      error: {
        ...generatedOutputSafetyError(),
        code: 'INTERNAL_ERROR',
        response: {
          ...generatedOutputSafetyError().response,
          code: 50008,
          code_string: 'INTERNAL_ERROR',
        },
      },
    },
  ])('does not automatically resample when $label', async ({ error }) => {
    mocks.createAiTask.mockRejectedValue(error)

    await expect(
      generateShotImage({
        workspaceId: 7,
        prompt: 'shot',
        idempotencyKey: 'shot-output-review-blocked',
      }),
    ).rejects.toMatchObject({ status: error.status })

    expect(mocks.createAiTask).toHaveBeenCalledOnce()
  })

  it('stops after one output-safety resample when the second candidate is also rejected', async () => {
    mocks.createAiTask.mockRejectedValue(generatedOutputSafetyError())

    await expect(
      generateShotImage({
        workspaceId: 7,
        prompt: '足球',
        idempotencyKey: 'shot-output-review-bounded',
      }),
    ).rejects.toMatchObject({ status: 502 })

    expect(mocks.createAiTask).toHaveBeenCalledTimes(2)
    expect(mocks.createAiTask.mock.calls.map(([args]) => args.idempotencyKey)).toEqual([
      'shot-output-review-bounded_text_to_image',
      'shot-output-review-bounded_text_to_image_output_safety_retry',
    ])
  })

  it('reuses the resample idempotency key when that submission has a transient network failure', async () => {
    vi.useFakeTimers()
    mocks.createAiTask
      .mockRejectedValueOnce(generatedOutputSafetyError())
      .mockRejectedValueOnce({ status: 503, message: 'upstream unavailable' })
      .mockResolvedValueOnce({ id: 3210, status: 'processing' })
    mocks.waitForAiTask.mockResolvedValue({ id: 3210, status: 'completed' })

    const request = generateShotImage({
      workspaceId: 7,
      prompt: '足球',
      idempotencyKey: 'shot-output-review-network',
    })
    await vi.runAllTimersAsync()

    await expect(request).resolves.toMatchObject({ assetId: 901 })
    expect(mocks.createAiTask.mock.calls.map(([args]) => args.idempotencyKey)).toEqual([
      'shot-output-review-network_text_to_image',
      'shot-output-review-network_text_to_image_output_safety_retry',
      'shot-output-review-network_text_to_image_output_safety_retry',
    ])
    expect(new Set(mocks.createAiTask.mock.calls.map(([args]) => args.idempotencyKey)).size).toBe(2)
  })

  it('replaces the persisted task ID when a created task fails output review before the resample succeeds', async () => {
    mocks.createAiTask
      .mockResolvedValueOnce({ id: 3211, status: 'processing' })
      .mockResolvedValueOnce({ id: 3212, status: 'processing' })
    mocks.waitForAiTask
      .mockRejectedValueOnce(generatedOutputSafetyError({ id: 3211 }))
      .mockResolvedValueOnce({ id: 3212, status: 'completed' })
    const onTask = vi.fn()

    await expect(
      generateShotImage({
        workspaceId: 7,
        prompt: '足球',
        idempotencyKey: 'shot-output-review-task-replace',
        onTask,
      }),
    ).resolves.toMatchObject({ assetId: 901 })

    expect(onTask.mock.calls.map(([taskId]) => taskId)).toEqual([3211, 3212])
  })

  it('shares one output-safety resample budget across image-to-image fallback', async () => {
    mocks.createAiTask
      .mockRejectedValueOnce(generatedOutputSafetyError())
      .mockRejectedValueOnce({
        status: 422,
        code: 'UNSUPPORTED_OPERATION',
        message: 'image.image_to_image is not supported',
      })
      .mockRejectedValueOnce(generatedOutputSafetyError())

    await expect(
      generateShotImage({
        workspaceId: 7,
        prompt: '足球',
        refAssetIds: [11],
        idempotencyKey: 'shot-output-review-shared-budget',
      }),
    ).rejects.toMatchObject({ status: 502 })

    expect(mocks.createAiTask.mock.calls.map(([args]) => args.idempotencyKey)).toEqual([
      'shot-output-review-shared-budget_image_to_image',
      'shot-output-review-shared-budget_image_to_image_output_safety_retry',
      'shot-output-review-shared-budget_text_to_image_fallback',
    ])
  })

  it('does not submit another task when cancellation happens during retry backoff', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    mocks.createAiTask.mockRejectedValue({ status: 503, message: 'upstream unavailable' })

    const request = generateShotImage({
      workspaceId: 7,
      prompt: 'shot',
      idempotencyKey: 'shot-action-cancelled',
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(mocks.createAiTask).toHaveBeenCalledOnce())

    controller.abort()
    await expect(request).rejects.toMatchObject({
      code: 'TASK_CANCELLED',
      cause: 'aborted',
    })
    await vi.runAllTimersAsync()
    expect(mocks.createAiTask).toHaveBeenCalledOnce()
  })

  it('retries polling the existing task without submitting another task', async () => {
    vi.useFakeTimers()
    mocks.createAiTask.mockResolvedValue({ id: 52, status: 'processing' })
    mocks.waitForAiTask
      .mockRejectedValueOnce({ status: 503, message: 'task query unavailable' })
      .mockResolvedValueOnce({ task_id: 52, status: 'succeeded' })

    const request = generateShotImage({
      workspaceId: 7,
      prompt: 'shot',
      idempotencyKey: 'shot-action-2',
    })
    await vi.runAllTimersAsync()
    await expect(request).resolves.toMatchObject({ assetId: 901 })

    expect(mocks.createAiTask).toHaveBeenCalledOnce()
    expect(mocks.waitForAiTask).toHaveBeenCalledTimes(2)
    expect(mocks.waitForAiTask.mock.calls[1]?.[0]?.task).toMatchObject({ id: 52 })
  })

  it('falls back to text-to-image only for an explicit unsupported-operation response', async () => {
    mocks.createAiTask.mockImplementation(async ({ operationCode }: { operationCode: string }) => {
      if (operationCode === 'image.image_to_image') {
        throw {
          status: 422,
          code: 'UNSUPPORTED_OPERATION',
          message: 'image.image_to_image is not supported',
        }
      }
      return { taskId: 63, status: 'processing' }
    })
    mocks.waitForAiTask.mockResolvedValue({ id: 63, status: 'completed' })

    await expect(
      generateShotImage({
        workspaceId: 7,
        prompt: 'shot',
        refAssetIds: [11],
        idempotencyKey: 'shot-action-3',
      }),
    ).resolves.toMatchObject({ assetId: 901 })

    expect(mocks.createAiTask.mock.calls.map(([args]) => args.operationCode)).toEqual([
      'image.image_to_image',
      'image.text_to_image',
    ])
    expect(mocks.createAiTask.mock.calls.map(([args]) => args.idempotencyKey)).toEqual([
      'shot-action-3_image_to_image',
      'shot-action-3_text_to_image_fallback',
    ])
  })

  it('does not change the confirmed operation when fallback is disabled', async () => {
    mocks.createAiTask.mockRejectedValue({
      status: 422,
      code: 'UNSUPPORTED_OPERATION',
      message: 'image.image_to_image is not supported',
    })

    await expect(
      generateShotImage({
        workspaceId: 7,
        prompt: 'shot',
        refAssetIds: [11],
        idempotencyKey: 'shot-action-strict-operation',
        allowTextToImageFallback: false,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })

    expect(mocks.createAiTask).toHaveBeenCalledOnce()
    expect(mocks.createAiTask).toHaveBeenCalledWith(expect.objectContaining({ operationCode: 'image.image_to_image' }))
  })

  it('does not switch operation or model after an explicitly selected image-to-image model fails', async () => {
    const selectedModel = {
      id: 611,
      display_name: '后端图生图模型',
      operation_codes: ['image.image_to_image'],
    }
    mocks.createAiTask.mockRejectedValue({
      status: 422,
      code: 'UNSUPPORTED_OPERATION',
      message: 'image.image_to_image is not supported',
    })

    await expect(
      generateShotImage({
        workspaceId: 7,
        prompt: 'shot',
        refAssetIds: [11],
        modelVersionId: selectedModel.id,
        modelVersion: selectedModel,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })

    expect(mocks.createAiTask).toHaveBeenCalledOnce()
    expect(mocks.createAiTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operationCode: 'image.image_to_image',
        modelVersionId: 611,
        modelVersion: selectedModel,
      }),
    )
    expect(mocks.resolveTaskModel).not.toHaveBeenCalled()
  })

  it.each(['model_version_id', 'modelVersionId', 'id'])(
    'preserves the full explicit image model schema and canonicalizes the %s alias',
    async (idField) => {
      const selectedModel = {
        [idField]: '613',
        display_name: '后端图片模型',
        operation_codes: ['image.text_to_image'],
        params_schema: { fields: [{ name: 'watermark' }] },
      }
      mocks.createAiTask.mockResolvedValue({ task_id: 89, status: 'processing' })
      mocks.waitForAiTask.mockResolvedValue({ task_id: 89, status: 'completed' })

      await generateShotImage({
        workspaceId: 7,
        prompt: 'shot',
        modelVersion: selectedModel,
      })

      expect(mocks.createAiTask).toHaveBeenCalledWith(
        expect.objectContaining({
          modelVersionId: 613,
          modelVersion: {
            ...selectedModel,
            id: 613,
          },
        }),
      )
      expect(mocks.resolveTaskModel).not.toHaveBeenCalled()
    },
  )

  it('uses canonical model_version_id before modelVersionId and id for image submission', async () => {
    const selectedModel = {
      model_version_id: '614',
      modelVersionId: '615',
      id: 616,
      display_name: '后端图片模型',
      operation_codes: ['image.text_to_image'],
      params_schema: { fields: [{ name: 'watermark' }] },
    }
    mocks.createAiTask.mockResolvedValue({ task_id: 90, status: 'processing' })
    mocks.waitForAiTask.mockResolvedValue({ task_id: 90, status: 'completed' })

    await generateShotImage({
      workspaceId: 7,
      prompt: 'shot',
      modelVersion: selectedModel,
    })

    expect(mocks.createAiTask).toHaveBeenCalledWith(
      expect.objectContaining({
        modelVersionId: 614,
        modelVersion: {
          ...selectedModel,
          id: 614,
        },
      }),
    )
    expect(mocks.resolveTaskModel).not.toHaveBeenCalled()
  })

  it('does not create a fallback task after a terminal provider failure', async () => {
    mocks.createAiTask.mockResolvedValue({ id: 74, status: 'processing' })
    mocks.waitForAiTask.mockRejectedValue({
      message: 'provider task failed',
      response: { id: 74, status: 'FAILED' },
    })

    await expect(
      generateShotImage({
        workspaceId: 7,
        prompt: 'shot',
        refAssetIds: [11],
        idempotencyKey: 'shot-action-4',
      }),
    ).rejects.toMatchObject({ message: 'provider task failed' })

    expect(mocks.createAiTask).toHaveBeenCalledOnce()
    expect(mocks.createAiTask).toHaveBeenCalledWith(expect.objectContaining({ operationCode: 'image.image_to_image' }))
  })
})

describe('resumeShotImageGeneration', () => {
  beforeEach(() => {
    vi.useRealTimers()
    resetMocks()
  })

  it('resumes and resolves one existing task without submitting a new paid task', async () => {
    const controller = new AbortController()
    mocks.waitForAiTask.mockResolvedValue({ taskId: 81, status: 'COMPLETED' })

    await expect(
      resumeShotImageGeneration({
        workspaceId: 7,
        taskId: 81,
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      url: 'https://cdn.example.com/shot.png',
      assetId: 901,
    })

    expect(mocks.createAiTask).not.toHaveBeenCalled()
    expect(mocks.waitForAiTask).toHaveBeenCalledOnce()
    expect(mocks.waitForAiTask).toHaveBeenCalledWith({
      workspaceId: 7,
      task: { id: 81, status: 'processing' },
      timeoutMs: 30 * 60 * 1000,
      signal: controller.signal,
    })
  })

  it('never creates a replacement task while resuming an output-review failure', async () => {
    mocks.waitForAiTask.mockRejectedValue(generatedOutputSafetyError({ id: 81 }))

    await expect(resumeShotImageGeneration({ workspaceId: 7, taskId: 81 })).rejects.toMatchObject({ status: 502 })

    expect(mocks.createAiTask).not.toHaveBeenCalled()
    expect(mocks.waitForAiTask).toHaveBeenCalledOnce()
  })

  it('keeps every polling retry on the same task ID and never falls back to task creation', async () => {
    vi.useFakeTimers()
    mocks.waitForAiTask
      .mockRejectedValueOnce({ status: 503, message: 'task query unavailable' })
      .mockResolvedValueOnce({ task_id: 82, status: 'succeeded' })

    const request = resumeShotImageGeneration({ workspaceId: 7, taskId: 82 })
    await vi.runAllTimersAsync()
    await expect(request).resolves.toMatchObject({ assetId: 901 })

    expect(mocks.createAiTask).not.toHaveBeenCalled()
    expect(mocks.waitForAiTask).toHaveBeenCalledTimes(2)
    expect(mocks.waitForAiTask.mock.calls.map(([args]) => args.task)).toEqual([
      { id: 82, status: 'processing' },
      { id: 82, status: 'processing' },
    ])
  })

  it('uses the persisted task ID to find a delayed output asset', async () => {
    mocks.extractOutputAssetId.mockReturnValue(0)
    mocks.findAssetIdByTaskId.mockResolvedValue(93)
    mocks.getAssetDownloadUrl.mockResolvedValue('https://cdn.example.com/recovered.png')
    mocks.waitForAiTask.mockResolvedValue({ status: 'completed' })

    await expect(resumeShotImageGeneration({ workspaceId: 11, taskId: 83 })).resolves.toEqual({
      url: 'https://cdn.example.com/recovered.png',
      assetId: 93,
    })

    expect(mocks.findAssetIdByTaskId).toHaveBeenCalledWith(11, 83, 'image')
    expect(mocks.createAiTask).not.toHaveBeenCalled()
  })

  it('aborts only the local recovery wait so the backend task remains resumable', async () => {
    const controller = new AbortController()
    mocks.waitForAiTask.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject({ cause: 'aborted' }), { once: true })
        }),
    )

    const request = resumeShotImageGeneration({ workspaceId: 7, taskId: 84, signal: controller.signal })
    await vi.waitFor(() => expect(mocks.waitForAiTask).toHaveBeenCalledOnce())
    controller.abort()

    await expect(request).rejects.toMatchObject({
      code: 'TASK_CANCELLED',
      cause: 'aborted',
    })
    expect(mocks.cancelAiTask).not.toHaveBeenCalled()
    expect(mocks.createAiTask).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid task ID %s before any API request', async (taskId) => {
    await expect(resumeShotImageGeneration({ workspaceId: 7, taskId })).rejects.toThrow('分镜图生成任务 ID 无效')
    expect(mocks.waitForAiTask).not.toHaveBeenCalled()
    expect(mocks.createAiTask).not.toHaveBeenCalled()
  })
})

describe('smart shot image asset persistence', () => {
  beforeEach(() => {
    vi.useRealTimers()
    resetMocks()
  })

  it('short-circuits empty URLs and valid cache hits without network or upload work', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const cache = { 'blob:cached': 23 }

    await expect(ensureAssetId(7, '', cache)).resolves.toBe(0)
    await expect(ensureAssetId(7, 'blob:cached', cache)).resolves.toBe(23)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.uploadAssetFile).not.toHaveBeenCalled()
  })

  it('fails before download or upload when the asset request is already cancelled', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    controller.abort()

    await expect(ensureAssetId(7, 'blob:cancelled', {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.uploadAssetFile).not.toHaveBeenCalled()
  })

  it('forwards cancellation to image download and allows a clean retry afterwards', async () => {
    const controller = new AbortController()
    const cache: Record<string, number> = {}
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const request = ensureAssetId(7, 'blob:cancel-download', cache, controller.signal)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.uploadAssetFile).not.toHaveBeenCalled()
    expect(cache).toEqual({})

    fetchMock.mockResolvedValueOnce(imageResponse())
    mocks.uploadAssetFile.mockResolvedValueOnce({ asset: { id: 29 } })
    await expect(ensureAssetId(7, 'blob:cancel-download', cache)).resolves.toBe(29)
    expect(cache).toEqual({ 'blob:cancel-download': 29 })
  })

  it('forwards cancellation to the backend upload and never caches its incomplete result', async () => {
    const controller = new AbortController()
    const cache: Record<string, number> = {}
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse()))
    mocks.uploadAssetFile.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    })

    const request = ensureAssetId(7, 'blob:cancel-upload', cache, controller.signal)
    await vi.waitFor(() => expect(mocks.uploadAssetFile).toHaveBeenCalledOnce())
    expect(mocks.uploadAssetFile.mock.calls[0]?.[0]?.signal).toBe(controller.signal)
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(cache).toEqual({})

    mocks.uploadAssetFile.mockResolvedValueOnce({ asset: { id: 30 } })
    await expect(ensureAssetId(7, 'blob:cancel-upload', cache)).resolves.toBe(30)
    expect(cache).toEqual({ 'blob:cancel-upload': 30 })
  })

  it('uploads an image once, derives its file extension, and reuses the populated cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse('image/webp'))
    vi.stubGlobal('fetch', fetchMock)
    mocks.uploadAssetFile.mockResolvedValue({ asset: { id: 31 } })
    const cache: Record<string, number> = {}

    await expect(ensureAssetId(7, 'blob:shot', cache)).resolves.toBe(31)
    await expect(ensureAssetId(7, 'blob:shot', cache)).resolves.toBe(31)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mocks.uploadAssetFile).toHaveBeenCalledOnce()
    expect(mocks.uploadAssetFile).toHaveBeenCalledWith({
      workspaceId: 7,
      file: expect.objectContaining({ name: expect.stringMatching(/^ref_\d+\.webp$/), type: 'image/webp' }),
    })
    expect(cache).toEqual({ 'blob:shot': 31 })
  })

  it('coalesces concurrent requests for the same URL and cache into one paid upload', async () => {
    const responseGate = deferred<ReturnType<typeof imageResponse>>()
    const fetchMock = vi.fn().mockReturnValue(responseGate.promise)
    vi.stubGlobal('fetch', fetchMock)
    mocks.uploadAssetFile.mockResolvedValue({ asset: { id: 41 } })
    const cache: Record<string, number> = {}

    const first = ensureAssetId(7, 'blob:concurrent', cache)
    const second = ensureAssetId(7, 'blob:concurrent', cache)
    responseGate.resolve(imageResponse())

    await expect(Promise.all([first, second])).resolves.toEqual([41, 41])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mocks.uploadAssetFile).toHaveBeenCalledOnce()
  })

  it('never reuses a workspace-scoped asset ID after the cache crosses into another workspace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse()))
    mocks.uploadAssetFile.mockResolvedValueOnce({ asset: { id: 45 } }).mockResolvedValueOnce({ asset: { id: 46 } })
    const cache: Record<string, number> = {}

    await expect(ensureAssetId(7, 'blob:shared', cache)).resolves.toBe(45)
    await expect(ensureAssetId(8, 'blob:shared', cache)).resolves.toBe(46)
    await expect(ensureAssetId(8, 'blob:shared', cache)).resolves.toBe(46)

    expect(mocks.uploadAssetFile.mock.calls.map(([request]) => request.workspaceId)).toEqual([7, 8])
  })

  it('rejects failed downloads instead of uploading an HTTP error body as an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        blob: async () => new Blob(['not found'], { type: 'text/html' }),
      }),
    )

    await expect(ensureAssetId(7, 'https://cdn.example.com/missing.png', {})).rejects.toThrow()
    expect(mocks.uploadAssetFile).not.toHaveBeenCalled()
  })

  it('does not cache invalid upload identifiers and retries the next call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse()))
    mocks.uploadAssetFile.mockResolvedValueOnce({ asset: { id: 0 } }).mockResolvedValueOnce({ asset: { id: 52 } })
    const cache: Record<string, number> = {}

    await expect(ensureAssetId(7, 'blob:retry', cache)).resolves.toBe(0)
    await expect(ensureAssetId(7, 'blob:retry', cache)).resolves.toBe(52)

    expect(mocks.uploadAssetFile).toHaveBeenCalledTimes(2)
    expect(cache).toEqual({ 'blob:retry': 52 })
  })

  it('passes durable URLs through and persists local URLs to a signed asset URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse()))
    mocks.uploadAssetFile.mockResolvedValue({ asset: { id: 63 } })
    mocks.getAssetDownloadUrl.mockResolvedValue('/api/v1/assets/63/download?workspace_id=7')

    await expect(persistImageAsset(7, 'https://cdn.example.com/already-hosted.png')).resolves.toEqual({
      url: 'https://cdn.example.com/already-hosted.png',
      assetId: 0,
    })
    await expect(persistImageAsset(7, 'data:image/png;base64,YQ==')).resolves.toEqual({
      url: '/api/v1/assets/63/download?workspace_id=7',
      assetId: 63,
    })

    expect(mocks.getAssetDownloadUrl).toHaveBeenCalledWith({ workspaceId: 7, assetId: 63 })
  })

  it('keeps the local URL when upload or signed-URL resolution fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse()))
    mocks.uploadAssetFile.mockRejectedValueOnce(new Error('upload failed')).mockResolvedValueOnce({ asset: { id: 72 } })
    mocks.getAssetDownloadUrl.mockRejectedValueOnce(new Error('signing failed'))

    await expect(persistImageAsset(7, 'blob:upload-failure')).resolves.toEqual({
      url: 'blob:upload-failure',
      assetId: 0,
    })
    await expect(persistImageAsset(7, 'blob:signing-failure')).resolves.toEqual({
      url: 'blob:signing-failure',
      assetId: 72,
    })
  })

  it('propagates upload cancellation instead of disguising it as a local-URL fallback', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse()))
    mocks.uploadAssetFile.mockRejectedValue(abortError)

    await expect(persistImageAsset(7, 'blob:cancel-persist', {}, controller.signal)).rejects.toBe(abortError)

    expect(mocks.getAssetDownloadUrl).not.toHaveBeenCalled()
  })

  it('passes cancellation to signed-URL resolution and keeps AbortError observable', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse()))
    mocks.uploadAssetFile.mockResolvedValue({ asset: { id: 73 } })
    mocks.getAssetDownloadUrl.mockImplementation(({ signal }: { signal?: AbortSignal }) => {
      expect(signal).toBe(controller.signal)
      controller.abort()
      throw abortError
    })

    await expect(persistImageAsset(7, 'blob:cancel-signing', {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mocks.getAssetDownloadUrl).toHaveBeenCalledWith({
      workspaceId: 7,
      assetId: 73,
      signal: controller.signal,
    })
  })

  it('refreshes only valid positive asset IDs and fails closed on signing errors', async () => {
    mocks.getAssetDownloadUrl
      .mockResolvedValueOnce('/api/v1/assets/81/download?workspace_id=7')
      .mockRejectedValueOnce(new Error('expired session'))

    await expect(refreshAssetUrl(7, 0)).resolves.toBe('')
    await expect(refreshAssetUrl(7, -1)).resolves.toBe('')
    await expect(refreshAssetUrl(7, 81)).resolves.toBe('/api/v1/assets/81/download?workspace_id=7')
    await expect(refreshAssetUrl(7, 82)).resolves.toBe('')

    expect(mocks.getAssetDownloadUrl).toHaveBeenCalledTimes(2)
  })
})

describe('estimateShotImageCost', () => {
  beforeEach(() => {
    vi.useRealTimers()
    resetMocks()
    mocks.estimateAiTaskCost.mockResolvedValue({ credits: 4 })
  })

  it('rejects estimate before billing when the selected model requires more references', async () => {
    const selectedModel = {
      id: 621,
      display_name: '双参考图模型',
      params_schema: {
        fields: [{ name: 'reference_images', type: 'array', minItems: 2, maxItems: 4 }],
      },
    }
    mocks.getModelParamFields.mockReturnValue(selectedModel.params_schema.fields)

    await expect(
      estimateShotImageCost({
        workspaceId: 7,
        referenceImageCount: 1,
        ratio: '16:9',
        modelVersionId: selectedModel.id,
        modelVersion: selectedModel,
      }),
    ).rejects.toThrow('双参考图模型 与当前生成参数不兼容：当前参考图数量 1 不符合2–4 张')

    expect(mocks.estimateAiTaskCost).not.toHaveBeenCalled()
  })

  it('uses the exact reference count when validating and estimating the selected model', async () => {
    const selectedModel = {
      id: 613,
      display_name: '多参考图模型',
      params_schema: {
        fields: [{ name: 'reference_images', type: 'array', minItems: 2, maxItems: 3 }],
      },
    }
    mocks.getModelParamFields.mockReturnValue(selectedModel.params_schema.fields)

    await expect(
      estimateShotImageCost({
        workspaceId: 7,
        referenceImageCount: 3,
        ratio: '16:9',
        modelVersionId: selectedModel.id,
        modelVersion: selectedModel,
      }),
    ).resolves.toEqual({ credits: 4 })

    expect(mocks.estimateAiTaskCost).toHaveBeenCalledWith(
      expect.objectContaining({
        modelVersionId: 613,
        operationCode: 'image.image_to_image',
      }),
    )
  })

  it('rejects contradictory legacy and exact reference-count arguments before billing', async () => {
    await expect(
      estimateShotImageCost({
        workspaceId: 7,
        hasRefs: false,
        referenceImageCount: 2,
      }),
    ).rejects.toThrow('参考图数量参数无效')

    expect(mocks.resolveTaskModel).not.toHaveBeenCalled()
    expect(mocks.estimateAiTaskCost).not.toHaveBeenCalled()
  })

  it('exposes the exact schema-derived params used by estimate and submission for quote snapshots', () => {
    const selectedModel = {
      id: 612,
      params_schema: { fields: [{ name: 'watermark' }, { name: 'size', options: ['2K', '512x512'] }] },
    }
    mocks.buildStoryboardImageParams.mockReturnValue({ ratio: '16:9', count: 1 })
    mocks.getModelParamFields.mockReturnValue(selectedModel.params_schema.fields)

    expect(compileShotImageRequestParams(selectedModel, '16:9', true)).toEqual({
      ratio: '16:9',
      count: 1,
      watermark: false,
      size: '512x512',
    })
  })

  it.each([
    { hasRefs: false, operationCode: 'image.text_to_image' },
    { hasRefs: true, operationCode: 'image.image_to_image' },
  ])('uses $operationCode and the generation-equivalent model params', async ({ hasRefs, operationCode }) => {
    const model = { id: 301 }
    mocks.resolveTaskModel.mockResolvedValue(model)
    mocks.buildStoryboardImageParams.mockReturnValue({ ratio: '9:16', count: 1 })
    mocks.getModelParamFields.mockReturnValue([
      { name: 'watermark' },
      { name: 'size', options: ['2K', '1024x1024', '512x512'] },
    ])

    await expect(
      estimateShotImageCost({
        workspaceId: 7,
        hasRefs,
        ratio: '9:16',
        lowRes: true,
        modelPlanCandidates: ['paid-plan'],
      }),
    ).resolves.toEqual({ credits: 4 })

    expect(mocks.resolveTaskModel).toHaveBeenCalledWith({
      capability: 'image',
      operationCode,
      preferredModelKeywords: ['gpt-image-2', 'gpt-image', 'gpt image', 'seedream', 'doubao'],
      modelPlanCandidates: ['paid-plan'],
    })
    expect(mocks.estimateAiTaskCost).toHaveBeenCalledWith({
      workspaceId: 7,
      modelVersionId: 301,
      operationCode,
      params: { ratio: '9:16', count: 1, watermark: false, size: '512x512' },
    })
  })

  it('uses the same explicitly selected model and schema params for estimate and submission', async () => {
    const selectedModel = {
      id: 612,
      display_name: '后端图片模型',
      operation_codes: ['image.text_to_image'],
      params_schema: { fields: [{ name: 'watermark' }] },
    }
    mocks.createAiTask.mockResolvedValue({ task_id: 88, status: 'processing' })
    mocks.waitForAiTask.mockResolvedValue({ task_id: 88, status: 'completed' })
    mocks.buildStoryboardImageParams.mockReturnValue({ ratio: '16:9', count: 1 })
    mocks.getModelParamFields.mockReturnValue([{ name: 'watermark' }])

    const selection = {
      workspaceId: 7,
      ratio: '16:9',
      modelVersionId: selectedModel.id,
      modelVersion: selectedModel,
    }
    await generateShotImage({ ...selection, prompt: 'shot' })
    await estimateShotImageCost(selection)

    const submitted = mocks.createAiTask.mock.calls[0]![0]
    const estimated = mocks.estimateAiTaskCost.mock.calls[0]![0]
    expect(submitted).toMatchObject({
      modelVersionId: 612,
      modelVersion: selectedModel,
      operationCode: 'image.text_to_image',
    })
    expect(estimated).toMatchObject({
      modelVersionId: 612,
      operationCode: 'image.text_to_image',
    })
    expect(submitted.params(selectedModel)).toEqual(estimated.params)
    expect(mocks.resolveTaskModel).not.toHaveBeenCalled()
  })

  it('falls back from preferred keywords to any available image model', async () => {
    mocks.resolveTaskModel.mockRejectedValueOnce(new Error('preferred unavailable')).mockResolvedValueOnce({ id: 402 })

    await estimateShotImageCost({ workspaceId: 8, modelPlanCandidates: ['standard'] })

    expect(mocks.resolveTaskModel).toHaveBeenCalledTimes(2)
    expect(mocks.resolveTaskModel.mock.calls[1]?.[0]).toMatchObject({
      preferredModelKeywords: [],
      modelPlanCandidates: ['standard'],
    })
    expect(mocks.estimateAiTaskCost).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 8, modelVersionId: 402, operationCode: 'image.text_to_image' }),
    )
  })

  it('does not estimate when no eligible model can be resolved', async () => {
    mocks.resolveTaskModel.mockResolvedValue(null)

    await expect(estimateShotImageCost({ workspaceId: 7 })).rejects.toThrow('暂无可用的图像生成模型')
    expect(mocks.resolveTaskModel).toHaveBeenCalledTimes(2)
    expect(mocks.estimateAiTaskCost).not.toHaveBeenCalled()
  })
})
