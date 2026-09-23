import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskCenterTask } from '@/stores/taskCenter'

const mocks = vi.hoisted(() => ({
  workspace: { id: 7, type: 'personal', user: { id: 9 } as Record<string, unknown> },
  deriveProjectVideos: vi.fn(),
  getAssetDownloadUrl: vi.fn(),
  listAllCreativeProjects: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mocks.navigate }
})

vi.mock('@/api/business', () => ({
  getAssetDownloadUrl: mocks.getAssetDownloadUrl,
  humanizeProviderErrorText: () => '',
}))

vi.mock('@/api/projectVideos', () => ({
  deriveProjectVideos: mocks.deriveProjectVideos,
}))

vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => mocks.workspace.user,
  useCurrentWorkspace: () => ({ id: mocks.workspace.id, type: mocks.workspace.type }),
  useWorkspaceId: () => mocks.workspace.id,
}))

vi.mock('@/api/auth', () => ({
  listWorkspaceMembers: mocks.listWorkspaceMembers,
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
import styles from '@/components/task/TaskCenterDrawer.module.less'

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
  mocks.workspace.type = 'personal'
  mocks.workspace.user = { id: 9 }
  localStorage.clear()
  Object.entries(mocks).forEach(([, value]) => {
    if (typeof value === 'function' && 'mockReset' in value) value.mockReset()
  })
  mocks.deriveProjectVideos.mockImplementation(({ project: item }: { project: { videos?: unknown[] } }) =>
    Array.isArray(item.videos) ? item.videos : [],
  )
  mocks.listAllCreativeProjects.mockResolvedValue([project(11)])
  mocks.listWorkspaceMembers.mockResolvedValue([])
  seed()
})

describe('TaskCenterDrawer isolation and reconciliation', () => {
  it('uses a zero-width task tab with an active-task badge when collapsed', async () => {
    const user = userEvent.setup()
    seed(
      task({ id: 'smart:7:11:active', generationId: 'active', status: 'processing' }),
      task({ id: 'smart:7:11:done', generationId: 'done', status: 'succeeded' }),
    )
    useTaskCenterStore.setState({ drawerExpanded: false })

    render(<TaskCenterDrawer scope="smart" />)

    const collapsedDrawer = screen.getByLabelText('任务管理（已收起）')
    expect(collapsedDrawer).toHaveClass(styles.collapsed)
    expect(screen.getByRole('button', { name: '展开任务管理' })).toHaveTextContent('任务')
    expect(screen.getByLabelText('1 个任务正在生成')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: '展开任务管理' }))
    expect(screen.getByRole('complementary', { name: '任务管理' })).toBeInTheDocument()
  })

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

    expect(screen.getByRole('tab', { name: '爆款成片' })).toHaveAttribute('aria-selected', 'true')

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

    await user.click(screen.getByRole('tab', { name: '爆款成片' }))
    act(() => {
      useTaskCenterStore.getState().patchTask('smart:7:11:new-generation', { progress: 35 })
    })
    expect(screen.getByRole('tab', { name: '爆款成片' })).toHaveAttribute('aria-selected', 'true')
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

  it('opens the video preview for a completed hot-copy task, matching 爆款成片', async () => {
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

    // 已完成的任务就地开播放器，与爆款成片一致：同一种卡片点下去不该有两种结果。
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: '视频预览' })).toBeInTheDocument()
  })

  it('sends an unfinished hot-copy task back to its editable project', async () => {
    const user = userEvent.setup()
    seed(
      task({
        id: 'hot-copy:7:11:running',
        scope: 'hot-copy',
        operationCode: 'video.replicate',
        status: 'processing',
        title: '仍在生成的爆款任务',
      }),
    )

    render(<TaskCenterDrawer scope="hot-copy" />)
    // 生成中的任务只在「正在生成」汇总页展示。
    await user.click(screen.getByRole('tab', { name: '正在生成' }))
    await user.click(await screen.findByText('仍在生成的爆款任务'))

    expect(mocks.navigate).toHaveBeenCalledWith('/hot-copy/11')
    expect(screen.queryByRole('dialog', { name: '视频预览' })).not.toBeInTheDocument()
  })

  it.each([
    ['smart', '爆款成片'],
    ['hot-copy', '爆款复刻'],
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

describe('TaskCenterDrawer team-space member filter', () => {
  /** 团队空间：我的项目 11、同事乙的项目 12（他生成的视频）、协作项目 13（归属乙，但后端 mine 判为我的） */
  function seedTeamHistory() {
    mocks.workspace.type = 'team'
    mocks.listWorkspaceMembers.mockResolvedValue([
      { id: 9, nickname: '我自己' },
      { id: 10, nickname: '同事乙' },
    ])
    const all = [
      { ...project(11, [historyVideo({ id: 501, projectId: 11, title: '我的视频', videoAssetId: 501 })]), user_id: 9 },
      {
        ...project(12, [
          historyVideo({
            id: 502,
            projectId: 12,
            title: '同事的视频',
            videoAssetId: 502,
            createdByUserId: 10,
          }),
        ]),
        user_id: 10,
      },
      {
        ...project(13, [
          historyVideo({ id: 503, projectId: 13, title: '协作项目视频', videoAssetId: 503, createdByUserId: 10 }),
        ]),
        user_id: 10,
      },
    ]
    mocks.listAllCreativeProjects.mockImplementation(({ mine }: { mine?: boolean } = {}) =>
      Promise.resolve(mine ? [all[0], all[2]] : all),
    )
  }

  it('shows teammates’ generated videos with a creator label and lets 只看我的 follow the backend mine set', async () => {
    const user = userEvent.setup()
    seedTeamHistory()

    render(<TaskCenterDrawer scope="smart" />)

    // 三条都展示;同事做的标注创作者,自己的不标
    expect(await screen.findByText('我的视频')).toBeInTheDocument()
    const teammateCard = screen.getByRole('button', { name: /同事的视频，同事乙 生成/ })
    expect(teammateCard).toHaveTextContent('同事乙')
    expect(screen.getByRole('button', { name: /^我的视频，已生成/ })).toBeInTheDocument()
    expect(mocks.listAllCreativeProjects).toHaveBeenCalledWith(expect.objectContaining({ mine: true }))

    // 「我（2）」按 mine 集合算:协作项目 13 归属乙,但后端判为我的
    expect(screen.getByRole('button', { name: '按成员筛选' })).toHaveTextContent('全部成员')
    await user.click(screen.getByRole('button', { name: '只看我的' }))
    expect(screen.getByText('我的视频')).toBeInTheDocument()
    expect(screen.getByText('协作项目视频')).toBeInTheDocument()
    expect(screen.queryByText('同事的视频')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '按成员筛选' })).toHaveTextContent('我（2）')
    expect(localStorage.getItem('zzh.taskCenter.ownerFilter.7')).toBe('9')

    // 成员下拉:选同事乙只剩他创作的两条
    await user.click(screen.getByRole('button', { name: '按成员筛选' }))
    await user.click(await screen.findByRole('option', { name: '同事乙（2）' }))
    expect(screen.getByText('同事的视频')).toBeInTheDocument()
    expect(screen.getByText('协作项目视频')).toBeInTheDocument()
    expect(screen.queryByText('我的视频')).not.toBeInTheDocument()
  })

  it('carries the member filter over to project management when opening 查看全部视频', async () => {
    const user = userEvent.setup()
    seedTeamHistory()
    seed(
      ...Array.from({ length: 21 }, (_, index) =>
        task({
          id: `smart:7:11:generation-${index + 1}`,
          generationId: `generation-${index + 1}`,
          title: `我的任务 ${index + 1}`,
          status: 'succeeded',
          updatedAt: 1_000 + index,
        }),
      ),
    )

    render(<TaskCenterDrawer scope="smart" />)
    await user.click(screen.getByRole('button', { name: '只看我的' }))
    // 21 条本地 + 2 条 mine 历史 = 23 条我的,截 20 条;同事的那条被筛掉不计入
    await waitFor(() => expect(screen.getAllByRole('button', { name: /打开项目|播放视频/ })).toHaveLength(20))
    expect(screen.queryByText('同事的视频')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '前往项目管理查看全部视频' })).toHaveAttribute(
      'title',
      '还有 3 条视频，请前往项目管理查看',
    )

    await user.click(screen.getByRole('button', { name: '前往项目管理查看全部视频' }))
    expect(mocks.navigate).toHaveBeenCalledWith('/projects?owner=9')
  })

  it('falls back to creator matching when the mine request fails and keeps the drawer usable', async () => {
    const user = userEvent.setup()
    seedTeamHistory()
    mocks.listAllCreativeProjects.mockImplementation(({ mine }: { mine?: boolean } = {}) =>
      mine
        ? Promise.reject(new Error('mine unavailable'))
        : Promise.resolve([
            {
              ...project(11, [historyVideo({ id: 501, projectId: 11, title: '我的视频', videoAssetId: 501 })]),
              user_id: 9,
            },
            {
              ...project(12, [
                historyVideo({ id: 502, projectId: 12, title: '同事的视频', videoAssetId: 502, createdByUserId: 10 }),
              ]),
              user_id: 10,
            },
          ]),
    )

    render(<TaskCenterDrawer scope="smart" />)
    expect(await screen.findByText('同事的视频')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '只看我的' }))
    expect(screen.getByText('我的视频')).toBeInTheDocument()
    expect(screen.queryByText('同事的视频')).not.toBeInTheDocument()
  })

  it('counts a locally initiated task as mine even before its project lands in the mine set', async () => {
    const user = userEvent.setup()
    seedTeamHistory()
    seed(
      task({
        id: 'smart:7:99:fresh',
        projectId: 99,
        generationId: 'fresh',
        status: 'succeeded',
        title: '刚生成的新项目视频',
        locallyInitiated: true,
      }),
    )

    render(<TaskCenterDrawer scope="smart" />)
    expect(await screen.findByText('刚生成的新项目视频')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '只看我的' }))
    expect(screen.getByText('刚生成的新项目视频')).toBeInTheDocument()
  })

  it('hides the member filter in personal spaces and in the generating tab', async () => {
    const user = userEvent.setup()
    seed(task({ status: 'succeeded' }))
    const view = render(<TaskCenterDrawer scope="smart" />)
    await screen.findByText('当前任务')
    expect(screen.queryByRole('button', { name: '只看我的' })).not.toBeInTheDocument()
    expect(mocks.listAllCreativeProjects).not.toHaveBeenCalledWith(expect.objectContaining({ mine: true }))

    // 同一账号切到团队空间:筛选行出现;「正在生成」页签全是自己发起的任务,不给筛选
    seedTeamHistory()
    mocks.workspace.id = 8
    view.rerender(<TaskCenterDrawer scope="smart" />)
    expect(await screen.findByRole('button', { name: '只看我的' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '正在生成' }))
    expect(screen.queryByRole('button', { name: '只看我的' })).not.toBeInTheDocument()
  })

  it('remembers the filter per workspace but ignores it on tabs where that member has nothing', async () => {
    const user = userEvent.setup()
    seedTeamHistory()
    localStorage.setItem('zzh.taskCenter.ownerFilter.7', '10')

    render(<TaskCenterDrawer scope="hot-copy" />)
    // 爆款复刻页签下同事没有产出:记忆值 10 在该页签选项里失效,回退全部 → 普通空态
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('暂无任务'))

    await user.click(screen.getByRole('tab', { name: '爆款成片' }))
    expect(await screen.findByText('同事的视频')).toBeInTheDocument()
    expect(screen.queryByText('我的视频')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '按成员筛选' })).toHaveTextContent('同事乙（2）')
    await user.click(screen.getByRole('button', { name: '只看我的' }))
    await user.click(screen.getByRole('button', { name: '只看我的' }))
    expect(screen.getByRole('button', { name: '按成员筛选' })).toHaveTextContent('全部成员')
    expect(localStorage.getItem('zzh.taskCenter.ownerFilter.7')).toBeNull()
  })

  it('shows a member-specific empty state when 只看我的 hides every video on the tab', async () => {
    const user = userEvent.setup()
    mocks.workspace.type = 'team'
    mocks.listWorkspaceMembers.mockResolvedValue([{ id: 10, nickname: '同事乙' }])
    mocks.listAllCreativeProjects.mockImplementation(({ mine }: { mine?: boolean } = {}) =>
      Promise.resolve(
        mine
          ? []
          : [
              {
                ...project(12, [historyVideo({ id: 502, projectId: 12, title: '同事的视频', createdByUserId: 10 })]),
                user_id: 10,
              },
            ],
      ),
    )

    render(<TaskCenterDrawer scope="smart" />)
    expect(await screen.findByText('同事的视频')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '只看我的' }))
    expect(screen.getByRole('status')).toHaveTextContent('该成员暂无视频')
    expect(screen.getByRole('button', { name: '按成员筛选' })).toHaveTextContent('我（0）')
  })
})
