import { describe, expect, it } from 'vitest'
import { getCanvasTaskPresentation, isSameCanvasTask, restoreCanvasTaskState } from '@/utils/canvasTaskState'

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
