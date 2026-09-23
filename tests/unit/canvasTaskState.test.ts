import { describe, expect, it } from 'vitest'
import {
  formatCanvasElapsed,
  getCanvasEstimatedVideoProgress,
  getCanvasGenerationDuration,
  getCanvasTaskPresentation,
  isCanvasGeneratedResult,
  isSameCanvasTask,
  restoreCanvasTaskState,
} from '@/utils/canvasTaskState'

describe('canvas task restoration', () => {
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

  it('does not trigger payment settlement just by restoring a canvas', () => {
    const saved = { taskId: 15318, taskStatus: 'payment_failed', taskError: 'insufficient credits' }
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

describe('canvas task presentation', () => {
  it('distinguishes restoration from a new generation and hides stale progress', () => {
    expect(getCanvasTaskPresentation({ status: 'reconnecting', progress: 70, error: 'old error' })).toEqual({
      running: true,
      failed: false,
      title: '正在核对任务状态',
      detail: '正在读取上次任务的最新状态',
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
