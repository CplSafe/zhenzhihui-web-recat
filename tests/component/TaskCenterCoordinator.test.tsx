import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskCenterTask } from '@/stores/taskCenter'

const mocks = vi.hoisted(() => ({
  auth: { isAuthenticated: true, isCheckingSession: false },
  workspace: { id: 7, user: { id: 9 } as Record<string, unknown> },
  getAiTask: vi.fn(),
  isVideoGenRunning: vi.fn(),
  persistHotCopyResultToBackend: vi.fn(),
  persistHotCopyTerminalStateToBackend: vi.fn(),
  persistVideoResultToBackend: vi.fn(),
  persistVideoTerminalStateToBackend: vi.fn(),
  resolveTaskVideoResult: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  getAiTask: mocks.getAiTask,
  getBusinessErrorMessage: (error: { message?: string } | null | undefined, fallback: string) =>
    error?.message || fallback,
}))

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => mocks.auth,
}))

vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => mocks.workspace.user,
  useWorkspaceId: () => mocks.workspace.id,
}))

vi.mock('@/stores/ui', () => {
  const useUiStore = Object.assign(vi.fn(), {
    getState: () => ({ showToast: mocks.showToast }),
  })
  return { useUiStore }
})

vi.mock('@/utils/taskMedia', () => ({
  resolveTaskVideoResult: mocks.resolveTaskVideoResult,
}))

vi.mock('@/utils/videoGenRegistry', () => ({
  isVideoGenRunning: mocks.isVideoGenRunning,
}))

vi.mock('@/utils/persistVideoResult', () => ({
  persistVideoResultToBackend: mocks.persistVideoResultToBackend,
  persistVideoTerminalStateToBackend: mocks.persistVideoTerminalStateToBackend,
}))

vi.mock('@/utils/persistHotCopyResult', () => ({
  persistHotCopyResultToBackend: mocks.persistHotCopyResultToBackend,
  persistHotCopyTerminalStateToBackend: mocks.persistHotCopyTerminalStateToBackend,
}))

import TaskCenterCoordinator from '@/components/task/TaskCenterCoordinator'
import { TASK_CENTER_PREPARING_TIMEOUT_MS, useTaskCenterStore } from '@/stores/taskCenter'

