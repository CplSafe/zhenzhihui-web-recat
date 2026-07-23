import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addClassifiedVideo: vi.fn(),
  createCreativeProject: vi.fn(),
  createInitializedProjectFolder: vi.fn(),
  deleteCreativeProject: vi.fn(),
  getAssetDownloadUrl: vi.fn(),
  getCreativeProject: vi.fn(),
  listAssets: vi.fn(),
  listCreativeProjects: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  navigate: vi.fn(),
  requestConfirm: vi.fn(),
  showToast: vi.fn(),
  updateCreativeProjectDraft: vi.fn(),
  workspace: { id: 21 },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('antd', () => ({
  Pagination: () => null,
}))

vi.mock('@/components/home/AppSidebar', () => ({
  default: () => <nav aria-label="应用侧边栏" />,
}))

vi.mock('@/components/layout/AppTopbar', () => ({
  default: () => <header aria-label="应用顶栏" />,
}))

vi.mock('@/components/common/UserAvatar', () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}))

vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => ({ id: 7, nickname: '测试用户' }),
  useCurrentWorkspace: () => ({ id: mocks.workspace.id, type: 'team' }),
  useWorkspaceId: () => mocks.workspace.id,
}))

vi.mock('@/api/auth', () => ({
  listWorkspaceMembers: mocks.listWorkspaceMembers,
}))

vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: mocks.requestConfirm }),
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('@/stores/ui', () => ({
  openComingSoon: vi.fn(),
}))

vi.mock('@/api/projectVideos', () => ({
  addClassifiedVideo: mocks.addClassifiedVideo,
  countProjectVideos: () => 0,
  readProjectVideoStore: () => ({ records: [], overrides: {} }),
}))

vi.mock('@/api/business', () => ({
  createCreativeProject: mocks.createCreativeProject,
  deleteCreativeProject: mocks.deleteCreativeProject,
  extractAssetPage: (payload: { items?: unknown[]; limit?: number; offset?: number; total?: number }) => ({
    items: payload?.items ?? [],
    limit: payload?.limit ?? payload?.items?.length ?? 0,
    offset: payload?.offset ?? 0,
    total: payload?.total ?? payload?.items?.length ?? 0,
  }),
  extractAssetPageItems: (payload: { items?: unknown[] }) => payload?.items ?? [],
  getAssetDownloadUrl: mocks.getAssetDownloadUrl,
  getBusinessErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  getCreativeProject: mocks.getCreativeProject,
  listAssets: mocks.listAssets,
  listCreativeProjects: mocks.listCreativeProjects,
  updateCreativeProjectDraft: mocks.updateCreativeProjectDraft,
}))

vi.mock('@/utils/creativeProjectInitialization', () => ({
  createInitializedProjectFolder: mocks.createInitializedProjectFolder,
}))

import ProjectManagementView from '@/views/ProjectManagementView'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function project(id: number, title: string) {
  return {
    id,
    title,
    user_id: 7,
    created_at: '2026-07-17T00:00:00.000Z',
    draft_json: { flow: 'smart', smart: {} },
  }
}

function looseAsset(id: number, name: string, projectId = 0) {
  return { id, name, source: 'generate', ...(projectId ? { project_id: projectId } : {}) }
}

function looseVideoButton(title: string): HTMLElement {
  const card = screen.getByText(title).closest('.pm2-vid')
  const button = card?.querySelector<HTMLElement>('[role="button"]')
  if (!button) throw new Error(`找不到散视频按钮: ${title}`)
  return button
}

