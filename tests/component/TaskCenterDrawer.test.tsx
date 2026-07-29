import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskCenterTask } from '@/stores/taskCenter'

const mocks = vi.hoisted(() => ({
  workspace: { id: 7, user: { id: 9 } as Record<string, unknown> },
  deriveProjectVideos: vi.fn(),
  getAssetDownloadUrl: vi.fn(),
  listAllCreativeProjects: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mocks.navigate }
})

vi.mock('@/api/business', () => ({
  getAssetDownloadUrl: mocks.getAssetDownloadUrl,
}))

vi.mock('@/api/projectVideos', () => ({
  deriveProjectVideos: mocks.deriveProjectVideos,
}))

vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => mocks.workspace.user,
  useWorkspaceId: () => mocks.workspace.id,
}))

vi.mock('@/utils/businessPagination', () => ({
  listAllCreativeProjects: mocks.listAllCreativeProjects,
}))

vi.mock('@/components/common/VideoPreviewModal', () => ({
  default: ({ src, onClose }: { src: string; onClose: () => void }) =>
    src ? (
      <div role="dialog" aria-label="视频预览">
        <span>{src}</span>
        <button type="button" onClick={onClose}>
          关闭预览
        </button>
      </div>
    ) : null,
}))

import TaskCenterDrawer from '@/components/task/TaskCenterDrawer'
import { useTaskCenterStore } from '@/stores/taskCenter'

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
    title: '当前任务',
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
  useTaskCenterStore.setState({ tasks, drawerExpanded: true, ownerUserId: 9 })
}

function project(id: number, videos: unknown[] = []) {
  return { id, title: `项目 ${id}`, videos }
}

function historyVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    projectId: 11,
    status: 'published',
    videoUrl: '/history.mp4',
    videoAssetId: 88,
    manual: false,
    title: '历史任务',
    flow: 'smart',
    ratio: '16:9',
    durationSeconds: 12,
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T10:01:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  mocks.workspace.id = 7
  mocks.workspace.user = { id: 9 }
  Object.entries(mocks).forEach(([, value]) => {
    if (typeof value === 'function' && 'mockReset' in value) value.mockReset()
  })
  mocks.deriveProjectVideos.mockImplementation(({ project: item }: { project: { videos?: unknown[] } }) =>
    Array.isArray(item.videos) ? item.videos : [],
  )
  mocks.listAllCreativeProjects.mockResolvedValue([project(11)])
  seed()
})

