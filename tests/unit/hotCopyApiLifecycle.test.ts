import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAiTask: vi.fn(),
  estimateAiTaskCost: vi.fn(),
  getModelForOperation: vi.fn(),
  resolveTaskVideoResult: vi.fn(),
  waitForAiTask: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  createAiTask: mocks.createAiTask,
  estimateAiTaskCost: mocks.estimateAiTaskCost,
  getAiTaskId: (task: Record<string, unknown> | null | undefined) => {
    const id = Number(task?.id ?? task?.task_id ?? task?.taskId ?? 0)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  },
  getModelForOperation: mocks.getModelForOperation,
  resolveTaskModel: vi.fn(),
  uploadAssetFile: vi.fn(),
  waitForAiTask: mocks.waitForAiTask,
}))

vi.mock('@/utils/videoOptions', () => ({
  normalizeSeedanceDuration: (value: number) => value,
  normalizeSeedanceRatio: (value: string) => value,
}))

vi.mock('@/utils/taskMedia', () => ({
  resolveTaskVideoResult: mocks.resolveTaskVideoResult,
}))

vi.mock('@/utils/taskProgress', () => ({
  readAiTaskProgress: () => undefined,
}))

import {
  createHotCopyReplicateQuote,
  createHotCopyReplicateSnapshot,
  awaitHotVideoResult,
  estimateReplicateCost,
  getHotCopyReplicateSnapshotKey,
  HOT_COPY_MODEL_UNAVAILABLE_CODE,
  HOT_COPY_QUOTE_CHANGED_CODE,
  HOT_COPY_QUOTE_INVALID_CODE,
  invalidateHotCopyVideoModel,
  replicateHotVideo,
  type HotCopyReplicateQuote,
  type HotCopyReplicateSnapshot,
} from '@/api/hotCopy'

const VALID_REPLICATE_INPUTS = {
  sourceVideoDurationSec: 10,
  referenceImageCount: 1,
} as const

function confirmedQuoteFor(
  snapshot: HotCopyReplicateSnapshot,
  estimatedCost = 10,
  balance = 100,
): HotCopyReplicateQuote {
  return createHotCopyReplicateQuote(snapshot, {
    estimated_cost: estimatedCost,
    balance,
    can_afford: true,
  })
}

