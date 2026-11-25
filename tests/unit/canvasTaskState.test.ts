import { describe, expect, it } from 'vitest'
import {
  CANVAS_SUBMIT_STALE_MS,
  classifyOrphanSubmission,
  formatCanvasElapsed,
  getCanvasEstimatedVideoProgress,
  getCanvasGenerationDuration,
  getCanvasTaskPresentation,
  isCanvasGeneratedResult,
  isCanvasSubmissionUnresolved,
  isSameCanvasTask,
  preserveCompletedCanvasResults,
  restoreCanvasTaskState,
} from '@/utils/canvasTaskState'

describe('canvas task restoration', () => {
  it('刷新后保留原超分提交身份，等待核对 TaskID', () => {
    const request = { kind: 'video', operationCode: 'video.upscale', modelVersionId: 8, params: { scale: 2 } }
    const data = {
      taskStatus: 'submitting',
      taskStartedAt: new Date().toISOString(),
      taskIdempotencyKey: 'upscale-original',
      videoUpscaleRequest: request,
    }
    expect(classifyOrphanSubmission(data, { now: Date.now(), submittingInThisPage: false })).toBe('unknown')
    expect(isCanvasSubmissionUnresolved(data)).toBe(true)
    expect(data.taskIdempotencyKey).toBe('upscale-original')
  })
  it.each(['failed', 'error', 'cancelled', 'expired', 'result_sync_failed', 'reconnecting'])(
    'rechecks a saved %s task without showing its cached error',
    (taskStatus) => {
      const saved = {
        taskId: 15318,
        taskRunId: 'old',
        taskStatus,
        taskError: 'cached error',
        taskStatusQueryFailures: 6,
        prompt: 'image',
        assetId: 12,
      }
      expect(restoreCanvasTaskState(saved)).toEqual({
        ...saved,
        taskStatus: 'reconnecting',
        taskError: '',
        taskErrorHistorical: true,
        taskStatusQueryFailures: 0,
      })
      expect(saved.taskError).toBe('cached error')
      expect(saved.taskStatus).toBe(taskStatus)
    },
  )

  it('labels a failed submission without a server task as historical without starting polling', () => {
    const saved = { taskId: 0, taskStatus: 'submit_failed', taskError: 'invalid inputs' }
    expect(restoreCanvasTaskState(saved)).toEqual({ ...saved, taskErrorHistorical: true })
  })

  it.each(['reconnecting', 'status_query_failed'])(
    'stops showing %s if the original task has no usable ID',
    (taskStatus) => {
      const saved = { taskId: 0, taskStatus, taskIdempotencyKey: 'existing-key' }
      expect(restoreCanvasTaskState(saved)).toMatchObject({
        taskStatus: 'submission_unknown',
        taskError: expect.stringContaining('核对任务记录'),
        taskSubmitInterrupted: true,
        taskIdempotencyKey: 'existing-key',
      })
    },
  )

  it('restores an interrupted submission without losing its ID or previous visible result', () => {
    const saved = { taskId: 15318, taskStatus: 'submission_unknown', assetId: 42, taskIdempotencyKey: 'same' }
    expect(restoreCanvasTaskState(saved)).toMatchObject({ ...saved, taskStatus: 'reconnecting' })
  })

  it('keeps a completed task with a delayed asset out of the generation-failure state', () => {
    const saved = { taskId: 15318, taskStatus: 'failed', taskError: '任务已完成，但结果同步超时，请重试' }
    expect(restoreCanvasTaskState(saved)).toMatchObject({ taskId: 15318, taskStatus: 'result_sync_delayed' })
    expect(getCanvasTaskPresentation({ status: 'result_sync_delayed' })).toMatchObject({ failed: false })
  })

  it('does not trigger payment settlement just by restoring a canvas', () => {
    const saved = { taskId: 15318, taskStatus: 'payment_failed', taskError: 'insufficient credits' }
    expect(restoreCanvasTaskState(saved)).toEqual({ ...saved, taskErrorHistorical: true })
  })

  it('recognizes a saved query failure as a previous task so a missing record can be handled', () => {
    const saved = { taskId: 15318, taskStatus: 'status_query_failed', taskError: '查询暂不可用' }
    expect(restoreCanvasTaskState(saved)).toEqual({ ...saved, taskErrorHistorical: true })
  })

  it.each(['processing', 'succeeded', undefined])('leaves %s nodes unchanged', (taskStatus) => {
    const saved = { taskId: 15318, taskStatus, resultUrl: '/image.png' }
    expect(restoreCanvasTaskState(saved)).toBe(saved)
  })
})

