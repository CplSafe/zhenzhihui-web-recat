import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteProjectVideo: vi.fn(),
  downloadToDisk: vi.fn(),
  listProjectVideos: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  navigate: vi.fn(),
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
  getCreativeProject: vi.fn(),
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
    mocks.listProjectVideos.mockReset()
    mocks.listWorkspaceMembers.mockReset()
    mocks.listWorkspaceMembers.mockImplementation(() => new Promise(() => undefined))
    mocks.navigate.mockReset()
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
})
