import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAiTask: vi.fn(),
  estimateAiTaskCost: vi.fn(),
  resolveTaskModel: vi.fn(),
  resolveTaskVideoResult: vi.fn(),
  waitForAiTask: vi.fn(),
  buildVideoGenerationParams: vi.fn(),
  getModelParamFields: vi.fn(),
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

vi.mock('@/utils/modelSchema', () => ({
  getModelParamFields: mocks.getModelParamFields,
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
      operation_codes: ['video.edit'],
      params_schema: { fields: [{ name: 'resolution' }] },
    })
    mocks.getModelParamFields.mockReturnValue([{ name: 'resolution' }])
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
      expect.objectContaining({ duration: 7, durationMode: 'exact' }),
    )
    expect(mocks.buildVideoGenerationParams).toHaveBeenNthCalledWith(
      2,
      model,
      expect.objectContaining({ duration: 7, durationMode: 'exact' }),
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
