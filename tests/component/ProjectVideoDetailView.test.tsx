// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteProjectVideo: vi.fn(),
  downloadToDisk: vi.fn(),
  getProjectVideo: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  navigate: vi.fn(),
  requestConfirm: vi.fn(),
  showToast: vi.fn(),
  route: {
    projectId: '88',
    videoId: 'missing-video',
  },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ ...mocks.route }),
  useSearchParams: () => [new URLSearchParams()],
}))

vi.mock('@/components/home/AppSidebar', () => ({
  default: () => <nav aria-label="应用侧边栏" />,
}))

vi.mock('@/components/layout/AppTopbar', () => ({
  default: () => <header aria-label="应用顶栏" />,
}))

vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => ({ id: 7, nickname: '测试用户' }),
  useCurrentWorkspace: () => ({}),
  useWorkspaceId: () => 21,
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
  getProjectVideo: mocks.getProjectVideo,
  getVideoStatusText: (status: string) => (status === 'published' ? '已发布' : '草稿'),
}))

vi.mock('@/utils/downloadToDisk', () => ({
  buildDownloadName: (title: string) => `${title}.mp4`,
  downloadToDisk: mocks.downloadToDisk,
}))

// 模型目录只在「老视频只有 modelVersionId、没名字快照」时用来翻名字；这里给一个能按 id 查到的小目录
vi.mock('@/composables/useGenerationModelCatalog', () => ({
  useGenerationModelCatalog: () => ({
    groups: [],
    pickerGroups: [],
    loading: false,
    error: '',
    operationStates: {},
    reload: () => {},
    resolveModel: (_operation: string, modelVersionId: unknown) =>
      Number(modelVersionId) === 9 ? { display_name: 'Seedance 1.0 Pro' } : null,
  }),
}))

import ProjectVideoDetailView from '@/views/ProjectVideoDetailView'

const validVideo = {
  id: 'derived-video-42-1',
  projectId: 88,
  workspaceId: 21,
  title: '测试成片',
  coverUrl: '',
  videoUrl: '/api/v1/assets/42/download?workspace_id=21',
  videoAssetId: 42,
  durationSeconds: 12,
  status: 'published' as const,
  createdByName: '测试用户',
  createdByUserId: 7,
  createdAt: '2026-07-15T08:00:00.000Z',
  updatedAt: '2026-07-15T09:00:00.000Z',
  sourceType: 'smart' as const,
  flow: 'smart',
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('ProjectVideoDetailView videoId 防护', () => {
  beforeEach(() => {
    mocks.route.projectId = '88'
    mocks.route.videoId = 'missing-video'
    mocks.deleteProjectVideo.mockReset()
    mocks.downloadToDisk.mockReset()
    mocks.getProjectVideo.mockReset()
    mocks.listWorkspaceMembers.mockReset()
    mocks.listWorkspaceMembers.mockImplementation(() => new Promise(() => undefined))
    mocks.navigate.mockReset()
    mocks.requestConfirm.mockReset()
    mocks.showToast.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('错误 videoId 返回 null 时不渲染其他视频，也不给出删除入口', async () => {
    mocks.getProjectVideo.mockResolvedValue({
      project: { id: 88, title: '测试项目' },
      video: null,
    })

    render(<ProjectVideoDetailView />)

    expect(await screen.findByText('未找到该视频记录')).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1, name: validVideo.title })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除视频' })).toBeNull()
    expect(mocks.deleteProjectVideo).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mocks.getProjectVideo).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 88, videoId: 'missing-video', workspaceId: 21 }),
      )
    })
  })

  it('项目创建者可查看、下载和删除匹配的视频', async () => {
    mocks.route.videoId = validVideo.id
    mocks.getProjectVideo.mockResolvedValue({
      project: { id: 88, title: '测试项目', user_id: 7 },
      video: validVideo,
    })

    render(<ProjectVideoDetailView />)

    expect(await screen.findByRole('heading', { level: 1, name: validVideo.title })).toBeTruthy()
    expect(await screen.findByRole('button', { name: '下载视频' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: '删除视频' })).toBeTruthy()
    expect(screen.queryByText('未找到该视频记录')).toBeNull()
    expect(screen.queryByText(/当前详情页已经具备/)).toBeNull()
  })

  it('普通成员即使是视频创建者也可以查看和下载，但不能删除', async () => {
    mocks.route.videoId = validVideo.id
    mocks.getProjectVideo.mockResolvedValue({
      project: { id: 88, title: '团队项目', user_id: 99 },
      video: { ...validVideo, createdByUserId: 7 },
    })

    render(<ProjectVideoDetailView />)

    expect(await screen.findByRole('heading', { level: 1, name: validVideo.title })).toBeTruthy()
    expect(await screen.findByRole('button', { name: '下载视频' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: '进入编辑' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '删除视频' })).toBeNull()
  })

  it('进入编辑时通过查询参数保留详情页对应的视频版本', async () => {
    const selectedVideo = {
      ...validVideo,
      id: 'derived/video 42+final',
      videoUrl: 'https://media.example/video.mp4?signature=do-not-copy',
    }
    mocks.route.videoId = selectedVideo.id
    mocks.getProjectVideo.mockResolvedValue({
      project: { id: 88, title: '版本项目', user_id: 7 },
      video: selectedVideo,
    })

    render(<ProjectVideoDetailView />)
    expect(await screen.findByRole('heading', { level: 1, name: selectedVideo.title })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '进入编辑' }))

    expect(mocks.navigate).toHaveBeenCalledWith(
      '/smart/88?workspace_id=21&video_id=derived%2Fvideo+42%2Bfinal&video_asset_id=42',
      {
        state: {
          projectVideoSelection: {
            projectId: 88,
            workspaceId: 21,
            videoId: 'derived/video 42+final',
            videoAssetId: 42,
          },
        },
      },
    )
    expect(JSON.stringify(mocks.navigate.mock.calls[mocks.navigate.mock.calls.length - 1])).not.toContain('do-not-copy')
  })

  it('空间管理员可以删除其他人项目中的视频', async () => {
    mocks.route.videoId = validVideo.id
    mocks.listWorkspaceMembers.mockResolvedValue([{ user_id: 7, member_role: 'admin' }])
    mocks.getProjectVideo.mockResolvedValue({
      project: { id: 88, title: '团队项目', user_id: 99 },
      video: { ...validVideo, createdByUserId: 99 },
    })

    render(<ProjectVideoDetailView />)

    expect(await screen.findByRole('heading', { level: 1, name: validVideo.title })).toBeTruthy()
    expect(await screen.findByRole('button', { name: '下载视频' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: '删除视频' })).toBeTruthy()
  })

  it('删除期间同一路由重新加载详情时仍处理已完成的删除结果', async () => {
    const membersRequest = createDeferred<any[]>()
    const deleteRequest = createDeferred<void>()
    mocks.route.videoId = validVideo.id
    mocks.listWorkspaceMembers.mockReturnValue(membersRequest.promise)
    mocks.getProjectVideo.mockResolvedValue({
      project: { id: 88, title: '测试项目', user_id: 7 },
      video: validVideo,
    })
    mocks.requestConfirm.mockResolvedValue(true)
    mocks.deleteProjectVideo.mockReturnValue(deleteRequest.promise)

    render(<ProjectVideoDetailView />)

    fireEvent.click(await screen.findByRole('button', { name: '删除视频' }))
    await waitFor(() => {
      expect(mocks.deleteProjectVideo).toHaveBeenCalledWith({
        projectId: 88,
        workspaceId: 21,
        videoId: validVideo.id,
      })
    })

    await act(async () => {
      membersRequest.resolve([{ user_id: 7, member_role: 'admin' }])
      await membersRequest.promise
    })
    await waitFor(() => {
      expect(mocks.getProjectVideo).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      deleteRequest.resolve()
      await deleteRequest.promise
    })

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith('视频已删除', 'success')
      expect(mocks.navigate).toHaveBeenCalledWith('/projects/88/videos')
    })
  })

  it('受限成员通过详情直链访问时跳回项目管理且不展示视频', async () => {
    mocks.route.videoId = validVideo.id
    mocks.getProjectVideo.mockResolvedValue({
      project: {
        id: 88,
        title: '受限项目',
        user_id: 99,
        draft_json: { restrictedMemberIds: [7] },
      },
      video: validVideo,
    })

    render(<ProjectVideoDetailView />)

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/projects', { replace: true })
    })
    expect(mocks.showToast).toHaveBeenCalledWith('您没有权限访问该项目', 'error')
    expect(screen.queryByRole('heading', { level: 1, name: validVideo.title })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除视频' })).toBeNull()
  })
})