describe('canvas task response ownership', () => {
  it('rejects an old response while a new generation has no server task ID yet', () => {
    expect(isSameCanvasTask({ taskId: 0, taskRunId: 'new' }, { taskId: 15318, taskRunId: 'old' })).toBe(false)
  })

  it('rejects an old generation even if a restored snapshot has the same task ID', () => {
    expect(isSameCanvasTask({ taskId: 15318, taskRunId: 'new' }, { taskId: 15318, taskRunId: 'old' })).toBe(false)
  })

  it('accepts matching current and legacy task identities', () => {
    expect(isSameCanvasTask({ taskId: 15320, taskRunId: 'new' }, { taskId: 15320, taskRunId: 'new' })).toBe(true)
    expect(isSameCanvasTask({ taskId: 15318 }, { taskId: 15318 })).toBe(true)
    expect(isSameCanvasTask({}, {})).toBe(false)
  })
})

describe('merging a completed canvas generation', () => {
  const node = {
    id: 'image',
    position: { x: 0, y: 0 },
    data: { kind: 'image', taskRunId: 'run', taskIdempotencyKey: 'submission' },
  }
  const completed = {
    ...node,
    data: {
      ...node.data,
      title: 'original name',
      taskId: 42,
      taskStatus: 'succeeded',
      assetId: 203,
      resultHistory: [
        { assetId: 172, taskId: 35 },
        { assetId: 203, taskId: 42 },
      ],
      imageResultAssetIds: [203],
    },
  }
  const stale = {
    ...node,
    position: { x: 90, y: 50 },
    data: {
      ...node.data,
      title: 'collaborator name',
      prompt: 'new edit',
      taskStatus: 'submission_unknown',
      taskFailure: { stage: 'unknown' },
      taskError: 'pending',
      taskId: 0,
    },
  }

  it('restores the same submission result without reverting collaborative edits', () => {
    const [merged] = preserveCompletedCanvasResults([completed], [stale])
    expect(merged.position).toEqual(stale.position)
    expect(merged.data).toMatchObject({
      title: stale.data.title,
      prompt: stale.data.prompt,
      taskId: 42,
      taskStatus: 'succeeded',
      taskProgress: 100,
      taskError: '',
      assetId: 203,
      resultHistory: completed.data.resultHistory,
      imageResultAssetIds: [203],
    })
    expect(merged.data.taskFailure).toBeUndefined()
  })

  it('can restore from a matching TaskID over a stale snapshot showing the previous generation', () => {
    const [merged] = preserveCompletedCanvasResults(
      [completed],
      [{ ...stale, data: { kind: 'image', taskId: 42, taskStatus: 'processing', assetId: 172 } }],
    )
    expect(merged.data).toMatchObject({ taskId: 42, taskStatus: 'succeeded', assetId: 203 })
  })

  it.each([
    { taskRunId: 'new run' },
    { taskIdempotencyKey: 'new submission' },
    { taskId: 99 },
    { taskIdempotencyKey: undefined },
    { assetId: 999 },
    { resultUrl: 'blob:new-upload' },
    { taskStatus: 'failed', taskId: 42 },
    { taskStatus: '' },
  ])('leaves unrelated edits and definitive states intact (%o)', (change) => {
    const incoming = [{ ...stale, data: { ...stale.data, ...change } }]
    expect(preserveCompletedCanvasResults([completed], incoming)).toBe(incoming)
  })

  it('does not restore a missing node or an output with no matching task history', () => {
    expect(preserveCompletedCanvasResults([completed], [])).toEqual([])
    const incoming = [stale]
    const unverified = { ...completed, data: { ...completed.data, taskId: 99 } }
    expect(preserveCompletedCanvasResults([unverified], incoming)).toBe(incoming)
  })
})