function task(overrides: Partial<TaskCenterTask> = {}): TaskCenterTask {
  const now = Date.now()
  return {
    id: 'smart:7:11:generation-1',
    scope: 'smart',
    workspaceId: 7,
    projectId: 11,
    generationId: 'generation-1',
    taskId: 101,
    status: 'processing',
    title: '测试视频',
    ratio: '16:9',
    durationSec: 10,
    thumbnailUrl: '',
    operationCode: 'video.generate',
    startedAt: now - 100,
    updatedAt: now,
    ownerUserId: 9,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function seed(...tasks: TaskCenterTask[]) {
  useTaskCenterStore.setState({ tasks, drawerExpanded: false, ownerUserId: 9 })
}

beforeEach(() => {
  vi.useRealTimers()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  mocks.auth.isAuthenticated = true
  mocks.auth.isCheckingSession = false
  mocks.workspace.id = 7
  mocks.workspace.user = { id: 9 }
  Object.entries(mocks).forEach(([, value]) => {
    if (typeof value === 'function' && 'mockReset' in value) value.mockReset()
  })
  mocks.isVideoGenRunning.mockReturnValue(false)
  mocks.persistHotCopyResultToBackend.mockResolvedValue(true)
  mocks.persistHotCopyTerminalStateToBackend.mockResolvedValue(true)
  mocks.persistVideoResultToBackend.mockResolvedValue(true)
  mocks.persistVideoTerminalStateToBackend.mockResolvedValue(true)
  mocks.resolveTaskVideoResult.mockResolvedValue({ url: '/result.mp4', assetId: 88 })
  seed()
})

describe('TaskCenterCoordinator recovery polling', () => {
  it('updates progress for the current account and workspace without polling unrelated tasks', async () => {
    const current = task()
    const otherWorkspace = task({
      id: 'smart:8:12:generation-2',
      workspaceId: 8,
      projectId: 12,
      generationId: 'generation-2',
      taskId: 102,
    })
    const otherOwner = task({
      id: 'smart:7:13:generation-3',
      projectId: 13,
      generationId: 'generation-3',
      taskId: 103,
      ownerUserId: 10,
    })
    seed(current, otherWorkspace, otherOwner)
    mocks.getAiTask.mockResolvedValue({
      data: {
        task: {
          id: 101,
          operation_code: 'video.generate',
          status: 'RUNNING',
          progress: 42,
          updated_at: new Date(current.updatedAt + 1000).toISOString(),
        },
      },
    })

    render(<TaskCenterCoordinator />)

    await waitFor(() => {
      expect(useTaskCenterStore.getState().tasks.find((item) => item.taskId === 101)).toMatchObject({
        status: 'processing',
        progress: 42,
      })
    })
    expect(mocks.getAiTask).toHaveBeenCalledOnce()
    expect(mocks.getAiTask).toHaveBeenCalledWith({ workspaceId: 7, taskId: 101 })
    expect(useTaskCenterStore.getState().tasks.find((item) => item.taskId === 102)?.progress).toBeUndefined()
    expect(useTaskCenterStore.getState().tasks.find((item) => item.taskId === 103)?.progress).toBeUndefined()
  })

  it('persists a completed result once, emits one notification, and stops polling the terminal task', async () => {
    seed(task())
    mocks.getAiTask.mockResolvedValue({
      task: { id: 101, operationCode: 'video.generate', status: 'completed', progress: 100 },
    })

    render(<TaskCenterCoordinator />)

    await waitFor(() =>
      expect(useTaskCenterStore.getState().tasks[0]).toMatchObject({
        status: 'succeeded',
        progress: 100,
        resultUrl: '/result.mp4',
        resultAssetId: 88,
      }),
    )
    expect(mocks.persistVideoResultToBackend).toHaveBeenCalledOnce()
    expect(mocks.persistVideoResultToBackend).toHaveBeenCalledWith({
      projectId: 11,
      workspaceId: 7,
      url: '/result.mp4',
      assetId: 88,
      taskId: 101,
      genId: 'generation-1',
    })
    expect(mocks.showToast).toHaveBeenCalledOnce()
    expect(mocks.showToast).toHaveBeenCalledWith('测试视频生成完成', 'success')

    window.dispatchEvent(new Event('focus'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.getAiTask).toHaveBeenCalledOnce()
  })

  it('does not duplicate an in-flight request when focus fires during polling', async () => {
    const request = deferred<unknown>()
    seed(task())
    mocks.getAiTask.mockReturnValue(request.promise)

    render(<TaskCenterCoordinator />)
    await waitFor(() => expect(mocks.getAiTask).toHaveBeenCalledOnce())

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
    expect(mocks.getAiTask).toHaveBeenCalledOnce()

    request.resolve({ task: { id: 101, operationCode: 'video.generate', status: 'running', progress: 12 } })
    await waitFor(() => expect(useTaskCenterStore.getState().tasks[0]?.progress).toBe(12))
    expect(mocks.getAiTask).toHaveBeenCalledOnce()
  })

  it('ignores a response that arrives after switching workspace', async () => {
    const request = deferred<unknown>()
    const original = task()
    seed(original)
    mocks.getAiTask.mockReturnValue(request.promise)

    const view = render(<TaskCenterCoordinator />)
    await waitFor(() => expect(mocks.getAiTask).toHaveBeenCalledOnce())

    mocks.workspace.id = 8
    view.rerender(<TaskCenterCoordinator />)
    request.resolve({ task: { id: 101, operationCode: 'video.generate', status: 'completed', progress: 100 } })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useTaskCenterStore.getState().tasks[0]).toMatchObject({ status: 'processing', workspaceId: 7 })
    expect(mocks.resolveTaskVideoResult).not.toHaveBeenCalled()
    expect(mocks.persistVideoResultToBackend).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('cannot apply an old account response to a same-project task owned by the next account', async () => {
    const oldRequest = deferred<unknown>()
    seed(task())
    mocks.getAiTask.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce({
      task: { id: 101, operationCode: 'video.generate', status: 'running', progress: 24 },
    })

    const view = render(<TaskCenterCoordinator />)
    await waitFor(() => expect(mocks.getAiTask).toHaveBeenCalledOnce())

    mocks.workspace.user = { id: 10 }
    view.rerender(<TaskCenterCoordinator />)
    await waitFor(() => expect(useTaskCenterStore.getState().ownerUserId).toBe(10))
    act(() => {
      useTaskCenterStore.setState({
        tasks: [task({ ownerUserId: 10 })],
        drawerExpanded: false,
        ownerUserId: 10,
      })
    })
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(mocks.getAiTask).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(useTaskCenterStore.getState().tasks[0]?.progress).toBe(24))

    oldRequest.resolve({ task: { id: 101, operationCode: 'video.generate', status: 'completed', progress: 100 } })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useTaskCenterStore.getState().tasks[0]).toMatchObject({
      ownerUserId: 10,
      status: 'processing',
      progress: 24,
    })
    expect(mocks.resolveTaskVideoResult).not.toHaveBeenCalled()
    expect(mocks.persistVideoResultToBackend).not.toHaveBeenCalled()
  })

  it('fails closed without querying when one backend task ID is linked to multiple local projects', async () => {
    seed(
      task(),
      task({
        id: 'smart:7:12:generation-2',
        projectId: 12,
        generationId: 'generation-2',
      }),
    )

    render(<TaskCenterCoordinator />)

    await waitFor(() => {
      expect(useTaskCenterStore.getState().tasks).toEqual([
        expect.objectContaining({ status: 'failed', error: expect.stringContaining('任务关联冲突') }),
        expect.objectContaining({ status: 'failed', error: expect.stringContaining('任务关联冲突') }),
      ])
    })
    expect(mocks.getAiTask).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledTimes(2)
  })

  it('keeps recoverable errors retryable and reconciles missing tasks as terminal failures', async () => {
    seed(task())
    mocks.getAiTask.mockRejectedValueOnce({ status: 401, message: 'unauthorized' })

    const view = render(<TaskCenterCoordinator />)
    await waitFor(() =>
      expect(useTaskCenterStore.getState().tasks[0]).toMatchObject({
        status: 'reconnecting',
        error: '登录状态已变化，正在等待会话恢复',
      }),
    )
    expect(mocks.persistVideoTerminalStateToBackend).not.toHaveBeenCalled()

    view.unmount()
    seed(task())
    mocks.getAiTask.mockRejectedValueOnce({ status: 404, message: 'not found' })
    render(<TaskCenterCoordinator />)

    await waitFor(() => expect(useTaskCenterStore.getState().tasks[0]?.status).toBe('failed'))
    expect(useTaskCenterStore.getState().tasks[0]?.error).toBe('生成任务已失效')
    expect(mocks.persistVideoTerminalStateToBackend).toHaveBeenCalledWith({
      projectId: 11,
      workspaceId: 7,
      taskId: 101,
      genId: 'generation-1',
      status: 'failed',
      error: '生成任务已失效',
    })
  })

  it('marks an abandoned pre-submit task failed only after project state is persisted', async () => {
    const now = Date.now()
    seed(
      task({
        taskId: 0,
        status: 'preparing',
        startedAt: now - TASK_CENTER_PREPARING_TIMEOUT_MS - 1,
        updatedAt: now - TASK_CENTER_PREPARING_TIMEOUT_MS - 1,
      }),
    )

    render(<TaskCenterCoordinator />)

    await waitFor(() => expect(useTaskCenterStore.getState().tasks[0]?.status).toBe('failed'))
    expect(mocks.getAiTask).not.toHaveBeenCalled()
    expect(mocks.persistVideoTerminalStateToBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 11,
        workspaceId: 7,
        taskId: 0,
        status: 'failed',
        error: '任务在提交前中断，请重新发起生成',
      }),
    )
  })

  it('leaves locally managed generation promises to the page coordinator', async () => {
    seed(task())
    mocks.isVideoGenRunning.mockReturnValue(true)

    render(<TaskCenterCoordinator />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.getAiTask).not.toHaveBeenCalled()
    expect(useTaskCenterStore.getState().tasks[0]?.status).toBe('processing')
  })

  it('leaves image tasks to the image-generation recovery flow', async () => {
    seed(
      task({
        id: 'smart:7:11:image-generation-1',
        scope: 'smart',
        generationId: 'image-generation-1',
        operationCode: 'image.text_to_image',
        title: '商品主图',
      }),
    )

    render(<TaskCenterCoordinator />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.getAiTask).not.toHaveBeenCalled()
    expect(mocks.persistVideoResultToBackend).not.toHaveBeenCalled()
    expect(mocks.persistHotCopyResultToBackend).not.toHaveBeenCalled()
    expect(useTaskCenterStore.getState().tasks[0]).toMatchObject({
      operationCode: 'image.text_to_image',
      status: 'processing',
    })
  })
})
