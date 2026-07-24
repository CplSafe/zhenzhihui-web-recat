import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAiTask: vi.fn(),
  estimateAiTaskCost: vi.fn(),
  resolveTaskModel: vi.fn(),
  resolveTaskVideoResult: vi.fn(),
  waitForAiTask: vi.fn(),
  buildVideoGenerationParams: vi.fn(),
  requireOrderedShotAssetIds: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  createAiTask: mocks.createAiTask,
  estimateAiTaskCost: mocks.estimateAiTaskCost,
  getAiTaskId: (task: Record<string, unknown> | null | undefined) => {
    const id = Number(task?.id ?? task?.task_id ?? task?.taskId ?? 0)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  },
  getModelForOperation: vi.fn(),
  resolveTaskModel: mocks.resolveTaskModel,
  waitForAiTask: mocks.waitForAiTask,
}))

vi.mock('@/utils/videoTasks', () => ({
  buildVideoGenerationParams: mocks.buildVideoGenerationParams,
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

vi.mock('@/utils/smartGenerationGuards', () => ({
  requireOrderedShotAssetIds: mocks.requireOrderedShotAssetIds,
}))

import {
  compileFullVideoModelRequest,
  editFullVideo,
  estimateFullVideoCost,
  estimateVideoEditCost,
  generateFullVideo,
  resumeFullVideo,
} from '@/api/smartVideo'

describe('smart video lifecycle', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.createAiTask.mockResolvedValue({ task_id: 901, status: 'PROCESSING' })
    mocks.waitForAiTask.mockResolvedValue({ taskId: 901, status: 'COMPLETED' })
    mocks.resolveTaskModel.mockResolvedValue({
      id: 9,
      operation_codes: ['video.edit', 'video.generate'],
      params_schema: { fields: [{ name: 'resolution' }] },
    })
    mocks.buildVideoGenerationParams.mockReturnValue({
      duration: 5,
      source_video_duration: 5.06,
      resolution: '720p',
      generate_audio: true,
    })
    mocks.requireOrderedShotAssetIds.mockReturnValue([101])
  })

  it('persists task_id aliases for video.edit recovery', async () => {
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/edited.mp4', assetId: 902 })
    const onTask = vi.fn()

    await expect(
      editFullVideo({
        workspaceId: 7,
        videoAssetId: 100,
        onTask,
      }),
    ).resolves.toEqual({ url: '/edited.mp4', assetId: 902 })

    expect(onTask).toHaveBeenCalledWith(901)
    expect(mocks.resolveTaskVideoResult).toHaveBeenCalledWith(7, expect.objectContaining({ taskId: 901 }), 901)
  })

  it('keeps a completed edit recoverable while its video is still being persisted', async () => {
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '', assetId: 0 })

    await expect(
      editFullVideo({
        workspaceId: 7,
        videoAssetId: 100,
      }),
    ).rejects.toMatchObject({
      code: 'TASK_MEDIA_PENDING',
      smartVideoTaskId: 901,
    })
  })

  it('提交 video.edit 时只下发模型 schema 声明的参数', async () => {
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/edited.mp4', assetId: 902 })

    await editFullVideo({
      workspaceId: 61,
      videoAssetId: 2550,
      durationSec: 7,
      sourceVideoDurationSec: 5.06,
    })

    expect(mocks.buildVideoGenerationParams).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 7, durationMode: 'exact' }),
    )
    expect(mocks.createAiTask).toHaveBeenCalledWith(
      expect.objectContaining({
        modelVersionId: 9,
        operationCode: 'video.edit',
        params: { resolution: '720p' },
      }),
    )
  })

  it('估价与提交共用同一模型和严格 schema 参数', async () => {
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 1500, balance: 297773, can_afford: true })

    await expect(
      estimateVideoEditCost({
        workspaceId: 61,
        prompt: '提高亮度',
        durationSec: 7,
        sourceVideoDurationSec: 5.06,
      }),
    ).resolves.toMatchObject({ estimated_cost: 1500 })

    expect(mocks.buildVideoGenerationParams).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 7, durationMode: 'exact' }),
    )
    expect(mocks.estimateAiTaskCost).toHaveBeenCalledWith({
      workspaceId: 61,
      modelVersionId: 9,
      operationCode: 'video.edit',
      prompt: '提高亮度',
      params: { resolution: '720p' },
    })
  })

  it('video.edit estimate and submission use the same explicitly selected backend model', async () => {
    const selectedModel = {
      id: 27,
      display_name: '后端视频修改模型',
      operation_codes: ['video.edit'],
      params_schema: { fields: [{ name: 'resolution' }] },
    }
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/edited.mp4', assetId: 902 })
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 120 })

    const selection = {
      workspaceId: 61,
      modelVersionId: selectedModel.id,
      modelVersion: selectedModel,
      prompt: '提高亮度',
      durationSec: 7,
      sourceVideoDurationSec: 5.06,
    }
    await editFullVideo({ ...selection, videoAssetId: 2550 })
    await estimateVideoEditCost(selection)

    const submitted = mocks.createAiTask.mock.calls[0]![0]
    const estimated = mocks.estimateAiTaskCost.mock.calls[0]![0]
    expect(submitted).toMatchObject({
      modelVersionId: 27,
      modelVersion: selectedModel,
      operationCode: 'video.edit',
    })
    expect(estimated).toMatchObject({
      modelVersionId: 27,
      operationCode: 'video.edit',
    })
    expect(estimated.prompt).toBe(submitted.prompt)
    expect(estimated.params).toEqual(submitted.params)
    expect(mocks.resolveTaskModel).not.toHaveBeenCalled()
  })

  it.each([
    ['id', { id: 701 }],
    ['task_id', { task_id: 702 }],
    ['taskId', { taskId: 703 }],
  ])('generateFullVideo accepts the %s task ID alias', async (_alias, task) => {
    mocks.createAiTask.mockResolvedValue({ ...task, status: 'PROCESSING' })
    mocks.waitForAiTask.mockResolvedValue({ ...task, status: 'COMPLETED' })
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/generated.mp4', assetId: 704 })
    const onTask = vi.fn()

    await expect(
      generateFullVideo({
        workspaceId: 61,
        shots: [{ duration: '5s' }],
        imageAssetIds: [101],
        onTask,
      }),
    ).resolves.toEqual({ url: '/generated.mp4', assetId: 704 })

    expect(onTask).toHaveBeenCalledWith(Number(Object.values(task)[0]))
  })

  it('fails before polling when generateFullVideo receives task ID zero', async () => {
    mocks.createAiTask.mockResolvedValue({ task_id: 0, status: 'PROCESSING' })

    await expect(
      generateFullVideo({
        workspaceId: 61,
        shots: [{ duration: '5s' }],
        imageAssetIds: [101],
      }),
    ).rejects.toThrow('视频生成任务创建后未返回任务 ID')

    expect(mocks.waitForAiTask).not.toHaveBeenCalled()
  })

  it('uses the fixed Seedance resolver for estimate and submission while ignoring legacy model fields', async () => {
    const model = {
      id: 19,
      enabled: true,
      display_name: 'Seedance 1.5 Pro',
      operation_codes: ['video.generate'],
      params_schema: { fields: [] },
    }
    mocks.resolveTaskModel.mockResolvedValue(model)
    mocks.buildVideoGenerationParams.mockReturnValue({
      duration: 7,
      resolution: '720p',
      ratio: '9:16',
      generate_audio: true,
    })
    mocks.createAiTask.mockResolvedValue({ task_id: 711, status: 'PROCESSING' })
    mocks.waitForAiTask.mockResolvedValue({ task_id: 711, status: 'COMPLETED' })
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/generated.mp4', assetId: 712 })
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 88 })
    const args = {
      workspaceId: 61,
      shots: [{ duration: '3s' }, { duration: '4s' }],
      ratio: '9:16',
      videoModelVersionId: 999,
      videoModel: 'happyhorse',
    } as any

    await generateFullVideo({ ...args, imageAssetIds: [101] })
    await estimateFullVideoCost(args)

    const submitted = mocks.createAiTask.mock.calls[0]![0]
    const estimated = mocks.estimateAiTaskCost.mock.calls[0]![0]
    expect(submitted).toMatchObject({
      workspaceId: 61,
      modelVersionId: 19,
      modelVersion: model,
      operationCode: 'video.generate',
    })
    expect(estimated).toMatchObject({
      workspaceId: 61,
      modelVersionId: 19,
      operationCode: 'video.generate',
    })
    expect(estimated.params).toEqual(submitted.params)
    expect(mocks.buildVideoGenerationParams).toHaveBeenNthCalledWith(
      1,
      model,
      expect.objectContaining({ duration: 7, durationMode: 'exact', validateExactDuration: true }),
    )
    expect(mocks.buildVideoGenerationParams).toHaveBeenNthCalledWith(
      2,
      model,
      expect.objectContaining({ duration: 7, durationMode: 'exact', validateExactDuration: true }),
    )
    expect(mocks.resolveTaskModel).toHaveBeenNthCalledWith(1, {
      workspaceId: 61,
      capability: 'video',
      operationCode: 'video.generate',
      preferredModelKeywords: ['seedance'],
    })
    expect(mocks.resolveTaskModel).toHaveBeenNthCalledWith(2, {
      workspaceId: 61,
      capability: 'video',
      operationCode: 'video.generate',
      preferredModelKeywords: ['seedance'],
    })
  })

  it('video.generate estimate and submission use the same explicitly selected backend model', async () => {
    const selectedModel = {
      id: 29,
      display_name: '后端视频生成模型',
      operation_codes: ['video.generate'],
      params_schema: { fields: [] },
    }
    mocks.buildVideoGenerationParams.mockReturnValue({
      duration: 7,
      resolution: '720p',
      ratio: '9:16',
      generate_audio: true,
    })
    mocks.createAiTask.mockResolvedValue({ task_id: 731, status: 'PROCESSING' })
    mocks.waitForAiTask.mockResolvedValue({ task_id: 731, status: 'COMPLETED' })
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/generated.mp4', assetId: 732 })
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 98 })

    const selection = {
      workspaceId: 61,
      shots: [{ duration: '3s' }, { duration: '4s' }],
      ratio: '9:16',
      modelVersionId: selectedModel.id,
      modelVersion: selectedModel,
    }
    await generateFullVideo({ ...selection, imageAssetIds: [101] })
    await estimateFullVideoCost(selection)

    const submitted = mocks.createAiTask.mock.calls[0]![0]
    const estimated = mocks.estimateAiTaskCost.mock.calls[0]![0]
    expect(submitted).toMatchObject({
      modelVersionId: 29,
      modelVersion: selectedModel,
      operationCode: 'video.generate',
    })
    expect(estimated).toMatchObject({
      modelVersionId: 29,
      operationCode: 'video.generate',
    })
    expect(estimated.params).toEqual(submitted.params)
    expect(mocks.resolveTaskModel).not.toHaveBeenCalled()
  })

  it('does not re-add generate_audio when the selected Seedance schema builder omits it', async () => {
    const selectedModel = {
      id: 30,
      display_name: 'Seedance 2.0',
      operation_codes: ['video.generate'],
      params_schema: {
        fields: [
          { name: 'duration', options: [5, 10, 15] },
          { name: 'ratio', options: ['16:9', '9:16'] },
          { name: 'resolution', options: ['720p'] },
        ],
      },
    }
    mocks.buildVideoGenerationParams.mockReturnValue({
      duration: 10,
      ratio: '16:9',
      resolution: '720p',
    })
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/seedance.mp4', assetId: 733 })

    await generateFullVideo({
      workspaceId: 61,
      shots: [{ duration: '10s' }],
      imageAssetIds: [101],
      ratio: '16:9',
      modelVersionId: selectedModel.id,
      modelVersion: selectedModel,
    })

    const params = mocks.createAiTask.mock.calls[0]![0].params
    expect(params).toEqual({ duration: 10, ratio: '16:9', resolution: '720p' })
    expect(params).not.toHaveProperty('generate_audio')
    expect(mocks.createAiTask.mock.calls[0]![0].inputAssets).toEqual([{ asset_id: 101, role: 'image' }])
  })

  it.each(['model_version_id', 'modelVersionId', 'id'])(
    'preserves the full explicit video model schema and canonicalizes the %s alias',
    async (idField) => {
      const selectedModel = {
        [idField]: '39',
        display_name: '后端视频生成模型',
        operation_codes: ['video.generate'],
        params_schema: { fields: [{ name: 'resolution' }] },
      }
      mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/generated.mp4', assetId: 740 })

      await generateFullVideo({
        workspaceId: 61,
        shots: [{ duration: '5s' }],
        imageAssetIds: [101],
        modelVersion: selectedModel,
      })

      expect(mocks.createAiTask).toHaveBeenCalledWith(
        expect.objectContaining({
          modelVersionId: 39,
          modelVersion: {
            ...selectedModel,
            id: 39,
          },
        }),
      )
      expect(mocks.resolveTaskModel).not.toHaveBeenCalled()
    },
  )

  it('uses canonical model_version_id before modelVersionId and id', async () => {
    const selectedModel = {
      model_version_id: '391',
      modelVersionId: '392',
      id: 393,
      display_name: '后端视频生成模型',
      operation_codes: ['video.generate'],
      params_schema: { fields: [] },
    }
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/generated.mp4', assetId: 741 })

    await generateFullVideo({
      workspaceId: 61,
      shots: [{ duration: '5s' }],
      imageAssetIds: [101],
      modelVersion: selectedModel,
    })

    expect(mocks.createAiTask).toHaveBeenCalledWith(
      expect.objectContaining({
        modelVersionId: 391,
        modelVersion: {
          ...selectedModel,
          id: 391,
        },
      }),
    )
  })

  it('compiles a reference-video model role, image bounds and audio capability before estimate and submit', async () => {
    const selectedModel = {
      model_version_id: 52,
      display_name: 'HappyHorse 参考生视频',
      operation_codes: ['video.generate'],
      params_schema: {
        fields: [
          { name: 'duration', minimum: 1, maximum: 15 },
          { name: 'reference_images', minItems: 1, maxItems: 2 },
          { name: 'input_asset_role', const: 'reference_image' },
          { name: 'generate_audio', oneOf: [{ const: false }] },
        ],
      },
    }
    mocks.requireOrderedShotAssetIds.mockReturnValue([101, 102])
    mocks.buildVideoGenerationParams.mockImplementation((_model, params) => ({
      duration: params.duration,
      generate_audio: params.generateAudio,
    }))
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/reference.mp4', assetId: 742 })
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 70 })

    const shots = [{ duration: '3s' }, { duration: '4s' }]
    const compiled = compileFullVideoModelRequest(selectedModel, {
      shots,
      ratio: '16:9',
      referenceImageCount: 2,
    })
    expect(compiled).toMatchObject({
      modelVersionId: 52,
      inputAssetRole: 'reference_image',
      referenceImageCount: 2,
      params: { duration: 7, generate_audio: false },
    })

    const selection = {
      workspaceId: 61,
      shots,
      ratio: '16:9',
      modelVersionId: 52,
      modelVersion: selectedModel,
    }
    await generateFullVideo({ ...selection, imageAssetIds: [101, 102] })
    await estimateFullVideoCost(selection)

    const submitted = mocks.createAiTask.mock.calls[0]![0]
    const estimated = mocks.estimateAiTaskCost.mock.calls[0]![0]
    expect(submitted.inputAssets).toEqual([
      { asset_id: 101, role: 'reference_image' },
      { asset_id: 102, role: 'reference_image' },
    ])
    expect(submitted.params).toEqual(estimated.params)
    expect(mocks.buildVideoGenerationParams).toHaveBeenCalledTimes(3)
    expect(mocks.buildVideoGenerationParams.mock.calls.every(([, params]) => params.generateAudio === false)).toBe(true)
  })

  it.each([
    ['below minimum', [101]],
    ['above maximum', [101, 102, 103, 104]],
  ])('rejects reference image count %s before creating a paid task', async (_label, imageAssetIds) => {
    const selectedModel = {
      id: 53,
      display_name: '参考生视频模型',
      operation_codes: ['video.generate'],
      params_schema: {
        fields: [{ name: 'reference_images', minItems: 2, maxItems: 3 }],
      },
    }
    mocks.requireOrderedShotAssetIds.mockReturnValue(imageAssetIds)

    await expect(
      generateFullVideo({
        workspaceId: 61,
        shots: [{ duration: '5s' }],
        imageAssetIds,
        modelVersionId: 53,
        modelVersion: selectedModel,
      }),
    ).rejects.toThrow('所选视频模型不支持当前参考图')

    expect(mocks.createAiTask).not.toHaveBeenCalled()
  })

  it('fails closed when an explicit input role declaration is ambiguous', () => {
    expect(() =>
      compileFullVideoModelRequest(
        {
          id: 54,
          operation_codes: ['video.generate'],
          params_schema: {
            fields: [
              {
                name: 'input_asset_role',
                options: ['first_frame', 'reference_image'],
                required: true,
              },
            ],
          },
        },
        {
          shots: [{ duration: '5s' }],
          referenceImageCount: 1,
        },
      ),
    ).toThrow('所选视频模型声明了输入素材角色，但未提供唯一可用角色')
    expect(mocks.createAiTask).not.toHaveBeenCalled()
  })

  it('rejects an invalid resume task ID before polling', async () => {
    await expect(resumeFullVideo({ workspaceId: 61, taskId: 0 })).rejects.toThrow('视频生成任务 ID 无效')
    expect(mocks.waitForAiTask).not.toHaveBeenCalled()
  })

  it('keeps a resumed completed task recoverable while its media is pending', async () => {
    mocks.waitForAiTask.mockResolvedValue({ id: 721, status: 'COMPLETED' })
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '', assetId: 0 })

    await expect(resumeFullVideo({ workspaceId: 61, taskId: 721 })).rejects.toMatchObject({
      code: 'TASK_MEDIA_PENDING',
      smartVideoTaskId: 721,
    })
  })
})
