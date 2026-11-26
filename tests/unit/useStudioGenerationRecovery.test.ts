import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/business', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/business')>()),
  listAiTasks: vi.fn(),
  replayAiTaskSubmission: vi.fn(),
}))
vi.mock('@/api/smartShotImage', () => ({ resumeShotImageGeneration: vi.fn() }))
vi.mock('@/api/smartVideo', () => ({ resumeFullVideo: vi.fn() }))

import { listAiTasks, replayAiTaskSubmission } from '@/api/business'
import { resumeShotImageGeneration } from '@/api/smartShotImage'
import { resumeFullVideo } from '@/api/smartVideo'
import { useStudioGenerationRecovery } from '@/composables/useStudioGenerationRecovery'
import type { StudioResultBatch } from '@/components/studio/StudioResultFeed/StudioResultFeed'
import {
  isStudioGenerationRejected,
  STUDIO_MEDIA_PENDING,
  readStudioSubmissionIdentity,
  readStudioGenerationIntents,
  STUDIO_TASK_SYNCING,
  studioGenerationStorageKey,
  updateStudioGenerationIntent,
  type StudioGenerationIntent,
} from '@/utils/studioGenerationRecovery'

const scope = studioGenerationStorageKey(21, 7)
const batch = { id: 'batch-1', mode: 'image', prompt: '参考图', summary: '1:1', createdAt: 1000 } as const
const intent: StudioGenerationIntent = {
  operation: 'image.text_to_image',
  idempotencyKey: 'studio_item-1_text_to_image',
  batch,
  itemId: 'item-1',
}

const submission = {
  stream: true,
  body: JSON.stringify({
    workspace_id: 21,
    operation_code: intent.operation,
    idempotency_key: intent.idempotencyKey,
    model_version_id: 9,
    input_assets: [{ asset_id: 23, role: 'reference_image' }],
    params: { stream: true },
  }),
}

function renderStudioRecovery(initial: StudioResultBatch[] = []) {
  return renderHook(() => {
    const [batches, setBatches] = useState(initial)
    return { batches, ...useStudioGenerationRecovery(21, 7, batches, setBatches) }
  })
}