describe('TaskCenterDrawer isolation and reconciliation', () => {
  it('shows active and queued work from every scope in the generating tab', async () => {
    const user = userEvent.setup()
    seed(
      task({ id: 'smart:7:11:active', generationId: 'active', title: '智能生成中', status: 'processing' }),
      task({
        id: 'hot-copy:7:11:queued',
        scope: 'hot-copy',
        generationId: 'queued',
        title: '翻拍排队中',
        status: 'queued',
      }),
      task({ id: 'smart:7:11:done', generationId: 'done', title: '已完成任务', status: 'succeeded' }),
    )

    render(<TaskCenterDrawer scope="smart" />)
    expect(await screen.findByText('已完成任务')).toBeInTheDocument()
    expect(screen.queryByText('智能生成中')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '正在生成' }))

    expect(await screen.findByText('智能生成中')).toBeInTheDocument()
    expect(screen.getByText('翻拍排队中')).toBeInTheDocument()
    expect(screen.queryByText('已完成任务')).not.toBeInTheDocument()
  })

  it('automatically switches to generating when a new task starts without trapping manual tab changes', async () => {
    const user = userEvent.setup()
    seed()
    render(<TaskCenterDrawer scope="smart" />)

    expect(screen.getByRole('tab', { name: '智能成片' })).toHaveAttribute('aria-selected', 'true')

    act(() => {
      useTaskCenterStore.getState().upsertTask(
        task({
          id: 'smart:7:11:new-generation',
          generationId: 'new-generation',
          status: 'processing',
          title: '刚开始生成',
        }),
      )
    })

    expect(await screen.findByRole('tab', { name: '正在生成' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('刚开始生成')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '智能成片' }))
    act(() => {
      useTaskCenterStore.getState().patchTask('smart:7:11:new-generation', { progress: 35 })
    })
    expect(screen.getByRole('tab', { name: '智能成片' })).toHaveAttribute('aria-selected', 'true')
  })

  it('restores a persisted hot-copy thumbnail from the project source asset on first open', async () => {
    const user = userEvent.setup()
    mocks.getAssetDownloadUrl.mockResolvedValue('/api/v1/assets/321/download?workspace_id=7')
    mocks.listAllCreativeProjects.mockResolvedValue([
      {
        id: 11,
        title: '爆款项目',
        draft_json: {
          flow: 'hot-copy',
          smart: {
            flow: 'hot-copy',
            sourceVideo: { assetId: 321, url: '' },
            entryInitial: {
              libraryVideo: { assetId: 321, src: '' },
            },
          },
        },
      },
    ])
    seed(
      task({
        id: 'hot-copy:7:11:generation-1',
        scope: 'hot-copy',
        operationCode: 'video.replicate',
        title: '首次恢复的爆款任务',
        thumbnailUrl: '',
        thumbnailAssetId: undefined,
      }),
    )

    render(<TaskCenterDrawer scope="hot-copy" />)
    await user.click(screen.getByRole('tab', { name: '正在生成' }))

    expect(await screen.findByText('首次恢复的爆款任务')).toBeInTheDocument()
    await waitFor(() => {
      expect(useTaskCenterStore.getState().tasks[0]?.thumbnailAssetId).toBe(321)
      expect(mocks.getAssetDownloadUrl).toHaveBeenCalledWith({ workspaceId: 7, assetId: 321 })
    })
  })

  it('opens a completed hot-copy task in its editable project instead of intercepting it with video preview', async () => {
    const user = userEvent.setup()
    seed(
      task({
        id: 'hot-copy:7:11:completed',
        scope: 'hot-copy',
        operationCode: 'video.replicate',
        status: 'succeeded',
        title: '可继续编辑的爆款任务',
        resultUrl: '/completed-hot-copy.mp4',
        resultAssetId: 91,
      }),
    )

    render(<TaskCenterDrawer scope="hot-copy" />)
    await user.click(await screen.findByText('可继续编辑的爆款任务'))

    expect(mocks.navigate).toHaveBeenCalledWith('/hot-copy/11')
    expect(screen.queryByRole('dialog', { name: '视频预览' })).not.toBeInTheDocument()
  })

  it.each([
    ['smart', '智能成片'],
    ['hot-copy', '爆款复制'],
  ] as const)(
    'limits %s completed video tasks to 20 and opens project management for the remainder',
    async (scope, label) => {
      const user = userEvent.setup()
      seed(
        ...Array.from({ length: 21 }, (_, index) =>
          task({
            id: `${scope}:7:11:generation-${index + 1}`,
            scope,
            generationId: `generation-${index + 1}`,
            operationCode: scope === 'hot-copy' ? 'video.replicate' : 'video.generate',
            title: `${label}任务 ${index + 1}`,
            status: 'succeeded',
            updatedAt: 1_000 + index,
          }),
        ),
      )

      render(<TaskCenterDrawer scope={scope} />)

      await waitFor(() => expect(screen.getAllByRole('button', { name: /打开项目/ })).toHaveLength(20))
      expect(screen.queryByText(`${label}任务 1`)).not.toBeInTheDocument()
      const viewAll = screen.getByRole('button', { name: '前往项目管理查看全部视频' })
      expect(viewAll).toHaveAttribute('title', '还有 1 条视频，请前往项目管理查看')

      await user.click(viewAll)
      expect(mocks.navigate).toHaveBeenCalledWith('/projects')
    },
  )

  it('does not show the project-management shortcut when all video tasks fit in the drawer', async () => {
    seed(
      ...Array.from({ length: 20 }, (_, index) =>
        task({
          id: `smart:7:11:generation-${index + 1}`,
          generationId: `generation-${index + 1}`,
          title: `任务 ${index + 1}`,
          status: 'succeeded',
          updatedAt: 1_000 + index,
        }),
      ),
    )

    render(<TaskCenterDrawer scope="smart" />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: /打开项目/ })).toHaveLength(20))
    expect(screen.queryByRole('button', { name: '前往项目管理查看全部视频' })).not.toBeInTheDocument()
  })

  it('fails closed until project permissions load, then reveals only accessible live tasks', async () => {
    const user = userEvent.setup()
    const projects = deferred<unknown[]>()
    mocks.listAllCreativeProjects.mockReturnValue(projects.promise)
    seed(
      task(),
      task({
        id: 'smart:8:12:generation-2',
        workspaceId: 8,
        projectId: 12,
        generationId: 'generation-2',
        taskId: 102,
        title: '其他空间任务',
      }),
      task({
        id: 'smart:7:13:generation-3',
        projectId: 13,
        generationId: 'generation-3',
        taskId: 103,
        ownerUserId: 10,
        title: '其他账号任务',
      }),
    )

    render(<TaskCenterDrawer scope="smart" />)
    await user.click(screen.getByRole('tab', { name: '正在生成' }))

    expect(screen.queryByRole('button', { name: /当前任务.*打开项目/ })).not.toBeInTheDocument()

    await act(async () => {
      projects.resolve([project(11)])
      await projects.promise
    })
    expect(await screen.findByRole('button', { name: /当前任务.*打开项目/ })).toBeInTheDocument()
    expect(screen.queryByText('其他空间任务')).not.toBeInTheDocument()
    expect(screen.queryByText('其他账号任务')).not.toBeInTheDocument()
  })

  it('shows a locally initiated generating task immediately while the new project permission list is still stale', async () => {
    const user = userEvent.setup()
    const projects = deferred<unknown[]>()
    mocks.listAllCreativeProjects.mockReturnValue(projects.promise)
    seed(
      task({
        id: 'hot-copy:7:99:new-project-generation',
        scope: 'hot-copy',
        projectId: 99,
        generationId: 'new-project-generation',
        taskId: 0,
        status: 'preparing',
        title: '刚点击生成的爆款任务',
        operationCode: 'video.replicate',
        locallyInitiated: true,
      }),
    )

    render(<TaskCenterDrawer scope="hot-copy" />)
    await user.click(screen.getByRole('tab', { name: '正在生成' }))

    expect(screen.getByText('刚点击生成的爆款任务')).toBeInTheDocument()
    expect(screen.getByText('准备中')).toBeInTheDocument()
  })

  it('keeps project-bound live tasks hidden when permission loading fails', async () => {
    mocks.listAllCreativeProjects.mockRejectedValue(new Error('offline'))
    seed(task())

    render(<TaskCenterDrawer scope="smart" />)

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('暂无任务'))
    expect(screen.queryByText('当前任务')).not.toBeInTheDocument()
  })

  it('ignores history from a workspace request that resolves after switching spaces', async () => {
    const oldWorkspace = deferred<unknown[]>()
    const newWorkspace = deferred<unknown[]>()
    mocks.listAllCreativeProjects.mockReturnValueOnce(oldWorkspace.promise).mockReturnValueOnce(newWorkspace.promise)
    seed()

    const view = render(<TaskCenterDrawer scope="smart" />)
    await waitFor(() => expect(mocks.listAllCreativeProjects).toHaveBeenCalledOnce())

    mocks.workspace.id = 8
    view.rerender(<TaskCenterDrawer scope="smart" />)
    await waitFor(() => expect(mocks.listAllCreativeProjects).toHaveBeenCalledTimes(2))

    newWorkspace.resolve([
      project(81, [historyVideo({ id: 801, projectId: 81, title: '新空间历史', videoAssetId: 801 })]),
    ])
    expect(await screen.findByText('新空间历史')).toBeInTheDocument()

    oldWorkspace.resolve([
      project(71, [historyVideo({ id: 701, projectId: 71, title: '旧空间历史', videoAssetId: 701 })]),
    ])
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('新空间历史')).toBeInTheDocument()
    expect(screen.queryByText('旧空间历史')).not.toBeInTheDocument()
  })

  it('deduplicates historical results already represented by a live completed task', async () => {
    mocks.listAllCreativeProjects.mockResolvedValue([project(11, [historyVideo()])])
    seed(
      task({
        status: 'succeeded',
        progress: 100,
        resultUrl: '/live.mp4',
        resultAssetId: 88,
        title: '实时完成任务',
      }),
    )

    render(<TaskCenterDrawer scope="smart" />)

    expect(await screen.findByText('实时完成任务')).toBeInTheDocument()
    expect(screen.queryByText('历史任务')).not.toBeInTheDocument()
  })

  it('deduplicates a live result and history when only signed URL parameters differ', async () => {
    mocks.listAllCreativeProjects.mockResolvedValue([
      project(11, [
        historyVideo({
          videoAssetId: 0,
          videoUrl: '/api/v1/assets/88/download?workspace_id=7&token=history',
        }),
      ]),
    ])
    seed(
      task({
        status: 'succeeded',
        progress: 100,
        taskId: 0,
        resultAssetId: undefined,
        resultUrl: '/api/v1/assets/88/download?workspace_id=7&token=live',
        title: 'unique completed task',
      }),
    )

    render(<TaskCenterDrawer scope="smart" />)

    expect(await screen.findByText('unique completed task')).toBeInTheDocument()
    expect(screen.queryByText('历史任务')).not.toBeInTheDocument()
  })

  it('does not mutate task storage when repeatedly switching tabs', async () => {
    const user = userEvent.setup()
    seed(
      task({
        scope: 'hot-copy',
        generationId: 'stable-generation',
        taskId: 903,
        status: 'processing',
        title: 'stable generating task',
      }),
    )
    render(<TaskCenterDrawer scope="hot-copy" />)
    const originalIds = useTaskCenterStore.getState().tasks.map((item) => item.id)
    const tabs = screen.getAllByRole('tab')

    for (let index = 0; index < 5; index += 1) {
      await user.click(tabs[0])
      await user.click(tabs[2])
    }

    expect(useTaskCenterStore.getState().tasks.map((item) => item.id)).toEqual(originalIds)
  })

  it('archives a generated task immediately without mutating historical data', async () => {
    const user = userEvent.setup()
    seed(task({ status: 'succeeded' }))
    render(<TaskCenterDrawer scope="smart" />)

    await screen.findByText('当前任务')
    await user.click(screen.getByRole('button', { name: '从任务管理中隐藏当前任务' }))

    expect(useTaskCenterStore.getState().tasks[0]?.archived).toBe(true)
    expect(screen.queryByText('当前任务')).not.toBeInTheDocument()
  })

  it('shows image tasks on an enabled image tab and opens their smart project', async () => {
    const user = userEvent.setup()
    seed(
      task({
        id: 'image:7:11:image-generation-1',
        scope: 'image',
        generationId: 'image-generation-1',
        operationCode: 'image.text_to_image',
        status: 'succeeded',
        title: '商品主图',
        ratio: '1:1',
        durationSec: 0,
        resultUrl: '/result.png',
        resultAssetId: 88,
      }),
      task({
        id: 'smart:7:11:legacy-image-generation',
        scope: 'smart',
        generationId: 'legacy-image-generation',
        operationCode: 'image.image_to_image',
        status: 'succeeded',
        title: '兼容旧图片任务',
        resultUrl: '/legacy-result.png',
      }),
    )

    render(<TaskCenterDrawer scope="image" />)

    const imageTab = screen.getByRole('tab', { name: '图片' })
    expect(imageTab).toBeEnabled()
    expect(imageTab).toHaveAttribute('aria-selected', 'true')
    const imageTask = await screen.findByRole('button', { name: /商品主图.*打开项目/ })
    expect(imageTask).toHaveTextContent('1:1')
    expect(imageTask).toHaveTextContent('文生图')
    expect(screen.getByText('兼容旧图片任务')).toBeInTheDocument()

    await user.click(imageTask)
    expect(mocks.navigate).toHaveBeenCalledWith('/smart/11')
    expect(screen.queryByRole('dialog', { name: '视频预览' })).not.toBeInTheDocument()
  })

  it('keeps generating images in the generating tab and terminal images in the image tab', async () => {
    const user = userEvent.setup()
    seed(
      task({
        id: 'image:7:11:image-processing',
        scope: 'image',
        generationId: 'image-processing',
        operationCode: 'image.text_to_image',
        status: 'processing',
        title: '生成中的图片',
      }),
      task({
        id: 'image:7:11:image-succeeded',
        scope: 'image',
        generationId: 'image-succeeded',
        operationCode: 'image.text_to_image',
        status: 'succeeded',
        title: '已生成的图片',
        resultUrl: '/completed.png',
        resultAssetId: 89,
      }),
      task({
        id: 'image:7:11:image-failed',
        scope: 'image',
        generationId: 'image-failed',
        operationCode: 'image.text_to_image',
        status: 'failed',
        title: '生成失败的图片',
      }),
      task({
        id: 'image:7:11:image-cancelled',
        scope: 'image',
        generationId: 'image-cancelled',
        operationCode: 'image.text_to_image',
        status: 'cancelled',
        title: '已取消的图片',
      }),
    )

    render(<TaskCenterDrawer scope="image" />)

    expect(screen.queryByText('生成中的图片')).not.toBeInTheDocument()
    expect(await screen.findByText('已生成的图片')).toBeInTheDocument()
    expect(screen.getByText('已取消的图片')).toBeInTheDocument()
    expect(screen.queryByText('生成失败的图片')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '正在生成' }))
    expect(await screen.findByText('生成中的图片')).toBeInTheDocument()
    expect(screen.queryByText('已生成的图片')).not.toBeInTheDocument()
  })

  it('derives image history from saved project messages without another backend endpoint', async () => {
    mocks.listAllCreativeProjects.mockResolvedValue([
      {
        id: 11,
        title: '图片历史项目',
        draft_json: {
          flow: 'smart',
          smart: {
            entryMeta: { mode: 'image', ratio: '4:3' },
            imageMessages: [
              { id: 'user-failed', role: 'user', text: '不应显示的失败图片' },
              {
                id: 'assistant-failed',
                role: 'assistant',
                status: 'generation_failed',
                operationCode: 'image.text_to_image',
                images: [{ url: '/failed-history.png', assetId: 90 }],
              },
              { id: 'user-1', role: 'user', text: '夏日饮品海报' },
              {
                id: 'assistant-1',
                role: 'assistant',
                status: 'done',
                operationCode: 'image.image_to_image',
                images: [{ url: '/history.png', assetId: 91 }],
              },
            ],
          },
        },
      },
    ])

    render(<TaskCenterDrawer scope="image" />)

    const historyTask = await screen.findByRole('button', { name: /夏日饮品海报.*打开项目/ })
    expect(historyTask).toHaveTextContent('4:3')
    expect(historyTask).toHaveTextContent('参考图生成')
    expect(screen.queryByText('不应显示的失败图片')).not.toBeInTheDocument()
  })

  it('does not open a signed result URL that arrives after switching workspace', async () => {
    const user = userEvent.setup()
    const signedUrl = deferred<string>()
    mocks.getAssetDownloadUrl.mockReturnValue(signedUrl.promise)
    seed(
      task({
        status: 'succeeded',
        resultAssetId: 88,
        resultUrl: undefined,
        title: '待签名视频',
      }),
    )

    const view = render(<TaskCenterDrawer scope="smart" />)
    await user.click(await screen.findByRole('button', { name: /待签名视频.*播放视频/ }))
    expect(mocks.getAssetDownloadUrl).toHaveBeenCalledWith({ workspaceId: 7, assetId: 88 })

    mocks.workspace.id = 8
    view.rerender(<TaskCenterDrawer scope="smart" />)
    signedUrl.resolve('/api/v1/assets/88/download?workspace_id=7')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByRole('dialog', { name: '视频预览' })).not.toBeInTheDocument()
    expect(screen.queryByText('/api/v1/assets/88/download?workspace_id=7')).not.toBeInTheDocument()
  })
})
