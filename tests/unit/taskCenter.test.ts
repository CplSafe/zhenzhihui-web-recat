import { beforeEach, describe, expect, it } from 'vitest'
import type { TaskCenterTask } from '../../src/stores/taskCenter'

const storage = window.localStorage

const {
  TASK_CENTER_ACTIVE_TIMEOUT_MS,
  TASK_CENTER_PREPARING_TIMEOUT_MS,
  TASK_CENTER_STORAGE_KEY,
  buildTaskCenterId,
  getTaskCenterExpirationReason,
  isTaskCenterActiveStatus,
  isTaskCenterTerminalStatus,
  useTaskCenterStore,
} = await import('../../src/stores/taskCenter')

function task(overrides: Partial<TaskCenterTask> = {}): TaskCenterTask {
  const now = Date.now()
  const base: TaskCenterTask = {
    id: 'ignored-by-normalization',
    scope: 'smart',
    workspaceId: 7,
    projectId: 11,
    generationId: 'generation-1',
    taskId: 101,
    status: 'processing',
    title: '测试视频',
    ratio: '16:9',
    durationSec: 10,
    thumbnailUrl: '/api/v1/assets/1/download?workspace_id=7',
    operationCode: 'video.generate',
    startedAt: now - 100,
    updatedAt: now,
    ownerUserId: 9,
  }
  return { ...base, ...overrides }
}

function resetStore(): void {
  storage.clear()
  useTaskCenterStore.setState({ tasks: [], drawerExpanded: false, ownerUserId: 0 })
  storage.clear()
}

beforeEach(resetStore)

describe('task-center identity and status helpers', () => {
  it('builds a stable normalized id', () => {
    expect(buildTaskCenterId('smart', 21.8, 12.9, '  gen-1  ')).toBe('smart:21:12:gen-1')
    expect(buildTaskCenterId('hot-copy', -1, -3, '')).toBe('hot-copy:0:0:default')
    expect(buildTaskCenterId('image', 21, 12, '  image-1  ')).toBe('image:21:12:image-1')
  })

  it.each(['preparing', 'queued', 'processing', 'reconnecting'])('recognizes %s as active', (status) => {
    expect(isTaskCenterActiveStatus(status)).toBe(true)
    expect(isTaskCenterTerminalStatus(status)).toBe(false)
  })

  it.each(['succeeded', 'failed', 'cancelled'])('recognizes %s as terminal', (status) => {
    expect(isTaskCenterTerminalStatus(status)).toBe(true)
    expect(isTaskCenterActiveStatus(status)).toBe(false)
  })

  it('expires task-less preparing work only after its timeout boundary', () => {
    const now = 1_800_000_000_000
    const preparing = task({
      taskId: 0,
      status: 'preparing',
      startedAt: now - TASK_CENTER_PREPARING_TIMEOUT_MS,
      updatedAt: now - TASK_CENTER_PREPARING_TIMEOUT_MS,
    })

    expect(getTaskCenterExpirationReason(preparing, now)).toBe('')
    expect(getTaskCenterExpirationReason({ ...preparing, updatedAt: preparing.updatedAt - 1 }, now)).toBe(
      '任务在提交前中断，请重新发起生成',
    )
  })

  it('expires other active work after the active timeout, but never terminal work', () => {
    const now = 1_800_000_000_000
    const stale = task({
      status: 'processing',
      updatedAt: now - TASK_CENTER_ACTIVE_TIMEOUT_MS - 1,
    })

    expect(getTaskCenterExpirationReason(stale, now)).toBe('任务长时间未更新，请进入项目确认')
    expect(getTaskCenterExpirationReason({ ...stale, status: 'failed' }, now)).toBe('')
  })
})