describe('ProjectManagementView workspace isolation', () => {
  beforeEach(() => {
    mocks.workspace.id = 21
    mocks.addClassifiedVideo.mockReset()
    mocks.createCreativeProject.mockReset()
    mocks.createInitializedProjectFolder.mockReset()
    mocks.deleteCreativeProject.mockReset()
    mocks.getAssetDownloadUrl.mockReset()
    mocks.getCreativeProject.mockReset()
    mocks.listAssets.mockReset()
    mocks.listCreativeProjects.mockReset()
    mocks.listWorkspaceMembers.mockReset()
    mocks.listWorkspaceMembers.mockResolvedValue([])
    mocks.navigate.mockReset()
    mocks.requestConfirm.mockReset()
    mocks.showToast.mockReset()
    mocks.updateCreativeProjectDraft.mockReset()
  })

  it('ignores the deferred A response after switching to workspace B', async () => {
    const workspaceA = deferred<unknown[]>()
    const workspaceB = deferred<unknown[]>()
    mocks.listCreativeProjects.mockImplementation(({ workspaceId }: { workspaceId: number }) =>
      workspaceId === 21 ? workspaceA.promise : workspaceB.promise,
    )
    mocks.listAssets.mockResolvedValue({ items: [] })

    const { rerender } = render(<ProjectManagementView />)
    await waitFor(() =>
      expect(mocks.listCreativeProjects).toHaveBeenCalledWith({ workspaceId: 21, offset: 0, limit: 100 }),
    )

    mocks.workspace.id = 22
    rerender(<ProjectManagementView />)
    await waitFor(() =>
      expect(mocks.listCreativeProjects).toHaveBeenCalledWith({ workspaceId: 22, offset: 0, limit: 100 }),
    )

    await act(async () => {
      workspaceB.resolve([project(2, 'Workspace B project')])
    })
    expect(await screen.findAllByText('Workspace B project')).not.toHaveLength(0)

    await act(async () => {
      workspaceA.resolve([project(1, 'Workspace A stale project')])
    })
    await waitFor(() => expect(screen.queryAllByText('Workspace A stale project')).toHaveLength(0))
    expect(screen.getAllByText('Workspace B project')).not.toHaveLength(0)
    expect(mocks.listAssets).not.toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }))
  })

  it('immediately hides A projects, loose videos, and an open player while B is loading', async () => {
    const workspaceB = deferred<unknown[]>()
    mocks.listCreativeProjects.mockImplementation(({ workspaceId }: { workspaceId: number }) =>
      workspaceId === 21 ? Promise.resolve([project(1, 'Workspace A project')]) : workspaceB.promise,
    )
    mocks.listAssets.mockImplementation(({ workspaceId }: { workspaceId: number }) =>
      Promise.resolve({ items: workspaceId === 21 ? [looseAsset(501, 'Workspace A loose video')] : [] }),
    )
    mocks.getAssetDownloadUrl.mockResolvedValue('/workspace-a.mp4')

    const { rerender } = render(<ProjectManagementView />)
    expect(await screen.findAllByText('Workspace A project')).not.toHaveLength(0)
    expect(await screen.findByText('Workspace A loose video')).toBeInTheDocument()

    fireEvent.click(looseVideoButton('Workspace A loose video'))
    expect(await screen.findByRole('dialog', { name: '视频播放' })).toBeInTheDocument()

    mocks.workspace.id = 22
    rerender(<ProjectManagementView />)

    expect(screen.queryAllByText('Workspace A project')).toHaveLength(0)
    expect(screen.queryByText('Workspace A loose video')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '视频播放' })).not.toBeInTheDocument()

    await act(async () => {
      workspaceB.resolve([])
    })
  })

  it('does not reopen the player when an A download URL resolves after switching to B', async () => {
    const downloadUrl = deferred<string>()
    const workspaceB = deferred<unknown[]>()
    mocks.listCreativeProjects.mockImplementation(({ workspaceId }: { workspaceId: number }) =>
      workspaceId === 21 ? Promise.resolve([project(1, 'Workspace A project')]) : workspaceB.promise,
    )
    mocks.listAssets.mockImplementation(({ workspaceId }: { workspaceId: number }) =>
      Promise.resolve({ items: workspaceId === 21 ? [looseAsset(501, 'Workspace A loose video')] : [] }),
    )
    mocks.getAssetDownloadUrl.mockReturnValue(downloadUrl.promise)

    const { rerender } = render(<ProjectManagementView />)
    expect(await screen.findByText('Workspace A loose video')).toBeInTheDocument()
    fireEvent.click(looseVideoButton('Workspace A loose video'))

    mocks.workspace.id = 22
    rerender(<ProjectManagementView />)
    await act(async () => {
      downloadUrl.resolve('/workspace-a-late.mp4')
    })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '视频播放' })).not.toBeInTheDocument())
    expect(mocks.showToast).not.toHaveBeenCalled()

    await act(async () => {
      workspaceB.resolve([])
    })
  })

  it('hides a project only when the current member is in its restriction list', async () => {
    mocks.listCreativeProjects.mockResolvedValue([
      {
        ...project(1, 'Restricted project'),
        user_id: 8,
        draft_json: { flow: 'smart', restrictedMemberIds: [7], smart: {} },
      },
      {
        ...project(2, 'Accessible project'),
        user_id: 8,
        draft_json: { flow: 'smart', restrictedMemberIds: [9], smart: {} },
      },
    ])
    mocks.listAssets.mockResolvedValue({ items: [] })

    render(<ProjectManagementView />)

    expect(await screen.findAllByText('Accessible project')).not.toHaveLength(0)
    expect(screen.queryAllByText('Restricted project')).toHaveLength(0)
  })

  it('does not expose a restricted legacy project video in the unclassified section', async () => {
    mocks.listCreativeProjects.mockResolvedValue([
      {
        ...project(1, 'Restricted legacy video'),
        user_id: 8,
        draft_json: {
          flow: 'legacy',
          restrictedMemberIds: [7],
          generatedVideoAssetId: 701,
        },
      },
      {
        ...project(2, 'Accessible legacy video'),
        user_id: 8,
        draft_json: {
          flow: 'legacy',
          restrictedMemberIds: [9],
          generatedVideoAssetId: 702,
        },
      },
    ])
    mocks.listAssets.mockResolvedValue({ items: [] })

    render(<ProjectManagementView />)

    expect(await screen.findAllByText('Accessible legacy video')).not.toHaveLength(0)
    expect(screen.queryAllByText('Restricted legacy video')).toHaveLength(0)
  })

  it('shows only unlinked or accessible-project assets after project permissions load', async () => {
    mocks.listCreativeProjects.mockResolvedValue([
      {
        ...project(1, 'Restricted project'),
        user_id: 8,
        draft_json: { flow: 'smart', restrictedMemberIds: [7], smart: {} },
      },
      {
        ...project(2, 'Accessible project'),
        user_id: 8,
        draft_json: { flow: 'smart', restrictedMemberIds: [9], smart: {} },
      },
    ])
    mocks.listAssets.mockResolvedValue({
      items: [
        looseAsset(501, 'Unlinked video'),
        looseAsset(502, 'Accessible linked video', 2),
        looseAsset(503, 'Restricted linked video', 1),
        looseAsset(504, 'Unknown linked video', 999),
      ],
    })

    render(<ProjectManagementView />)

    expect(await screen.findByText('Unlinked video')).toBeInTheDocument()
    expect(await screen.findByText('Accessible linked video')).toBeInTheDocument()
    expect(screen.queryByText('Restricted linked video')).not.toBeInTheDocument()
    expect(screen.queryByText('Unknown linked video')).not.toBeInTheDocument()
  })

  it('fails closed for linked assets when the project permission list fails', async () => {
    mocks.listCreativeProjects.mockRejectedValue(new Error('project list unavailable'))
    mocks.listAssets.mockResolvedValue({
      items: [looseAsset(501, 'Unlinked fallback video'), looseAsset(502, 'Linked hidden video', 2)],
    })

    render(<ProjectManagementView />)

    expect(await screen.findByText('Unlinked fallback video')).toBeInTheDocument()
    expect(screen.queryByText('Linked hidden video')).not.toBeInTheDocument()
  })

  it('uses the latest successful generated image and opens image projects in the image workspace', async () => {
    const user = userEvent.setup()
    mocks.listCreativeProjects.mockResolvedValue([
      {
        ...project(31, '图片项目'),
        draft_json: {
          flow: 'smart',
          smart: {
            entryMeta: { mode: 'image', ratio: '1:1' },
            imageMessages: [
              { id: 'user-1', role: 'user', text: '制作商品主图' },
              { id: 'assistant-1', role: 'assistant', status: 'done', images: [{ assetId: 701 }] },
              { id: 'assistant-2', role: 'assistant', status: 'error', images: [{ assetId: 999 }] },
              { id: 'assistant-3', role: 'assistant', status: 'done', images: [{ assetId: 703 }] },
            ],
          },
        },
      },
    ])
    mocks.listAssets.mockResolvedValue({ items: [] })

    render(<ProjectManagementView />)

    const card = await screen.findByRole('button', { name: '打开项目 图片项目' })
    expect(within(card).getByText(/2 张图片/)).toBeInTheDocument()
    expect(card.querySelector('.pm2-pcard-cover-media')).toHaveAttribute(
      'src',
      '/api/v1/assets/703/download?workspace_id=21',
    )

    await user.click(card)
    expect(mocks.navigate).toHaveBeenCalledWith('/smart/31')
  })

  it('keeps an initialized project after remount without duplicating it', async () => {
    const user = userEvent.setup()
    const projectName = '刷新后仍存在的项目'
    let backendProjects: any[] = [project(1, '原有项目')]

    mocks.listCreativeProjects.mockImplementation(() => Promise.resolve([...backendProjects]))
    mocks.listAssets.mockResolvedValue({ items: [] })
    mocks.createInitializedProjectFolder.mockImplementation(
      async ({ title }: { workspaceId: number; title: string }) => {
        const created = {
          ...project(2, title),
          draft_json: { projectVideoStore: { records: [], overrides: {} } },
          draft_revision: 1,
        }
        backendProjects = [created, ...backendProjects]
        return created
      },
    )

    const firstMount = render(<ProjectManagementView />)
    expect(await screen.findAllByText('原有项目')).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '＋ 新建项目' }))
    const dialog = await screen.findByRole('dialog', { name: '创建项目' })
    await user.type(within(dialog).getByPlaceholderText('给项目起个名字…'), projectName)
    await user.click(within(dialog).getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(mocks.createInitializedProjectFolder).toHaveBeenCalledWith({ workspaceId: 21, title: projectName }),
    )
    await waitFor(() => expect(screen.getAllByRole('button', { name: new RegExp(projectName) })).toHaveLength(1))

    firstMount.unmount()
    render(<ProjectManagementView />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: new RegExp(projectName) })).toHaveLength(1))
    expect(mocks.createInitializedProjectFolder).toHaveBeenCalledTimes(1)
  })
})
