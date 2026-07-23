import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAiTask: vi.fn(),
  estimateAiTaskCost: vi.fn(),
  getModelForOperation: vi.fn(),
  resolveTaskVideoResult: vi.fn(),
  waitForAiTask: vi.fn(),
  buildVideoGenerationParams: vi.fn(),
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

import {
  awaitHotVideoResult,
  estimateReplicateCost,
  invalidateHotCopyVideoModel,
  replicateHotVideo,
} from '@/api/hotCopy'

describe('replicateHotVideo lifecycle', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    invalidateHotCopyVideoModel(7)
    invalidateHotCopyVideoModel(61)
    mocks.buildVideoGenerationParams.mockReturnValue({ duration: 10, ratio: '16:9', generate_audio: true })
  })

  it('passes the persistent generation key and accepts taskId response aliases', async () => {
    mocks.createAiTask.mockResolvedValue({ taskId: 812, status: 'PROCESSING' })
    mocks.waitForAiTask.mockResolvedValue({ task_id: 812, status: 'COMPLETED' })
    mocks.resolveTaskVideoResult.mockResolvedValue({
      url: 'https://cdn.example.com/result.mp4',
      assetId: 913,
    })
    const onTask = vi.fn()

    await expect(
      replicateHotVideo({
        workspaceId: 7,
        videoAssetId: 100,
        productAssetIds: [101],
        modelVersion: { id: 3 },
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
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '', assetId: 0 })

    await expect(
      replicateHotVideo({
        workspaceId: 7,
        videoAssetId: 100,
        productAssetIds: [101],
        modelVersion: { id: 3 },
      }),
    ).rejects.toMatchObject({
      code: 'TASK_MEDIA_PENDING',
      hotCopyTaskId: 812,
    })
  })

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

  it('uses the same cached model and schema-derived params for replicate estimate and submission', async () => {
    const model = { id: 29, operation_codes: ['video.replicate'], params_schema: { fields: [] } }
    mocks.getModelForOperation.mockResolvedValue(model)
    mocks.buildVideoGenerationParams.mockReturnValue({
      duration: 15,
      source_video_duration: 14.8,
      resolution: '720p',
      ratio: '9:16',
      generate_audio: true,
    })
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 99 })
    mocks.createAiTask.mockResolvedValue({ id: 831, status: 'PROCESSING' })
    mocks.waitForAiTask.mockResolvedValue({ id: 831, status: 'COMPLETED' })
    mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/replicated.mp4', assetId: 832 })
    const sharedArgs = {
      workspaceId: 61,
      ratio: '9:16',
      durationSec: 15,
      sourceVideoDurationSec: 14.8,
      modelPlanCandidates: ['team'],
    }

    await estimateReplicateCost(sharedArgs)
    await replicateHotVideo({
      ...sharedArgs,
      videoAssetId: 200,
      productAssetIds: [201],
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
      modelVersion: model,
      operationCode: 'video.replicate',
    })
    expect(estimated.params).toEqual(submitted.params)
    expect(mocks.getModelForOperation).toHaveBeenCalledWith('video.replicate', ['seedance'], ['team'], 61)
    expect(mocks.getModelForOperation).toHaveBeenCalledOnce()
  })
})