describe('task-center store normalization and terminal transitions', () => {
  it('keeps backend progress in the canonical 0..100 percentage scale', () => {
    useTaskCenterStore.getState().upsertTask(task({ progress: 0.5 }))

    expect(useTaskCenterStore.getState().tasks[0]?.progress).toBe(0.5)
  })

  it('normalizes task identity and numeric fields at the store boundary', () => {
    useTaskCenterStore.getState().upsertTask(
      task({
        id: 'wrong-id',
        workspaceId: 7.9,
        projectId: 11.8,
        taskId: 101.9,
        durationSec: -5,
        progress: 120,
        title: '   ',
      }),
    )

    expect(useTaskCenterStore.getState().tasks[0]).toMatchObject({
      id: 'smart:7:11:generation-1',
      workspaceId: 7,
      projectId: 11,
      taskId: 101,
      durationSec: 0,
      progress: 100,
      title: '视频生成任务',
    })
  })

  it('preserves image scope and gives image tasks a matching fallback title', () => {
    useTaskCenterStore.getState().upsertTask(
      task({
        id: 'wrong-id',
        scope: 'image',
        generationId: 'image-1',
        title: '   ',
        durationSec: 0,
        operationCode: 'image.text_to_image',
      }),
    )

    expect(useTaskCenterStore.getState().tasks[0]).toMatchObject({
      id: 'image:7:11:image-1',
      scope: 'image',
      title: '图片生成任务',
    })

    useTaskCenterStore.getState().upsertTask(
      task({
        id: 'smart:7:12:legacy-image',
        scope: 'smart',
        projectId: 12,
        generationId: 'legacy-image',
        operationCode: 'image.image_to_image',
      }),
    )
    expect(useTaskCenterStore.getState().tasks.find((item) => item.projectId === 12)).toMatchObject({
      id: 'image:7:12:legacy-image',
      scope: 'image',
    })
  })

  it('forces every succeeded task to 100 percent', () => {
    useTaskCenterStore.getState().upsertTask(task({ status: 'succeeded', progress: 1 }))
    expect(useTaskCenterStore.getState().tasks[0]?.progress).toBe(100)

    useTaskCenterStore.getState().patchTask('smart:7:11:generation-1', { status: 'succeeded', progress: 27 })
    expect(useTaskCenterStore.getState().tasks[0]?.progress).toBe(100)
  })

  it('keeps otherwise-identical generations separate across workspaces', () => {
    useTaskCenterStore.getState().upsertTask(task({ workspaceId: 7, title: '空间 7' }))
    useTaskCenterStore.getState().upsertTask(task({ workspaceId: 8, title: '空间 8' }))

    expect(useTaskCenterStore.getState().tasks).toHaveLength(2)
    expect(useTaskCenterStore.getState().tasks.map((item) => item.id)).toEqual(
      expect.arrayContaining(['smart:7:11:generation-1', 'smart:8:11:generation-1']),
    )
  })

  it('clears stale terminal output when the same generation is restarted', () => {
    useTaskCenterStore.getState().upsertTask(
      task({
        status: 'failed',
        progress: 73,
        resultUrl: '/old-result.mp4',
        resultAssetId: 88,
        error: '旧错误',
        archived: true,
        notifiedAt: 1_700_000_000_200,
      }),
    )

    useTaskCenterStore.getState().upsertTask(
      task({
        taskId: 0,
        status: 'preparing',
        progress: undefined,
        resultUrl: undefined,
        resultAssetId: undefined,
        error: undefined,
        archived: undefined,
        notifiedAt: undefined,
      }),
    )

    const restarted = useTaskCenterStore.getState().tasks[0]
    expect(restarted).toMatchObject({ status: 'preparing', taskId: 0, archived: false })
    expect(restarted?.progress).toBeUndefined()
    expect(restarted?.resultUrl).toBeUndefined()
    expect(restarted?.resultAssetId).toBeUndefined()
    expect(restarted?.error).toBeUndefined()
    expect(restarted?.notifiedAt).toBeUndefined()
  })

  it('clears tasks on account switch and assigns the active owner to new tasks', () => {
    useTaskCenterStore.getState().upsertTask(task({ ownerUserId: 9 }))
    useTaskCenterStore.getState().setOwnerUserId(20)

    expect(useTaskCenterStore.getState().tasks).toEqual([])
    expect(useTaskCenterStore.getState().ownerUserId).toBe(20)

    useTaskCenterStore.getState().upsertTask(task({ ownerUserId: undefined }))
    expect(useTaskCenterStore.getState().tasks[0]?.ownerUserId).toBe(20)
  })
})

describe('task-center persistence', () => {
  it('persists durable task metadata but strips temporary media URLs', () => {
    useTaskCenterStore.getState().setOwnerUserId(9)
    useTaskCenterStore.getState().upsertTask(
      task({
        status: 'succeeded',
        progress: 100,
        resultUrl: '/api/v1/assets/88/download?workspace_id=7',
        resultAssetId: 88,
        error: 'provider failed: https://bucket.example/result?token=secret',
      }),
    )
    useTaskCenterStore.getState().setDrawerExpanded(true)

    const raw = storage.getItem(TASK_CENTER_STORAGE_KEY)
    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw || '{}')
    const persistedTask = persisted.state.tasks[0]

    expect(persisted.version).toBe(1)
    expect(persisted.state.drawerExpanded).toBe(true)
    expect(persisted.state.ownerUserId).toBe(9)
    expect(persistedTask).toMatchObject({
      id: 'smart:7:11:generation-1',
      ownerUserId: 9,
      status: 'succeeded',
      progress: 100,
      resultAssetId: 88,
      thumbnailUrl: '',
    })
    expect(persistedTask.resultUrl).toBeUndefined()
    expect(persistedTask.error).toBeUndefined()
    expect(raw).not.toContain('token=secret')

    const liveTask = useTaskCenterStore.getState().tasks[0]
    expect(liveTask?.thumbnailUrl).not.toBe('')
    expect(liveTask?.resultUrl).toContain('/api/v1/assets/88/download')
  })
})