describe('canvas task presentation', () => {
  it('distinguishes restoration from a new generation and hides stale progress', () => {
    expect(getCanvasTaskPresentation({ status: 'reconnecting', progress: 70, error: 'old error' })).toEqual({
      running: true,
      failed: false,
      title: '正在恢复任务',
      detail: '获取最新进度…',
    })
  })
  it('does not invent a percentage when the backend has not returned one', () => {
    const state = getCanvasTaskPresentation({ status: 'processing', progress: 0 })
    expect(state.running).toBe(true)
    expect(state.progress).toBeUndefined()
    expect(state.detail).not.toContain('%')
  })

  it('keeps completed tasks visible while their result is synchronizing', () => {
    const state = getCanvasTaskPresentation({ status: 'result_pending', progress: 72, hasResult: false })
    expect(state).toMatchObject({ running: true, failed: false, progress: 72 })
    expect(state.title).toContain('同步')
  })

  it('stops the loading state once a successful task has a result', () => {
    expect(getCanvasTaskPresentation({ status: 'succeeded', hasResult: true }).running).toBe(false)
  })

  it('surfaces repeated query failures without misclassifying generation as failed', () => {
    expect(
      getCanvasTaskPresentation({
        status: 'status_query_failed',
        error: '任务状态暂时无法查询，将继续自动重试',
      }),
    ).toMatchObject({
      running: true,
      failed: false,
      title: '任务状态查询异常',
      detail: '任务状态暂时无法查询，将继续自动重试',
    })
  })
})

describe('canvas generation elapsed label', () => {
  it.each([
    [0, '0 秒'],
    [59, '59 秒'],
    [60, '1 分 00 秒'],
    [65, '1 分 05 秒'],
    [3599, '59 分 59 秒'],
    [3720, '1 小时 02 分'],
  ])('formats %s seconds as %s', (seconds, label) => {
    expect(formatCanvasElapsed(seconds)).toBe(label)
  })

  it.each([-1, Number.NaN, 'abc', undefined])('returns an empty label for %s', (value) => {
    expect(formatCanvasElapsed(value)).toBe('')
  })
})

describe('canvas video estimated progress', () => {
  it.each([
    [null, 0],
    [0, 0],
    [1, 1.57],
    [2, 2.91],
  ])('maps %s elapsed seconds to %s percent', (seconds, progress) => {
    expect(getCanvasEstimatedVideoProgress(seconds)).toBe(progress)
  })

  it('advances by varying amounts without reaching 100% before the task completes', () => {
    const values = Array.from({ length: 180 }, (_, index) => getCanvasEstimatedVideoProgress(index + 1))
    expect(values[1] - values[0]).not.toBeCloseTo(values[2] - values[1])
    expect(values.every((value, index) => index === 0 || value >= values[index - 1])).toBe(true)
    expect(values[179]).toBeGreaterThan(values[90])
    expect(getCanvasEstimatedVideoProgress(86_400)).toBeLessThan(100)
  })

  it('ignores invalid and negative elapsed times', () => {
    expect(getCanvasEstimatedVideoProgress(Number.NaN)).toBe(0)
    expect(getCanvasEstimatedVideoProgress(-1)).toBe(0)
  })
})

describe('canvas generated result marker', () => {
  const history = [
    { assetId: 11, kind: 'image' },
    { assetId: 12, kind: 'image' },
  ]

  it('marks the node when the displayed asset is a recorded generation result', () => {
    expect(isCanvasGeneratedResult({ assetId: 12, resultHistory: history })).toBe(true)
    // 回退到更早的一版仍然是生成结果
    expect(isCanvasGeneratedResult({ assetId: 11, resultHistory: history })).toBe(true)
  })

  it('does not mark an asset that replaced the generated result', () => {
    expect(isCanvasGeneratedResult({ assetId: 99, taskStatus: 'succeeded', resultHistory: history })).toBe(false)
    expect(isCanvasGeneratedResult({ assetId: 12 })).toBe(false)
    expect(isCanvasGeneratedResult({ resultHistory: history })).toBe(false)
  })

  it('reports the duration of the last successful generation only', () => {
    const base = { taskStartedAt: '2026-09-23T10:00:00.000Z', taskUpdatedAt: '2026-09-23T10:01:05.000Z' }
    expect(getCanvasGenerationDuration({ ...base, taskStatus: 'succeeded' })).toBe(65)
    expect(getCanvasGenerationDuration({ ...base, taskStatus: 'processing' })).toBeNull()
    expect(getCanvasGenerationDuration({ taskStatus: 'succeeded', taskStartedAt: base.taskStartedAt })).toBeNull()
    expect(
      getCanvasGenerationDuration({
        taskStatus: 'succeeded',
        taskStartedAt: base.taskUpdatedAt,
        taskUpdatedAt: base.taskStartedAt,
      }),
    ).toBeNull()
  })
})