describe('ProjectVideoDetailView 基础信息：分辨率与生成模型', () => {
  beforeEach(() => {
    mocks.route.projectId = '88'
    mocks.route.videoId = validVideo.id
    mocks.getProjectVideo.mockReset()
    mocks.listWorkspaceMembers.mockReset()
    mocks.listWorkspaceMembers.mockImplementation(() => new Promise(() => undefined))
    mocks.showToast.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('版本自带模型名快照时直接展示，并从播放器元数据读出真实分辨率', async () => {
    mocks.getProjectVideo.mockResolvedValue({
      project: { id: 88, title: '测试项目', user_id: 7 },
      video: { ...validVideo, ratio: '16:9', modelVersionId: 4, modelName: 'Seedance 1.5' },
    })
    render(<ProjectVideoDetailView />)
    expect(await screen.findByRole('heading', { level: 1, name: validVideo.title })).toBeTruthy()

    expect(screen.getByText('生成模型')).toBeTruthy()
    expect(screen.getByText('Seedance 1.5')).toBeTruthy()
    expect(screen.queryByText('（推断）')).toBeNull()

    // 分辨率不存草稿，直接从 <video> 的元数据读真实像素
    expect(screen.getByText('分辨率')).toBeTruthy()
    const video = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 })
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 })
    fireEvent.loadedMetadata(video)
    expect(await screen.findByText('1920 × 1080（16:9）')).toBeTruthy()
  })

  it('老视频只按项目级推断出模型时，从目录翻名字并标明「推断」', async () => {
    mocks.getProjectVideo.mockResolvedValue({
      project: { id: 88, title: '测试项目', user_id: 7 },
      video: { ...validVideo, modelVersionId: 9, modelInferred: true },
    })
    render(<ProjectVideoDetailView />)
    expect(await screen.findByRole('heading', { level: 1, name: validVideo.title })).toBeTruthy()
    expect(screen.getByText('Seedance 1.0 Pro')).toBeTruthy()
    expect(screen.getByText('（推断）')).toBeTruthy()
  })

  it('没有任何模型信息时显示占位', async () => {
    mocks.getProjectVideo.mockResolvedValue({
      project: { id: 88, title: '测试项目', user_id: 7 },
      video: validVideo,
    })
    render(<ProjectVideoDetailView />)
    expect(await screen.findByRole('heading', { level: 1, name: validVideo.title })).toBeTruthy()
    const modelRow = screen.getByText('生成模型').closest('div') as HTMLElement
    expect(modelRow.querySelector('dd')?.textContent).toBe('--')
  })
})
