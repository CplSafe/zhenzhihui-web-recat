import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteProjectVideo: vi.fn(),
  downloadToDisk: vi.fn(),
  getCreativeProject: vi.fn(),
  listAiModels: vi.fn(),
  listProjectVideos: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  navigate: vi.fn(),
  patchCreativeProject: vi.fn(),
  publishProjectVideo: vi.fn(),
  requestConfirm: vi.fn(),
  route: { projectId: '1' },
  showToast: vi.fn(),
  workspace: { id: 21 },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ ...mocks.route }),
}))

vi.mock('@/components/home/AppSidebar', () => ({
  default: () => <nav aria-label="应用侧边栏" />,
}))

vi.mock('@/components/layout/AppTopbar', () => ({
  default: () => <header aria-label="应用顶栏" />,
}))

vi.mock('@/components/common/LazyMediaVideo', () => ({
  LazyMediaVideo: () => <div data-testid="lazy-video" />,
  useMediaCardActivation: () => ({ active: false, activationProps: {} }),
}))

vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => ({ id: 7, nickname: '测试用户' }),
  useCurrentWorkspace: () => ({}),
  useWorkspaceId: () => mocks.workspace.id,
}))

vi.mock('@/api/auth', () => ({
  listWorkspaceMembers: mocks.listWorkspaceMembers,
}))

vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: mocks.requestConfirm }),
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('@/composables/useSidebarNavigate', () => ({
  useSidebarNavigate: () => vi.fn(),
}))

vi.mock('@/api/projectVideos', () => ({
  deleteProjectVideo: mocks.deleteProjectVideo,
  formatVideoDate: (value: string) => value || '--',
  formatVideoDuration: (value: number) => `${value || 0} 秒`,
  getVideoStatusText: (status: string) => (status === 'published' ? '已发布' : '草稿'),
  listProjectVideos: mocks.listProjectVideos,
  publishProjectVideo: mocks.publishProjectVideo,
}))

vi.mock('@/api/business', () => ({
  getBusinessErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  getCreativeProject: mocks.getCreativeProject,
  listAiModels: mocks.listAiModels,
  patchCreativeProject: mocks.patchCreativeProject,
}))

vi.mock('@/utils/downloadToDisk', () => ({
  buildDownloadName: (title: string) => `${title}.mp4`,
  downloadToDisk: mocks.downloadToDisk,
}))

import ProjectVideoListView from '@/views/ProjectVideoListView'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function payload(projectId: number, title: string, videos: any[] = [], projectOwnerId = 7) {
  return {
    project: { id: projectId, title, user_id: projectOwnerId, draft_json: {} },
    videos,
  }
}

const ownedVideo = {
  id: 'video-1',
  projectId: 1,
  workspaceId: 21,
  title: '可发布视频',
  coverUrl: '',
  videoUrl: '/api/video-1.mp4',
  durationSeconds: 12,
  status: 'draft',
  createdByName: '测试用户',
  createdByUserId: 7,
  createdAt: '2026-07-17T01:00:00.000Z',
  updatedAt: '2026-07-17T01:00:00.000Z',
  sourceType: 'smart',
  flow: 'smart',
}

