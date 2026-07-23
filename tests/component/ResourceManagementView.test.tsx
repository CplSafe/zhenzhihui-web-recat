import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAssetDownloadUrl: vi.fn(),
  listAiTasks: vi.fn(),
  listAssets: vi.fn(),
  listCreativeProjects: vi.fn(),
  showToast: vi.fn(),
  user: { id: 7 },
  workspace: { id: 21 },
}))

vi.mock('@/components/home/AppSidebar', () => ({
  default: () => <nav aria-label="应用侧边栏" />,
}))

vi.mock('@/components/layout/AppTopbar', () => ({
  default: () => <header aria-label="应用顶栏" />,
}))

vi.mock('@/components/resource/RealPersonLibrary', () => ({
  default: () => null,
  REAL_PERSON_ASSET_SOURCE: 'real_person',
}))

vi.mock('@/components/common/AiBadge', () => ({
  default: () => null,
}))

vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => mocks.user,
  useWorkspaceId: () => mocks.workspace.id,
}))

vi.mock('@/composables/useSidebarNavigate', () => ({
  useSidebarNavigate: () => vi.fn(),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('@/api/business', () => ({
  extractAssetPage: (payload: { items?: unknown[]; limit?: number; offset?: number; total?: number } | null) => ({
    items: payload?.items ?? [],
    limit: payload?.limit ?? payload?.items?.length ?? 0,
    offset: payload?.offset ?? 0,
    total: payload?.total ?? payload?.items?.length ?? 0,
  }),
  extractAssetPageItems: (payload: { items?: unknown[] } | null) => payload?.items ?? [],
  getAssetDownloadUrl: mocks.getAssetDownloadUrl,
  getBusinessErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  listAiTasks: mocks.listAiTasks,
  listAssets: mocks.listAssets,
  listCreativeProjects: mocks.listCreativeProjects,
}))

import ResourceManagementView from '@/views/ResourceManagementView'
import { setFavoriteVideoUserScope } from '@/utils/favoriteVideos'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function asset(id: number, name: string, previewUrl = '') {
  return {
    created_at: '2026-07-17T00:00:00.000Z',
    id,
    mime_type: 'video/mp4',
    name,
    preview_url: previewUrl,
    source: 'upload',
    type: 'video',
  }
}

function project(id: number, title: string, assetId: number) {
  return {
    id,
    title,
    created_at: '2026-07-17T00:00:00.000Z',
    draft_json: {
      smart: {
        entryMeta: {
          imageAssetIds: [assetId],
          images: [`/api/assets/${assetId}`],
        },
      },
    },
  }
}

describe('ResourceManagementView workspace and favorite isolation', () => {
  beforeEach(() => {
    mocks.workspace.id = 21
    mocks.user.id = 7
    setFavoriteVideoUserScope('7')
    mocks.getAssetDownloadUrl.mockReset()
    mocks.listAiTasks.mockReset()
    mocks.listAiTasks.mockResolvedValue({ items: [] })
    mocks.listAssets.mockReset()
    mocks.listCreativeProjects.mockReset()
    mocks.listCreativeProjects.mockResolvedValue([])
    mocks.showToast.mockReset()
    window.history.replaceState({}, '', '/resources')
  })

  it('immediately hides A assets and closes its preview when switching to B', async () => {
    const workspaceB = deferred<{ items: unknown[] }>()
    mocks.listAssets.mockImplementation(({ workspaceId }: { workspaceId: number }) =>
      workspaceId === 21
        ? Promise.resolve({ items: [asset(501, 'Workspace A video', '/workspace-a.mp4')] })
        : workspaceB.promise,
    )

    const { rerender } = render(<ResourceManagementView />)
    const workspaceAVideo = await screen.findByLabelText('Workspace A video')
    fireEvent.click(workspaceAVideo)
    expect(await screen.findByText('Workspace A video')).toBeInTheDocument()

    mocks.workspace.id = 22
    rerender(<ResourceManagementView />)

    expect(screen.queryByText('Workspace A video')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Workspace A video')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('关闭预览')).not.toBeInTheDocument()
    expect(mocks.getAssetDownloadUrl).not.toHaveBeenCalledWith({ workspaceId: 22, assetId: 501 })

    await act(async () => {
      workspaceB.resolve({ items: [] })
    })
  })

  it('keeps B project data when the older A request resolves last', async () => {
    const workspaceA = deferred<unknown[]>()
    const workspaceB = deferred<unknown[]>()
    mocks.listAssets.mockResolvedValue({ items: [] })
    mocks.listCreativeProjects.mockImplementation(({ workspaceId }: { workspaceId: number }) =>
      workspaceId === 21 ? workspaceA.promise : workspaceB.promise,
    )

    const { rerender } = render(<ResourceManagementView />)
    fireEvent.click(screen.getByRole('button', { name: '我上传的' }))
    await waitFor(() =>
      expect(mocks.listCreativeProjects).toHaveBeenCalledWith({ workspaceId: 21, offset: 0, limit: 100 }),
    )

    mocks.workspace.id = 22
    rerender(<ResourceManagementView />)
    await waitFor(() =>
      expect(mocks.listCreativeProjects).toHaveBeenCalledWith({ workspaceId: 22, offset: 0, limit: 100 }),
    )

    await act(async () => {
      workspaceB.resolve([project(2, 'Workspace B project', 602)])
    })
    expect(await screen.findByText('Workspace B project')).toBeInTheDocument()

    await act(async () => {
      workspaceA.resolve([project(1, 'Workspace A stale project', 601)])
    })
    expect(screen.queryByText('Workspace A stale project')).not.toBeInTheDocument()
    expect(screen.getByText('Workspace B project')).toBeInTheDocument()
  })

  it('refreshes a legacy favorite by asset ID and falls back safely when refresh fails', async () => {
    window.localStorage.setItem(
      'zzh_favorite_videos_v2_u7_ws21',
      JSON.stringify([
        {
          key: 'a701',
          ratio: '16:9',
          thumbnailUrl: '',
          title: '可刷新收藏',
          ts: 2,
          videoUrl: '/expired.mp4',
        },
        {
          key: 'a702',
          ratio: '9:16',
          thumbnailUrl: '',
          title: '降级收藏',
          ts: 1,
          videoUrl: '/fallback.mp4',
        },
      ]),
    )
    mocks.listAssets.mockResolvedValue({ items: [] })
    mocks.getAssetDownloadUrl.mockImplementation(({ assetId }: { assetId: number }) =>
      assetId === 701 ? Promise.resolve('/fresh.mp4') : Promise.reject(new Error('temporary failure')),
    )

    render(<ResourceManagementView />)
    fireEvent.click(screen.getByRole('button', { name: '我收藏的' }))

    await waitFor(() => expect(mocks.getAssetDownloadUrl).toHaveBeenCalledWith({ workspaceId: 21, assetId: 701 }))
    await waitFor(() => expect(screen.getByLabelText('可刷新收藏')).toHaveAttribute('src', '/fresh.mp4'))
    expect(screen.getByLabelText('降级收藏')).toHaveAttribute('src', '/api/v1/assets/702/download?workspace_id=21')
  })

  it('refreshes collected cards when the account changes inside the same workspace', async () => {
    window.localStorage.setItem(
      'zzh_favorite_videos_v2_u7_ws21',
      JSON.stringify([
        {
          key: 'u/user-7.mp4',
          ratio: '16:9',
          thumbnailUrl: '',
          title: '用户 7 收藏',
          ts: 2,
          videoUrl: '/user-7.mp4',
        },
      ]),
    )
    window.localStorage.setItem(
      'zzh_favorite_videos_v2_u8_ws21',
      JSON.stringify([
        {
          key: 'u/user-8.mp4',
          ratio: '9:16',
          thumbnailUrl: '',
          title: '用户 8 收藏',
          ts: 1,
          videoUrl: '/user-8.mp4',
        },
      ]),
    )
    mocks.listAssets.mockResolvedValue({ items: [] })

    const { rerender } = render(<ResourceManagementView />)
    fireEvent.click(screen.getByRole('button', { name: '我收藏的' }))
    expect(await screen.findByLabelText('用户 7 收藏')).toHaveAttribute('src', '/user-7.mp4')

    mocks.user.id = 8
    setFavoriteVideoUserScope('8')
    rerender(<ResourceManagementView />)

    expect(screen.queryByLabelText('用户 7 收藏')).not.toBeInTheDocument()
    expect(await screen.findByLabelText('用户 8 收藏')).toHaveAttribute('src', '/user-8.mp4')
  })

  it('reloads workspace assets when the account changes inside the same workspace', async () => {
    mocks.listAssets
      .mockResolvedValueOnce({ items: [asset(751, '用户 7 素材', '/user-7-asset.mp4')] })
      .mockResolvedValueOnce({ items: [asset(752, '用户 8 素材', '/user-8-asset.mp4')] })

    const { rerender } = render(<ResourceManagementView />)
    expect(await screen.findByLabelText('用户 7 素材')).toBeInTheDocument()

    mocks.user.id = 8
    rerender(<ResourceManagementView />)

    expect(screen.queryByLabelText('用户 7 素材')).not.toBeInTheDocument()
    expect(await screen.findByLabelText('用户 8 素材')).toBeInTheDocument()
    expect(mocks.listAssets).toHaveBeenCalledTimes(2)
  })

  it('does not expose project media when the current member is restricted', async () => {
    mocks.listAssets.mockResolvedValue({ items: [] })
    mocks.listCreativeProjects.mockResolvedValue([
      {
        ...project(1, 'Restricted project', 601),
        user_id: 8,
        draft_json: {
          restrictedMemberIds: [7],
          smart: { entryMeta: { imageAssetIds: [601], images: ['/api/assets/601'] } },
        },
      },
      {
        ...project(2, 'Accessible project', 602),
        user_id: 8,
        draft_json: {
          restrictedMemberIds: [9],
          smart: { entryMeta: { imageAssetIds: [602], images: ['/api/assets/602'] } },
        },
      },
    ])

    render(<ResourceManagementView />)
    fireEvent.click(screen.getByRole('button', { name: '我上传的' }))

    expect(await screen.findByText('Accessible project')).toBeInTheDocument()
    expect(screen.queryByText('Restricted project')).not.toBeInTheDocument()
  })

  it('hides assets that explicitly reference a restricted project while keeping public and accessible assets', async () => {
    mocks.listAssets.mockResolvedValue({
      items: [
        { ...asset(701, 'Restricted linked asset', '/restricted.mp4'), project_id: 1 },
        { ...asset(702, 'Accessible linked asset', '/accessible.mp4'), projectId: 2 },
        asset(703, 'Workspace public asset', '/public.mp4'),
      ],
    })
    mocks.listCreativeProjects.mockResolvedValue([
      {
        id: 1,
        user_id: 8,
        draft_json: { restrictedMemberIds: [7] },
      },
      {
        id: 2,
        user_id: 8,
        draft_json: { restrictedMemberIds: [9] },
      },
    ])

    render(<ResourceManagementView />)

    expect(await screen.findByLabelText('Accessible linked asset')).toBeInTheDocument()
    expect(screen.getByLabelText('Workspace public asset')).toBeInTheDocument()
    expect(screen.queryByLabelText('Restricted linked asset')).not.toBeInTheDocument()
  })

  it('fails closed for project-linked assets when project permissions cannot be loaded', async () => {
    mocks.listAssets.mockResolvedValue({
      items: [
        { ...asset(701, 'Unknown linked asset', '/linked.mp4'), project_id: 1 },
        asset(702, 'Workspace public asset', '/public.mp4'),
      ],
    })
    mocks.listCreativeProjects.mockRejectedValue(new Error('permissions unavailable'))

    render(<ResourceManagementView />)

    expect(await screen.findByLabelText('Workspace public asset')).toBeInTheDocument()
    expect(screen.queryByLabelText('Unknown linked asset')).not.toBeInTheDocument()
  })

  it('renders the first asset page after one backend request instead of loading every page up front', async () => {
    mocks.listAssets.mockResolvedValue({
      items: [asset(801, '首屏素材', '/first-page.mp4')],
      limit: 100,
      offset: 0,
      total: 500,
    })

    render(<ResourceManagementView />)

    expect(await screen.findByLabelText('首屏素材')).toBeInTheDocument()
    expect(mocks.listAssets).toHaveBeenCalledTimes(1)
    expect(mocks.listAssets).toHaveBeenCalledWith({
      workspaceId: 21,
      type: '',
      status: 'active',
      source: '',
      offset: 0,
      limit: 100,
    })
  })

  it('searches the loaded page immediately and fetches another page only after explicit continuation', async () => {
    mocks.listAssets
      .mockResolvedValueOnce({
        items: [asset(811, '首屏足球素材', '/football-first.mp4')],
        limit: 100,
        offset: 0,
        total: 300,
      })
      .mockResolvedValueOnce({
        items: [asset(812, '后续足球素材', '/football-next.mp4')],
        limit: 100,
        offset: 100,
        total: 300,
      })

    render(<ResourceManagementView />)
    expect(await screen.findByLabelText('首屏足球素材')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('搜索素材名称、关键词'), {
      target: { value: '足球' },
    })
    expect(await screen.findByLabelText('首屏足球素材')).toBeInTheDocument()
    expect(mocks.listAssets).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '继续搜索更多素材' }))
    await waitFor(() => expect(mocks.listAssets).toHaveBeenCalledTimes(2))
    expect(await screen.findByLabelText('后续足球素材')).toBeInTheDocument()
  })

  it('loads another raw page when filtering leaves the requested visible page empty', async () => {
    const hiddenPeople = Array.from({ length: 90 }, (_, index) => ({
      ...asset(1200 + index, `真人素材 ${index + 1}`),
      source: 'real_person',
    }))
    const firstVisible = Array.from({ length: 10 }, (_, index) =>
      asset(1300 + index, `首批可见素材 ${index + 1}`, `/visible-first-${index + 1}.mp4`),
    )
    const nextVisible = Array.from({ length: 30 }, (_, index) =>
      asset(1400 + index, `后续可见素材 ${index + 1}`, `/visible-next-${index + 1}.mp4`),
    )
    mocks.listAssets
      .mockResolvedValueOnce({
        items: [...hiddenPeople, ...firstVisible],
        limit: 100,
        offset: 0,
        total: 200,
      })
      .mockResolvedValueOnce({
        items: nextVisible,
        limit: 100,
        offset: 100,
        total: 130,
      })

    render(<ResourceManagementView />)
    expect(await screen.findByLabelText('首批可见素材 1')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('2'))

    await waitFor(() => expect(mocks.listAssets).toHaveBeenCalledTimes(2))
    expect(await screen.findByLabelText('后续可见素材 11')).toBeInTheDocument()
  })

  it('keeps an already loaded asset page when loading a later page fails', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      asset(900 + index, `已加载素材 ${index + 1}`, `/loaded-${index + 1}.mp4`),
    )
    mocks.listAssets
      .mockResolvedValueOnce({
        items: firstPage,
        limit: 100,
        offset: 0,
        total: 150,
      })
      .mockRejectedValueOnce(new Error('next page failed'))

    render(<ResourceManagementView />)

    expect(await screen.findByLabelText('已加载素材 1')).toBeInTheDocument()
    fireEvent.click(await screen.findByTitle('8'))
    await waitFor(() => expect(mocks.listAssets).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('next page failed', 'error'))

    fireEvent.click(screen.getByTitle('1'))
    expect(await screen.findByLabelText('已加载素材 1')).toBeInTheDocument()
  })

  it('keeps the selected project open and searches its material names and tags', async () => {
    mocks.listAssets.mockResolvedValue({
      items: [
        {
          created_at: '2026-07-17T00:00:00.000Z',
          id: 601,
          mime_type: 'image/png',
          name: '海边人物',
          preview_url: '/portrait.png',
          source: 'upload',
          tags: ['夏日'],
          type: 'image',
        },
      ],
      limit: 100,
      offset: 0,
      total: 1,
    })
    mocks.listCreativeProjects.mockResolvedValue([project(1, '足球项目', 601)])

    render(<ResourceManagementView />)
    fireEvent.click(screen.getByRole('button', { name: '我上传的' }))
    const projectCard = (await screen.findByText('足球项目')).closest('button')
    expect(projectCard).not.toBeNull()
    fireEvent.click(projectCard!)

    const search = screen.getByPlaceholderText('搜索素材名称、关键词')
    fireEvent.change(search, { target: { value: '海边' } })
    expect(await screen.findByAltText('海边人物')).toBeInTheDocument()
    expect(screen.getByText('足球项目')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: '夏日' } })
    expect(await screen.findByAltText('海边人物')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: '不存在' } })
    expect(await screen.findByText('该项目暂无此类素材')).toBeInTheDocument()
    expect(screen.getByText('足球项目')).toBeInTheDocument()
  })
})