describe('创作台生成对账', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.mocked(listAiTasks).mockReset()
    vi.mocked(resumeShotImageGeneration).mockReset()
    vi.mocked(resumeFullVideo).mockReset()
    vi.mocked(replayAiTaskSubmission).mockReset()
  })

  afterEach(() => vi.useRealTimers())

  it('提交响应丢失后保留原幂等键，按同一任务 ID 对账并重试查询', async () => {
    updateStudioGenerationIntent(scope, intent.itemId, intent)
    vi.mocked(listAiTasks)
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValue({
        items: [
          { id: 91, idempotency_key: 'other' },
          { id: 92, idempotency_key: intent.idempotencyKey },
        ],
      })
    vi.mocked(resumeShotImageGeneration)
      .mockRejectedValueOnce(Object.assign(new Error('网络断开'), { status: 503 }))
      .mockResolvedValue({ assetId: 701, url: '/image.png' })

    const { result } = renderStudioRecovery()
    await act(async () => {})
    expect(readStudioGenerationIntents(scope)).toEqual([intent])
    expect(result.current.lockedOperations.has(intent.operation)).toBe(true)
    expect(result.current.batches[0].items[0]).toMatchObject({ status: 'pending', error: STUDIO_TASK_SYNCING })
    expect(resumeShotImageGeneration).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(readStudioGenerationIntents(scope)).toEqual([{ ...intent, taskId: 92 }])
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(result.current.batches[0].items[0]).toMatchObject({
      status: 'pending',
      error: STUDIO_TASK_SYNCING,
      taskId: 92,
    })
    expect(result.current.lockedOperations.has(intent.operation)).toBe(true)

    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(vi.mocked(resumeShotImageGeneration).mock.calls.map(([options]) => options.taskId)).toEqual([92, 92])
    expect(result.current.batches[0].items[0]).toMatchObject({ status: 'done', url: '/image.png' })
    expect(readStudioGenerationIntents(scope)).toEqual([])
    expect(result.current.lockedOperations.has(intent.operation)).toBe(false)
  })

  it('直接续接服务端历史中的图片任务，无需原本机记录', async () => {
    vi.mocked(resumeShotImageGeneration).mockResolvedValue({ assetId: 701, url: '/image.png' })
    const { result } = renderStudioRecovery([
      { ...batch, id: 'task-92', items: [{ id: 'historic', status: 'pending', taskId: 92 }] },
    ])
    await act(async () => {})
    expect(resumeShotImageGeneration).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21, taskId: 92 }))
    expect(resumeFullVideo).not.toHaveBeenCalled()
    expect(result.current.batches[0].items[0]).toMatchObject({ status: 'done', url: '/image.png' })
  })

  it('仍无任务 ID 时继续查老页，并且只接受精确的幂等键', async () => {
    updateStudioGenerationIntent(scope, intent.itemId, intent)
    vi.mocked(listAiTasks)
      .mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })) })
      .mockResolvedValueOnce({ items: [{ id: 1001, idempotency_key: intent.idempotencyKey }] })
    renderStudioRecovery()
    await act(async () => {})
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(vi.mocked(listAiTasks).mock.calls.map(([options]) => options.offset)).toEqual([0, 100])
    expect(readStudioGenerationIntents(scope)).toEqual([{ ...intent, taskId: 1001 }])
  })

  it('原视频任务确认失败后才清除登记，允许新的创作', async () => {
    const video = { ...batch, mode: 'video' as const }
    updateStudioGenerationIntent(scope, intent.itemId, {
      ...intent,
      batch: video,
      operation: 'video.generate',
      taskId: 71,
    })
    vi.mocked(resumeFullVideo).mockRejectedValue({ response: { id: 71, status: 'failed' } })
    const { result } = renderStudioRecovery([
      { ...video, items: [{ id: intent.itemId, status: 'pending', taskId: 71 }] },
    ])
    await act(async () => {})
    expect(result.current.batches[0].items[0]).toMatchObject({ status: 'failed' })
    expect(readStudioGenerationIntents(scope)).toEqual([])
    expect(result.current.lockedOperations.has('video.generate')).toBe(false)
  })

  it('新审核重试尚无任务 ID 时，不用上一次任务的终态清理它', async () => {
    updateStudioGenerationIntent(scope, intent.itemId, intent)
    vi.mocked(listAiTasks).mockResolvedValue({ items: [] })
    const { result } = renderStudioRecovery([
      { ...batch, items: [{ id: intent.itemId, status: 'pending', taskId: 71 }] },
    ])
    await act(async () => {})
    expect(resumeShotImageGeneration).not.toHaveBeenCalled()
    expect(readStudioGenerationIntents(scope)).toEqual([intent])
    expect(result.current.batches[0].items[0]).toMatchObject({ status: 'pending', taskId: undefined })
    expect(result.current.lockedOperations.has(intent.operation)).toBe(true)
  })

  it('旧任务的迟到终态不能清除已换键的持久化记录', async () => {
    const oldAttempt = { ...intent, taskId: 71 }
    const nextAttempt = { ...intent, idempotencyKey: `${intent.idempotencyKey}_output_safety_retry` }
    updateStudioGenerationIntent(scope, intent.itemId, oldAttempt)
    let fail!: (error: unknown) => void
    vi.mocked(resumeShotImageGeneration).mockReturnValue(
      new Promise((_, reject) => {
        fail = reject
      }),
    )
    const { result } = renderStudioRecovery([
      { ...batch, items: [{ id: intent.itemId, status: 'pending', taskId: 71 }] },
    ])
    await act(async () => {})
    expect(resumeShotImageGeneration).toHaveBeenCalledOnce()
    updateStudioGenerationIntent(scope, intent.itemId, nextAttempt, oldAttempt)
    await act(async () => {
      fail({ response: { id: 71, status: 'failed' } })
    })
    expect(readStudioGenerationIntents(scope)).toEqual([nextAttempt])
    expect(result.current.batches[0].items[0].status).toBe('pending')
    expect(result.current.lockedOperations.has(intent.operation)).toBe(true)
  })

  it('只有明确重试才重发同一快照，流中断之前先保存已收到的任务 ID', async () => {
    updateStudioGenerationIntent(scope, intent.itemId, { ...intent, submission })
    vi.mocked(listAiTasks).mockResolvedValue({ items: [] })
    vi.mocked(replayAiTaskSubmission).mockImplementation(async (_submission, _signal, accepted) => {
      accepted?.({ id: 91 })
      throw new Error('流中断')
    })
    const error = vi.fn()
    const { result } = renderStudioRecovery()
    await act(async () => {})
    expect(result.current.retryableItems.has(intent.itemId)).toBe(true)
    expect(replayAiTaskSubmission).not.toHaveBeenCalled()
    await act(async () => result.current.retry(intent.itemId, error))
    expect(replayAiTaskSubmission).toHaveBeenCalledWith(submission, expect.any(AbortSignal), expect.any(Function))
    expect(readStudioGenerationIntents(scope)).toEqual([{ ...intent, taskId: 91 }])
    expect(result.current.retryableItems.has(intent.itemId)).toBe(false)
    expect(result.current.lockedOperations.has(intent.operation)).toBe(true)
    await act(async () => result.current.retry(intent.itemId, error))
    expect(replayAiTaskSubmission).toHaveBeenCalledOnce()
  })

  it('原请求返回带任务回执的嵌套终态时结束待核对，即使历史没有原幂等键', async () => {
    updateStudioGenerationIntent(scope, intent.itemId, { ...intent, submission })
    vi.mocked(listAiTasks).mockResolvedValue({ items: [{ id: 91, status: 'failed' }] })
    vi.mocked(replayAiTaskSubmission).mockRejectedValue({
      message: '审核未通过',
      status: 502,
      response: { data: { task: { id: 91, status: 'failed' } } },
    })
    const { result } = renderStudioRecovery()
    const notify = vi.fn()
    await act(async () => {})
    await act(async () => result.current.retry(intent.itemId, notify))
    expect(readStudioGenerationIntents(scope)).toEqual([])
    expect(result.current.lockedOperations.has(intent.operation)).toBe(false)
    expect(result.current.retryableItems.has(intent.itemId)).toBe(false)
    expect(result.current.batches[0].items[0]).toMatchObject({ taskId: 91, status: 'failed' })
    expect(notify).not.toHaveBeenCalled()
    expect(resumeShotImageGeneration).not.toHaveBeenCalled()
  })

  it('任务完成但产物暂不可用时解除提交锁，稍后只查同一任务的产物', async () => {
    updateStudioGenerationIntent(scope, intent.itemId, { ...intent, taskId: 92 })
    vi.mocked(resumeShotImageGeneration)
      .mockRejectedValueOnce({ code: 'TASK_MEDIA_PENDING', taskId: 92 })
      .mockResolvedValue({ url: '/later.png', assetId: 701 })
    const { result } = renderStudioRecovery([
      { ...batch, items: [{ id: intent.itemId, status: 'pending', taskId: 92 }] },
    ])
    await act(async () => {})
    expect(result.current.lockedOperations.has(intent.operation)).toBe(false)
    expect(result.current.batches[0].items[0]).toMatchObject({
      taskId: 92,
      status: 'pending',
      error: STUDIO_MEDIA_PENDING,
    })
    expect(readStudioGenerationIntents(scope)).toEqual([{ ...intent, taskId: 92, mediaPending: true }])
    await act(async () => vi.advanceTimersByTimeAsync(25_000))
    expect(resumeShotImageGeneration).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTimeAsync(5_000))
    expect(result.current.batches[0].items[0]).toMatchObject({ taskId: 92, status: 'done', url: '/later.png' })
    expect(readStudioGenerationIntents(scope)).toEqual([])
    expect(replayAiTaskSubmission).not.toHaveBeenCalled()
  })

  it('拒绝其他工作空间或携带媒资临时链接的重试请求', () => {
    expect(readStudioSubmissionIdentity(submission, 21)).toEqual({
      operation: intent.operation,
      idempotencyKey: intent.idempotencyKey,
    })
    expect(() => readStudioSubmissionIdentity(submission, 22)).toThrow('无法安全记录')
    const body = JSON.parse(submission.body)
    expect(() =>
      readStudioSubmissionIdentity(
        {
          ...submission,
          body: JSON.stringify({ ...body, params: { image: 'https://example.invalid/media?signature=fixture' } }),
        },
        21,
      ),
    ).toThrow('无法安全记录')
  })

  it('仅接受匹配任务的终态和首次明确提交拒绝', () => {
    expect(isStudioGenerationRejected(new Error('提交前校验失败'), 0)).toBe(true)
    expect(isStudioGenerationRejected({ status: 422 }, 1)).toBe(true)
    expect(isStudioGenerationRejected({ status: 422 }, 2)).toBe(false)
    expect(isStudioGenerationRejected({ status: 422, submissionMayHaveSucceeded: true }, 1)).toBe(false)
    expect(isStudioGenerationRejected({ status: 503 }, 1)).toBe(false)
    expect(isStudioGenerationRejected({ status: 404 }, 1, 42)).toBe(false)
    expect(isStudioGenerationRejected({ response: { task: { id: 42, status: 'failed' } } }, 1, 42)).toBe(true)
    expect(isStudioGenerationRejected({ response: { id: 9, status: 'failed' } }, 1, 42)).toBe(false)
    expect(isStudioGenerationRejected({ response: { id: 42, status: 'running' } }, 1, 42)).toBe(false)
    expect(isStudioGenerationRejected({ status: 502, response: { data: { id: 42, state: 'FAILED' } } }, 1)).toBe(true)
    expect(
      isStudioGenerationRejected({ status: 422, response: { data: { task: { id: 42, status: 'running' } } } }, 1),
    ).toBe(false)
    expect(isStudioGenerationRejected({ status: 422, response: { data: { id: 41, status: 'failed' } } }, 1, 42)).toBe(
      false,
    )
  })

  it('按工作空间、账号和产物隔离持久化记录', () => {
    updateStudioGenerationIntent(scope, intent.itemId, intent)
    updateStudioGenerationIntent(scope, 'item-2', { ...intent, itemId: 'item-2' })
    expect(readStudioGenerationIntents(studioGenerationStorageKey(22, 7))).toEqual([])
    expect(readStudioGenerationIntents(studioGenerationStorageKey(21, 8))).toEqual([])
    expect(readStudioGenerationIntents(studioGenerationStorageKey(21, 0))).toEqual([])
    expect(() => updateStudioGenerationIntent('', intent.itemId, intent)).toThrow('请登录')
    updateStudioGenerationIntent(scope, intent.itemId)
    expect(readStudioGenerationIntents(scope).map(({ itemId }) => itemId)).toEqual(['item-2'])
  })

  it('本地未确认记录损坏时不把它当作没有待核对项', () => {
    localStorage.setItem(`${scope}:invalid`, 'null')
    expect(() => readStudioGenerationIntents(scope)).toThrow('创作任务记录无法读取')
  })
})