describe('ProjectVideoListView reliability', () => {
  beforeEach(() => {
    mocks.route.projectId = '1'
    mocks.workspace.id = 21
    mocks.deleteProjectVideo.mockReset()
    mocks.downloadToDisk.mockReset()
    mocks.getCreativeProject.mockReset()
    mocks.getCreativeProject.mockResolvedValue({ draft_json: {} })
    mocks.listAiModels.mockReset()
    mocks.listAiModels.mockResolvedValue([])
    mocks.listProjectVideos.mockReset()
    mocks.listWorkspaceMembers.mockReset()
    mocks.listWorkspaceMembers.mockImplementation(() => new Promise(() => undefined))
    mocks.navigate.mockReset()
    mocks.patchCreativeProject.mockReset()
    mocks.publishProjectVideo.mockReset()
    mocks.requestConfirm.mockReset()
    mocks.showToast.mockReset()
  })

  it('does not let an older project response overwrite the current route', async () => {
    const oldRequest = deferred<ReturnType<typeof payload>>()
    const currentRequest = deferred<ReturnType<typeof payload>>()
    mocks.listProjectVideos.mockImplementation(({ projectId }: { projectId: number }) =>
      projectId === 1 ? oldRequest.promise : currentRequest.promise,
    )

    const { rerender } = render(<ProjectVideoListView />)
    await waitFor(() => expect(mocks.listProjectVideos).toHaveBeenCalledWith(expect.objectContaining({ projectId: 1 })))

    mocks.route.projectId = '2'
    rerender(<ProjectVideoListView />)
    await waitFor(() => expect(mocks.listProjectVideos).toHaveBeenCalledWith(expect.objectContaining({ projectId: 2 })))

    currentRequest.resolve(payload(2, '当前项目'))
    expect(await screen.findByText('当前项目')).toBeInTheDocument()

    oldRequest.resolve(payload(1, '过期项目'))
    await waitFor(() => expect(screen.queryByText('过期项目')).not.toBeInTheDocument())
    expect(mocks.showToast).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('reports publish failures instead of leaking an unhandled rejection', async () => {
    mocks.listProjectVideos.mockResolvedValue(payload(1, '发布项目', [ownedVideo]))
    mocks.publishProjectVideo.mockRejectedValue(new Error('发布接口不可用'))

    render(<ProjectVideoListView />)
    expect(await screen.findByText(ownedVideo.title)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    fireEvent.click(screen.getByRole('button', { name: '标记发布' }))

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('发布接口不可用', 'error'))
  })

  it('面包屑铅笔按钮：项目名变输入框，回车后 PATCH 标题并就地更新', async () => {
    mocks.listProjectVideos.mockResolvedValue(payload(1, '旧名字', [ownedVideo]))
    mocks.patchCreativeProject.mockResolvedValue({ id: 1, title: '新名字' })

    render(<ProjectVideoListView />)
    expect(await screen.findByText('旧名字')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重命名项目' }))
    const input = screen.getByDisplayValue('旧名字')
    // 编辑态收起铅笔，避免和输入框挤在一行
    expect(screen.queryByRole('button', { name: '重命名项目' })).toBeNull()
    fireEvent.change(input, { target: { value: '新名字' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(mocks.patchCreativeProject).toHaveBeenCalledWith({
        projectId: 1,
        workspaceId: 21,
        title: '新名字',
        name: '新名字',
      }),
    )
    expect(await screen.findByText('新名字')).toBeInTheDocument()
    expect(screen.queryByText('旧名字')).toBeNull()
    expect(screen.getByRole('button', { name: '重命名项目' })).toBeInTheDocument()
    expect(mocks.showToast).toHaveBeenCalledWith('项目已重命名', 'success')
    // 列表本身不需要重拉
    expect(mocks.listProjectVideos).toHaveBeenCalledTimes(1)
  })

  it('双击项目名也能改名；后端拒绝时回滚原名并提示', async () => {
    mocks.listProjectVideos.mockResolvedValue(payload(1, '旧名字', [ownedVideo]))
    mocks.patchCreativeProject.mockRejectedValue(new Error('没有权限'))

    render(<ProjectVideoListView />)
    const title = await screen.findByText('旧名字')

    fireEvent.doubleClick(title)
    const input = screen.getByDisplayValue('旧名字')
    fireEvent.change(input, { target: { value: '新名字' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mocks.patchCreativeProject).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('新名字')).toBeNull())
    expect(screen.getByText('旧名字')).toBeInTheDocument()
    expect(mocks.showToast).toHaveBeenCalledWith('没有权限', 'error')
  })

  it('进入编辑时通过查询参数保留列表中点击的视频版本', async () => {
    const selectedVideo = {
      ...ownedVideo,
      id: 'version/42 + final',
      videoAssetId: 42,
      videoUrl: 'https://media.example/video.mp4?X-Amz-Signature=do-not-copy',
      flow: 'hot-copy',
    }
    mocks.listProjectVideos.mockResolvedValue(payload(1, '版本项目', [selectedVideo]))

    render(<ProjectVideoListView />)
    expect(await screen.findByText(selectedVideo.title)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    fireEvent.click(screen.getByRole('button', { name: '进入编辑' }))

    expect(mocks.navigate).toHaveBeenCalledWith(
      '/hot-copy/1?workspace_id=21&video_id=version%2F42+%2B+final&video_asset_id=42',
      {
        state: {
          projectVideoSelection: {
            projectId: 1,
            workspaceId: 21,
            videoId: 'version/42 + final',
            videoAssetId: 42,
          },
        },
      },
    )
    expect(JSON.stringify(mocks.navigate.mock.calls[mocks.navigate.mock.calls.length - 1])).not.toContain('do-not-copy')
  })

  it('allows a hot-copy project to start a new smart video in the same project', async () => {
    mocks.listProjectVideos.mockResolvedValue({
      ...payload(1, '爆款复制项目'),
      project: {
        ...payload(1, '爆款复制项目').project,
        draft_json: { flow: 'hot-copy', smart: { flow: 'hot-copy' } },
      },
    })

    render(<ProjectVideoListView />)
    expect(await screen.findByText('爆款复制项目')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ 新建视频' }))
    const dialog = screen.getByRole('dialog', { name: '新建视频' })
    fireEvent.click(within(dialog).getByRole('button', { name: /爆款成片/ }))

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/smart', {
        state: {
          newProjectName: '爆款复制项目',
          restartProjectId: 1,
          carryImages: [],
          carryVideo: null,
        },
      })
    })
  })

  it('普通成员即使是视频创建者也可以查看和下载，但不能删除', async () => {
    mocks.listProjectVideos.mockResolvedValue(payload(1, '其他人的项目', [ownedVideo], 99))

    render(<ProjectVideoListView />)
    expect(await screen.findByText(ownedVideo.title)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))

    expect(screen.getByRole('button', { name: '查看详情' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '下载视频' })).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: '删除视频' })).not.toBeInTheDocument()
  })

  it('项目创建者可以删除项目内视频', async () => {
    mocks.listProjectVideos.mockResolvedValue(payload(1, '自己的项目', [ownedVideo], 7))

    render(<ProjectVideoListView />)
    expect(await screen.findByText(ownedVideo.title)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))

    expect(screen.getByRole('button', { name: '删除视频' })).toBeInTheDocument()
  })

  it('空间管理员可以删除其他人项目内的视频', async () => {
    mocks.listWorkspaceMembers.mockResolvedValue([{ user_id: 7, workspace_role: 'admin' }])
    mocks.listProjectVideos.mockResolvedValue(payload(1, '团队项目', [{ ...ownedVideo, createdByUserId: 99 }], 99))

    render(<ProjectVideoListView />)
    expect(await screen.findByText(ownedVideo.title)).toBeInTheDocument()
    await waitFor(() => expect(mocks.listWorkspaceMembers).toHaveBeenCalledWith(21))

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))

    expect(await screen.findByRole('button', { name: '删除视频' })).toBeInTheDocument()
  })

  it('按视频模型筛选：选项来自视频记录的模型，名字优先查目录，老视频归入「未记录模型」', async () => {
    // 目录只在 video.generate 查询时返回模型 12;模型 31(爆款复刻)目录里查不到 → 退回视频上的名字快照
    mocks.listAiModels.mockImplementation(({ operationCode }: { operationCode: string }) =>
      Promise.resolve(
        operationCode === 'video.generate'
          ? [{ id: 12, name: 'Seedance 1.0', enabled: true, operation_codes: ['video.generate'] }]
          : [],
      ),
    )
    mocks.listProjectVideos.mockResolvedValue(
      payload(1, '模型筛选项目', [
        { ...ownedVideo, id: 'v-1', title: 'Seedance 视频一', modelVersionId: 12 },
        { ...ownedVideo, id: 'v-2', title: 'Seedance 视频二', modelVersionId: 12, modelInferred: true },
        { ...ownedVideo, id: 'v-3', title: '复刻视频', flow: 'hot-copy', modelVersionId: 31, modelName: 'Replicate X' },
        { ...ownedVideo, id: 'v-4', title: '老视频' },
      ]),
    )

    render(<ProjectVideoListView />)
    expect(await screen.findByText('老视频')).toBeInTheDocument()
    const select = screen.getByRole('combobox', { name: '按视频模型筛选' })
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Seedance 1.0（2）' })).toBeInTheDocument())
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['全部', 'Seedance 1.0（2）', 'Replicate X（1）', '未记录模型（1）'])

    fireEvent.change(select, { target: { value: '12' } })
    expect(screen.getByText('Seedance 视频一')).toBeInTheDocument()
    expect(screen.getByText('Seedance 视频二')).toBeInTheDocument()
    expect(screen.queryByText('复刻视频')).not.toBeInTheDocument()
    expect(screen.queryByText('老视频')).not.toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'unknown' } })
    expect(screen.getByText('老视频')).toBeInTheDocument()
    expect(screen.queryByText('Seedance 视频一')).not.toBeInTheDocument()

    // 与流程 Tab 叠加:爆款复刻下没有「未记录模型」的视频
    fireEvent.click(screen.getByRole('button', { name: '爆款复刻' }))
    expect(screen.getByText('当前项目下还没有符合条件的视频')).toBeInTheDocument()
  })

  it('没有任何视频记录模型时不显示模型筛选', async () => {
    mocks.listProjectVideos.mockResolvedValue(payload(1, '普通项目', [ownedVideo]))

    render(<ProjectVideoListView />)
    expect(await screen.findByText(ownedVideo.title)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '按视频模型筛选' })).not.toBeInTheDocument()
  })
})