describe('replicateHotVideo lifecycle', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    invalidateHotCopyVideoModel(7)
    invalidateHotCopyVideoModel(61)
  })

  it('passes the persistent generation key and accepts taskId response aliases', async () => {
    mocks.createAiTask.mockResolvedValue({ taskId: 812, status: 'PROCESSING' })
    mocks.waitForAiTask.mockResolvedValue({ task_id: 812, status: 'COMPLETED' })
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 10, balance: 100, can_afford: true })
    mocks.resolveTaskVideoResult.mockResolvedValue({
      url: 'https://cdn.example.com/result.mp4',
      assetId: 913,
    })
    const onTask = vi.fn()
    const requestSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 7,
      modelVersion: { id: 3, operation_codes: ['video.replicate'] },
      ...VALID_REPLICATE_INPUTS,
    })

    await expect(
      replicateHotVideo({
        workspaceId: 7,
        videoAssetId: 100,
        productAssetIds: [101],
        requestSnapshot,
        confirmedQuote: confirmedQuoteFor(requestSnapshot),
        idempotencyKey: 'hot-copy:7:9:generation-1',
        onTask,
      }),
    ).resolves.toEqual({
      url: 'https://cdn.example.com/result.mp4',
      assetId: 913,
    })

    expect(mocks.createAiTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operationCode: 'video.replicate',
        idempotencyKey: 'hot-copy:7:9:generation-1',
      }),
    )
    expect(onTask).toHaveBeenCalledWith(812)
    expect(mocks.resolveTaskVideoResult).toHaveBeenCalledWith(7, expect.objectContaining({ task_id: 812 }), 812)
  })

  it('keeps a completed task recoverable while its video is still being persisted', async () => {
    mocks.createAiTask.mockResolvedValue({ task_id: 812, status: 'PROCESSING' })
    mocks.waitForAiTask.mockResolvedValue({ task_id: 812, status: 'COMPLETED' })
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 10, balance: 100, can_afford: true })
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '', assetId: 0 })
    const requestSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 7,
      modelVersion: { id: 3, operation_codes: ['video.replicate'] },
      ...VALID_REPLICATE_INPUTS,
    })

    await expect(
      replicateHotVideo({
        workspaceId: 7,
        videoAssetId: 100,
        productAssetIds: [101],
        requestSnapshot,
        confirmedQuote: confirmedQuoteFor(requestSnapshot),
      }),
    ).rejects.toMatchObject({
      code: 'TASK_MEDIA_PENDING',
      hotCopyTaskId: 812,
    })
  })

  it.each([0, 7.5, 16])(
    'rejects invalid duration %s before estimating or creating a paid task',
    async (durationSec) => {
      const modelVersion = {
        id: 3,
        operation_codes: ['video.replicate'],
        params_schema: { fields: [] },
      }

      await expect(
        estimateReplicateCost({
          workspaceId: 7,
          durationSec,
          modelVersion,
          ...VALID_REPLICATE_INPUTS,
        }),
      ).rejects.toThrow('爆款复制时长必须是 1 至 15 秒内的整数')

      expect(mocks.estimateAiTaskCost).not.toHaveBeenCalled()
      expect(mocks.createAiTask).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, 0, Number.NaN])(
    'fails closed when the source video duration is unavailable: %s',
    async (sourceVideoDurationSec) => {
      const modelVersion = {
        id: 4,
        operation_codes: ['video.replicate'],
      }

      expect(() =>
        createHotCopyReplicateSnapshot({
          workspaceId: 7,
          modelVersion,
          sourceVideoDurationSec,
          referenceImageCount: 1,
        }),
      ).toThrow('无法读取源视频真实时长，请重新选择视频后重试')
      await expect(
        estimateReplicateCost({
          workspaceId: 7,
          modelVersion,
          sourceVideoDurationSec,
          referenceImageCount: 1,
        }),
      ).rejects.toThrow('无法读取源视频真实时长，请重新选择视频后重试')

      expect(mocks.estimateAiTaskCost).not.toHaveBeenCalled()
      expect(mocks.createAiTask).not.toHaveBeenCalled()
    },
  )

  it.each([
    {
      field: { name: 'resolution', options: ['1080p'] },
      referenceImageCount: 1,
      expected: '当前分辨率 720p 不在支持范围 1080p 内',
    },
    {
      field: { name: 'generate_audio', options: [false] },
      referenceImageCount: 1,
      expected: '当前模型不支持生成音频',
    },
    {
      field: { name: 'reference_images', maxItems: 1 },
      referenceImageCount: 2,
      expected: '当前参考图数量 2 不符合最大 1 张',
    },
  ])(
    'rejects fixed hot-copy inputs that conflict with the selected model schema',
    ({ field, referenceImageCount, expected }) => {
      expect(() =>
        createHotCopyReplicateSnapshot({
          workspaceId: 7,
          modelVersion: {
            id: 5,
            display_name: '受限模型',
            operation_codes: ['video.replicate'],
            params_schema: { fields: [field] },
          },
          sourceVideoDurationSec: 10,
          referenceImageCount,
        }),
      ).toThrow(expected)
    },
  )

  it('rejects task ID zero before trying to resume polling', async () => {
    await expect(awaitHotVideoResult({ workspaceId: 7, taskId: 0 })).rejects.toThrow('爆款复制任务 ID 无效')
    expect(mocks.waitForAiTask).not.toHaveBeenCalled()
  })

  it('keeps a resumed completed task recoverable while its media is pending', async () => {
    mocks.waitForAiTask.mockResolvedValue({ taskId: 821, status: 'COMPLETED' })
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '', assetId: 0 })

    await expect(awaitHotVideoResult({ workspaceId: 7, taskId: 821 })).rejects.toMatchObject({
      code: 'TASK_MEDIA_PENDING',
      hotCopyTaskId: 821,
    })
  })

  it('uses the explicitly selected model for cost estimation without resolving another model', async () => {
    const selectedModel = {
      id: 9202,
      display_name: 'Seedance 2.0',
      operation_codes: ['video.replicate'],
      params_schema: {
        fields: [
          { name: 'seconds', options: ['5', '10', '15'] },
          { name: 'ratio', options: ['9:16', '16:9'] },
          { name: 'generate_audio' },
        ],
      },
    }
    mocks.getModelForOperation.mockResolvedValue({ id: 9999 })
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 88 })

    await expect(
      estimateReplicateCost({
        workspaceId: 61,
        ratio: '9:16',
        durationSec: 10,
        ...VALID_REPLICATE_INPUTS,
        modelPlanCandidates: ['team'],
        modelVersion: selectedModel,
      }),
    ).resolves.toEqual({ estimated_cost: 88 })

    expect(mocks.getModelForOperation).not.toHaveBeenCalled()
    expect(mocks.estimateAiTaskCost).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 61,
        modelVersionId: 9202,
        operationCode: 'video.replicate',
        params: expect.objectContaining({
          seconds: 10,
          ratio: '9:16',
          generate_audio: true,
        }),
      }),
    )
  })

  it('uses the same frozen model snapshot and schema-derived params for estimate and submission', async () => {
    const model = {
      id: 29,
      operation_codes: ['video.replicate'],
      params_schema: {
        fields: [
          { name: 'seconds', options: ['5', '10', '15'] },
          { name: 'source_video_duration' },
          { name: 'resolution', options: ['720p'] },
          { name: 'ratio', options: ['9:16', '16:9'] },
          { name: 'generate_audio' },
        ],
      },
    }
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 99, balance: 500, can_afford: true })
    mocks.createAiTask.mockResolvedValue({ id: 831, status: 'PROCESSING' })
    mocks.waitForAiTask.mockResolvedValue({ id: 831, status: 'COMPLETED' })
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/replicated.mp4', assetId: 832 })
    const sharedArgs = {
      workspaceId: 61,
      ratio: '9:16',
      durationSec: 10,
      sourceVideoDurationSec: 14.8,
    }
    const requestSnapshot = createHotCopyReplicateSnapshot({
      ...sharedArgs,
      referenceImageCount: 1,
      modelVersion: model,
    })

    await estimateReplicateCost({ workspaceId: 61, requestSnapshot })
    await replicateHotVideo({
      workspaceId: 61,
      videoAssetId: 200,
      productAssetIds: [201],
      requestSnapshot,
      confirmedQuote: confirmedQuoteFor(requestSnapshot, 99, 500),
    })

    const estimated = mocks.estimateAiTaskCost.mock.calls[0]![0]
    const submitted = mocks.createAiTask.mock.calls[0]![0]
    expect(estimated).toMatchObject({
      workspaceId: 61,
      modelVersionId: 29,
      operationCode: 'video.replicate',
    })
    expect(submitted).toMatchObject({
      workspaceId: 61,
      modelVersionId: 29,
      modelVersion: expect.objectContaining(model),
      operationCode: 'video.replicate',
    })
    expect(estimated.params).toEqual(submitted.params)
    expect(submitted.params).toMatchObject({
      seconds: 10,
      source_video_duration: 14.8,
      resolution: '720p',
      ratio: '9:16',
      generate_audio: true,
    })
    expect(mocks.getModelForOperation).not.toHaveBeenCalled()
  })

  it('omits generate_audio unless the selected model schema explicitly declares an audio field', async () => {
    const requestSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 61,
      modelVersion: {
        id: 30,
        operation_codes: ['video.replicate'],
        params_schema: {
          fields: [{ name: 'duration' }, { name: 'ratio' }],
        },
      },
      ratio: '16:9',
      durationSec: 8,
      ...VALID_REPLICATE_INPUTS,
    })
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 18 })

    await estimateReplicateCost({ workspaceId: 61, requestSnapshot })

    const params = mocks.estimateAiTaskCost.mock.calls[0]![0].params
    expect(params).toMatchObject({ duration: 8, ratio: '16:9' })
    expect(params).not.toHaveProperty('generate_audio')
    expect(params).not.toHaveProperty('generateAudio')
  })

  it('uses the exact audio field name declared by the selected model schema', () => {
    const requestSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 61,
      modelVersion: {
        id: 31,
        operation_codes: ['video.replicate'],
        params_schema: {
          fields: [{ name: 'generateAudio' }],
        },
      },
      durationSec: 8,
      ...VALID_REPLICATE_INPUTS,
    })

    expect(requestSnapshot.params).toEqual({ generateAudio: true })
  })

  it('deep-freezes the selected model and normalized params before estimating or submitting', async () => {
    const selectedModel = {
      id: 32,
      operation_codes: ['video.replicate'],
      params_schema: {
        fields: [{ name: 'duration' }, { name: 'ratio' }],
      },
    }
    const requestSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 61,
      modelVersion: selectedModel,
      ratio: '9:16',
      durationSec: 9,
      ...VALID_REPLICATE_INPUTS,
    })
    selectedModel.id = 999
    selectedModel.params_schema.fields[0]!.name = 'seconds'
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 20, balance: 500, can_afford: true })
    mocks.createAiTask.mockResolvedValue({ id: 840, status: 'PROCESSING' })
    mocks.waitForAiTask.mockResolvedValue({ id: 840, status: 'COMPLETED' })
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/stable.mp4', assetId: 841 })

    await estimateReplicateCost({ workspaceId: 61, requestSnapshot })
    await replicateHotVideo({
      workspaceId: 61,
      videoAssetId: 200,
      productAssetIds: [201],
      requestSnapshot,
      confirmedQuote: confirmedQuoteFor(requestSnapshot, 20, 500),
    })

    expect(Object.isFrozen(requestSnapshot)).toBe(true)
    expect(Object.isFrozen(requestSnapshot.modelVersion)).toBe(true)
    expect(Object.isFrozen(requestSnapshot.params)).toBe(true)
    expect(requestSnapshot.modelVersionId).toBe(32)
    expect(requestSnapshot.params).toEqual({ duration: 9, ratio: '9:16' })
    expect(mocks.estimateAiTaskCost.mock.calls[0]![0].params).toEqual(mocks.createAiTask.mock.calls[0]![0].params)
  })

  it('includes the complete selected-model schema in the estimate snapshot key', () => {
    const createSnapshot = (schemaRevision: number) =>
      createHotCopyReplicateSnapshot({
        workspaceId: 61,
        modelVersion: {
          id: 51,
          operation_codes: ['video.replicate'],
          params_schema: {
            fields: [{ name: 'duration' }],
            backend_metadata: { schemaRevision },
          },
        },
        durationSec: 10,
        ...VALID_REPLICATE_INPUTS,
      })
    const first = createSnapshot(1)
    const second = createSnapshot(2)

    expect(first.params).toEqual(second.params)
    expect(getHotCopyReplicateSnapshotKey(first)).not.toBe(getHotCopyReplicateSnapshotKey(second))
  })

  it('rejects a submission when its actual reference image count differs from the estimated snapshot', async () => {
    const requestSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 61,
      modelVersion: {
        id: 50,
        operation_codes: ['video.replicate'],
      },
      sourceVideoDurationSec: 10,
      referenceImageCount: 2,
    })

    await expect(
      replicateHotVideo({
        workspaceId: 61,
        videoAssetId: 200,
        productAssetIds: [201],
        requestSnapshot,
        confirmedQuote: confirmedQuoteFor(requestSnapshot),
      }),
    ).rejects.toThrow('参考图片数量与估价快照不一致，请重新发起')
    expect(mocks.createAiTask).not.toHaveBeenCalled()
  })

  it('uses the canonical model_version_id instead of a conflicting legacy version_id', () => {
    const requestSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 61,
      modelVersion: {
        model_version_id: 52,
        version_id: 999,
        id: 888,
        operation_codes: ['video.replicate'],
      },
      durationSec: 10,
      ...VALID_REPLICATE_INPUTS,
    })

    expect(requestSnapshot.modelVersionId).toBe(52)
    expect(requestSnapshot.modelVersion.id).toBe(52)
  })

  it('stops before creating a paid task when the revalidated price changes', async () => {
    const requestSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 61,
      modelVersion: { id: 60, operation_codes: ['video.replicate'] },
      durationSec: 10,
      ...VALID_REPLICATE_INPUTS,
    })
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 12, balance: 100, can_afford: true })

    await expect(
      replicateHotVideo({
        workspaceId: 61,
        videoAssetId: 200,
        productAssetIds: [201],
        requestSnapshot,
        confirmedQuote: confirmedQuoteFor(requestSnapshot, 10, 100),
      }),
    ).rejects.toMatchObject({
      code: HOT_COPY_QUOTE_CHANGED_CODE,
      hotCopyQuote: expect.objectContaining({ estimatedCost: 12 }),
    })
    expect(mocks.createAiTask).not.toHaveBeenCalled()
  })

  it('stops before creating a paid task when the revalidated balance is insufficient', async () => {
    const requestSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 61,
      modelVersion: { id: 61, operation_codes: ['video.replicate'] },
      durationSec: 10,
      ...VALID_REPLICATE_INPUTS,
    })
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 10, balance: 5, can_afford: false })

    await expect(
      replicateHotVideo({
        workspaceId: 61,
        videoAssetId: 200,
        productAssetIds: [201],
        requestSnapshot,
        confirmedQuote: confirmedQuoteFor(requestSnapshot, 10, 100),
      }),
    ).rejects.toMatchObject({
      code: HOT_COPY_QUOTE_CHANGED_CODE,
      message: '积分余额不足，已停止提交，请充值后重新确认',
    })
    expect(mocks.createAiTask).not.toHaveBeenCalled()
  })

  it('fails closed when the mandatory pre-submit re-estimate has a network error', async () => {
    const requestSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 61,
      modelVersion: { id: 62, operation_codes: ['video.replicate'] },
      durationSec: 10,
      ...VALID_REPLICATE_INPUTS,
    })
    const networkError = new Error('estimate network unavailable')
    mocks.estimateAiTaskCost.mockRejectedValue(networkError)

    await expect(
      replicateHotVideo({
        workspaceId: 61,
        videoAssetId: 200,
        productAssetIds: [201],
        requestSnapshot,
        confirmedQuote: confirmedQuoteFor(requestSnapshot, 10, 100),
      }),
    ).rejects.toBe(networkError)
    expect(mocks.createAiTask).not.toHaveBeenCalled()
  })

  it('rejects a quote created for another request snapshot before re-estimating or creating a task', async () => {
    const modelVersion = { id: 63, operation_codes: ['video.replicate'] }
    const requestSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 61,
      modelVersion,
      durationSec: 10,
      ...VALID_REPLICATE_INPUTS,
    })
    const otherSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 61,
      modelVersion,
      durationSec: 9,
      ...VALID_REPLICATE_INPUTS,
    })

    await expect(
      replicateHotVideo({
        workspaceId: 61,
        videoAssetId: 200,
        productAssetIds: [201],
        requestSnapshot,
        confirmedQuote: confirmedQuoteFor(otherSnapshot, 10, 100),
      }),
    ).rejects.toMatchObject({ code: HOT_COPY_QUOTE_INVALID_CODE })
    expect(mocks.estimateAiTaskCost).not.toHaveBeenCalled()
    expect(mocks.createAiTask).not.toHaveBeenCalled()
  })

  it.each([{ id: 41 }, { id: 42, operation_codes: ['video.generate'] }])(
    'rejects models that do not explicitly declare video.replicate: %o',
    (modelVersion) => {
      expect(() =>
        createHotCopyReplicateSnapshot({
          workspaceId: 61,
          modelVersion,
          durationSec: 10,
          ...VALID_REPLICATE_INPUTS,
        }),
      ).toThrow(
        expect.objectContaining({
          code: HOT_COPY_MODEL_UNAVAILABLE_CODE,
        }),
      )
    },
  )

  it('surfaces a delisted selected model without resolving or switching to another model', async () => {
    const requestSnapshot = createHotCopyReplicateSnapshot({
      workspaceId: 61,
      modelVersion: {
        id: 43,
        operation_codes: ['video.replicate'],
      },
      durationSec: 10,
      ...VALID_REPLICATE_INPUTS,
    })
    const backendError = Object.assign(new Error('model was disabled'), {
      response: { status: 404, data: { code: 'MODEL_DISABLED' } },
    })
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 10, balance: 100, can_afford: true })
    mocks.createAiTask.mockRejectedValue(backendError)
    mocks.getModelForOperation.mockResolvedValue({
      id: 44,
      operation_codes: ['video.replicate'],
    })

    await expect(
      replicateHotVideo({
        workspaceId: 61,
        videoAssetId: 200,
        productAssetIds: [201],
        requestSnapshot,
        confirmedQuote: confirmedQuoteFor(requestSnapshot),
      }),
    ).rejects.toMatchObject({
      code: HOT_COPY_MODEL_UNAVAILABLE_CODE,
      message: '所选视频模型已下架或当前空间不可用，请返回首页重新选择',
    })
    expect(mocks.getModelForOperation).not.toHaveBeenCalled()
    expect(mocks.createAiTask).toHaveBeenCalledOnce()
  })
})