describe('orphan canvas submissions (stuck in submitting without a task id)', () => {
  const now = Date.parse('2026-10-09T10:00:00Z')
  const request = { kind: 'image', prompt: '一只狗', operationCode: 'image.text_to_image' }
  const orphan = (minutesAgo: number, extra: Record<string, unknown> = {}) => ({
    taskStatus: 'submitting',
    taskId: 0,
    taskStartedAt: new Date(now - minutesAgo * 60_000).toISOString(),
    taskIdempotencyKey: 'canvas-task-abc',
    generationRequest: request,
    ...extra,
  })

  it('classifies a recent unconfirmed submission as unknown', () => {
    expect(classifyOrphanSubmission(orphan(2), { now, submittingInThisPage: false })).toBe('unknown')
  })

  it('lets the original submitter check sooner than a collaborator', () => {
    const own = { now, currentUserId: 7, submittingInThisPage: false }
    expect(classifyOrphanSubmission(orphan(2, { taskSubmitterId: 7 }), own)).toBe('unknown')
    expect(classifyOrphanSubmission(orphan(2, { taskSubmitterId: 8 }), own)).toBe('none')
    expect(classifyOrphanSubmission(orphan(2), own)).toBe('none')
    expect(classifyOrphanSubmission(orphan(20, { taskSubmitterId: 8 }), own)).toBe('unknown')
  })

  it('leaves submissions this page is still sending alone', () => {
    expect(classifyOrphanSubmission(orphan(2), { now, submittingInThisPage: true })).toBe('none')
  })

  it('keeps long-unconfirmed submissions unresolved', () => {
    const minutes = CANVAS_SUBMIT_STALE_MS / 60_000 + 1
    expect(classifyOrphanSubmission(orphan(minutes), { now, submittingInThisPage: false })).toBe('unknown')
    // 线上那条卡了 20 多小时的节点
    expect(classifyOrphanSubmission(orphan(20 * 60), { now, submittingInThisPage: false })).toBe('unknown')
  })

  it('cannot resume legacy nodes saved before idempotency keys were stored', () => {
    expect(
      classifyOrphanSubmission(orphan(1, { taskIdempotencyKey: undefined }), { now, submittingInThisPage: false }),
    ).toBe('unknown')
  })

  it('ignores nodes that already have a task id or are not submitting', () => {
    expect(classifyOrphanSubmission(orphan(30, { taskId: 88 }), { now, submittingInThisPage: false })).toBe('none')
    expect(classifyOrphanSubmission(orphan(30, { taskStatus: 'running' }), { now, submittingInThisPage: false })).toBe(
      'none',
    )
  })

  it('blocks another creation for legacy unknown and no-ID upscale reservations', () => {
    expect(isCanvasSubmissionUnresolved({ taskStatus: 'submit_failed', taskSubmitInterrupted: true })).toBe(true)
    expect(isCanvasSubmissionUnresolved({ taskStatus: 'queued', taskIdempotencyKey: 'old-hd' })).toBe(true)
    expect(isCanvasSubmissionUnresolved({ taskStatus: 'submit_failed', taskFailure: { stage: 'rejected' } })).toBe(
      false,
    )
    expect(isCanvasSubmissionUnresolved({ taskStatus: 'submission_unknown', taskId: 42 })).toBe(false)
  })
})
