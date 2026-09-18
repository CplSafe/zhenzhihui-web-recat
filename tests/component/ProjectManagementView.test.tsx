import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addClassifiedVideo: vi.fn(),
  createCreativeProject: vi.fn(),
  createInitializedProjectFolder: vi.fn(),
  deleteCreativeProject: vi.fn(),
  fetchAllCanvasElements: vi.fn(),
  getAssetDownloadUrl: vi.fn(),
  getCreativeProject: vi.fn(),
  listAssets: vi.fn(),
  listCanvases: vi.fn(),
  listCreativeProjects: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  navigate: vi.fn(),
  requestConfirm: vi.fn(),
  showToast: vi.fn(),
  updateCreativeProjectDraft: vi.fn(),
  workspace: { id: 21, type: 'team' },
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
  useCurrentWorkspace: () => ({ id: mocks.workspace.id, type: mocks.workspace.type }),
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
  // 「生成模型」筛选按项目派生视频取模型名；用例通过 draft_json.__testModels 声明该项目用过哪些模型
  deriveProjectVideos: ({ project }: any) =>
    (project?.draft_json?.__testModels || []).map((modelName: string) => ({ modelName })),
  readProjectVideoStore: () => ({ records: [], overrides: {} }),
}))

// 模型目录只用于把老视频的 modelVersionId 翻成名字；本文件不测这条，给个不发请求的空目录
vi.mock('@/composables/useGenerationModelCatalog', () => ({
  useGenerationModelCatalog: () => ({
    groups: [],
    pickerGroups: [],
    loading: false,
    error: '',
    operationStates: {},
    reload: () => {},
    resolveModel: () => null,
  }),
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

vi.mock('@/api/canvasApi', () => ({
  fetchAllCanvasElements: mocks.fetchAllCanvasElements,
  listCanvases: mocks.listCanvases,
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
    mocks.workspace.type = 'team'
    localStorage.clear()
    mocks.addClassifiedVideo.mockReset()
    mocks.createCreativeProject.mockReset()
    mocks.createInitializedProjectFolder.mockReset()
    mocks.deleteCreativeProject.mockReset()
    mocks.fetchAllCanvasElements.mockReset()
    mocks.fetchAllCanvasElements.mockResolvedValue({ elements: [] })
    mocks.getAssetDownloadUrl.mockReset()
    mocks.getCreativeProject.mockReset()
    mocks.listAssets.mockReset()
    mocks.listCanvases.mockReset()
    mocks.listCanvases.mockResolvedValue([])
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

  it('按生成模型筛选：选项只列真用过的模型，选中后只留用过该模型的项目', async () => {
    const user = userEvent.setup()
    mocks.listCreativeProjects.mockResolvedValue([
      {
        ...project(1, 'Seedance project'),
        user_id: 7,
        draft_json: { flow: 'smart', smart: {}, __testModels: ['Seedance 1.5'] },
      },
      {
        ...project(2, 'Banana project'),
        user_id: 7,
        draft_json: { flow: 'smart', smart: {}, __testModels: ['Nano Banana 2'] },
      },
    ])
    mocks.listAssets.mockResolvedValue({ items: [] })

    render(<ProjectManagementView />)
    expect(await screen.findAllByText('Seedance project')).not.toHaveLength(0)
    expect(screen.queryAllByText('Banana project')).not.toHaveLength(0)

    // 下拉只列数据里真出现过的两个模型 + 全部
    await user.click(screen.getByRole('button', { name: '按生成模型筛选' }))
    const listbox = screen.getByRole('listbox', { name: '按生成模型筛选' })
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((el) => el.textContent),
    ).toEqual(['全部模型', 'Nano Banana 2', 'Seedance 1.5'])

    // 选 Seedance → 只剩用过它的项目
    await user.click(within(listbox).getByRole('option', { name: 'Seedance 1.5' }))
    await waitFor(() => expect(screen.queryAllByText('Banana project')).toHaveLength(0))
    expect(screen.queryAllByText('Seedance project')).not.toHaveLength(0)
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

  it('hides videos referenced by canvas nodes from the unclassified section', async () => {
    mocks.listCreativeProjects.mockResolvedValue([])
    mocks.listAssets.mockResolvedValue({
      items: [
        looseAsset(601, 'Canvas result video'),
        looseAsset(602, 'Canvas poster video'),
        looseAsset(603, 'Canvas timeline clip'),
        looseAsset(604, 'Genuinely loose video'),
      ],
    })
    mocks.listCanvases.mockResolvedValue([{ id: 5 }, { id: 6 }])
    mocks.fetchAllCanvasElements.mockImplementation(async ({ canvasId }: { canvasId: number }) => ({
      elements:
        canvasId === 5
          ? [
              { element_id: 'n1', kind: 'node', payload: { data: { kind: 'video', assetId: 601 } } },
              { element_id: 'n2', kind: 'node', payload: { data: { kind: 'video', posterAssetId: 602 } } },
              { element_id: 'e1', kind: 'edge', payload: { source: 'n1', target: 'n2' } },
            ]
          : [
              {
                element_id: 't1',
                kind: 'node',
                payload: { data: { kind: 'timeline', timeline: { clips: [{ assetId: 603 }] } } },
              },
              { element_id: 'gone', kind: 'node', op: 'delete', payload: { data: { assetId: 604 } } },
            ],
    }))

    render(<ProjectManagementView />)

    expect(await screen.findByText('Genuinely loose video')).toBeInTheDocument()
    expect(screen.queryByText('Canvas result video')).not.toBeInTheDocument()
    expect(screen.queryByText('Canvas poster video')).not.toBeInTheDocument()
    expect(screen.queryByText('Canvas timeline clip')).not.toBeInTheDocument()
    expect(mocks.listCanvases).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21, includeArchived: true }))
  })

  it('keeps every loose video visible when the canvas list request fails', async () => {
    mocks.listCreativeProjects.mockResolvedValue([])
    mocks.listAssets.mockResolvedValue({ items: [looseAsset(701, 'Survives canvas outage')] })
    mocks.listCanvases.mockRejectedValue(new Error('canvas service down'))

    render(<ProjectManagementView />)

    expect(await screen.findByText('Survives canvas outage')).toBeInTheDocument()
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

  it('team space filters projects by owner via 只看我的 and the member dropdown, remembered per workspace', async () => {
    const user = userEvent.setup()
    mocks.listWorkspaceMembers.mockResolvedValue([
      { id: 7, nickname: '测试用户' },
      { id: 8, nickname: '同事乙' },
    ])
    const all = [
      project(1, '我的项目A'),
      { ...project(2, '乙的项目B'), user_id: 8 },
      // 归属字段是同事乙,但后端 mine=true 判为「我的」(如协作创建):以后端口径为准
      { ...project(3, '协作项目C'), user_id: 8 },
    ]
    mocks.listCreativeProjects.mockImplementation(({ mine }: { mine?: boolean } = {}) =>
      Promise.resolve(mine ? [all[0], all[2]] : all),
    )
    mocks.listAssets.mockResolvedValue({ items: [] })

    render(<ProjectManagementView />)
    expect(await screen.findByRole('button', { name: '打开项目 我的项目A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开项目 乙的项目B' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '只看我的' }))
    // mine=true 判定优先:协作项目C 归属字段虽是乙,仍算「我的」
    expect(screen.getByRole('button', { name: '打开项目 我的项目A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开项目 协作项目C' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开项目 乙的项目B' })).not.toBeInTheDocument()
    // 选择按空间记忆:下次进页默认仍是自己的项目
    expect(localStorage.getItem('zzh.pm.ownerFilter.21')).toBe('7')

    await user.click(screen.getByRole('button', { name: '按成员筛选' }))
    await user.click(await screen.findByRole('option', { name: '同事乙（2）' }))
    expect(screen.getByRole('button', { name: '打开项目 乙的项目B' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开项目 我的项目A' })).not.toBeInTheDocument()
  })

  it('falls back to owner matching when the mine=true request fails', async () => {
    const user = userEvent.setup()
    mocks.listWorkspaceMembers.mockResolvedValue([{ id: 7, nickname: '测试用户' }])
    mocks.listCreativeProjects.mockImplementation(({ mine }: { mine?: boolean } = {}) =>
      mine
        ? Promise.reject(new Error('mine unavailable'))
        : Promise.resolve([project(1, '我的项目A'), { ...project(2, '乙的项目B'), user_id: 8 }]),
    )
    mocks.listAssets.mockResolvedValue({ items: [] })

    render(<ProjectManagementView />)
    expect(await screen.findByRole('button', { name: '打开项目 我的项目A' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '只看我的' }))
    expect(screen.getByRole('button', { name: '打开项目 我的项目A' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开项目 乙的项目B' })).not.toBeInTheDocument()
  })

  it('falls back to 全部成员 when the remembered member has no projects any more', async () => {
    localStorage.setItem('zzh.pm.ownerFilter.21', '999')
    mocks.listWorkspaceMembers.mockResolvedValue([{ id: 7, nickname: '测试用户' }])
    mocks.listCreativeProjects.mockResolvedValue([project(1, '我的项目A')])
    mocks.listAssets.mockResolvedValue({ items: [] })

    render(<ProjectManagementView />)
    // 失效的记忆值不生效:列表不为空,下拉显示「全部成员」
    expect(await screen.findByRole('button', { name: '打开项目 我的项目A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '按成员筛选' })).toHaveTextContent('全部成员')
  })

  it('personal space hides the member filter controls', async () => {
    mocks.workspace.type = 'personal'
    mocks.listCreativeProjects.mockResolvedValue([project(1, '个人项目A')])
    mocks.listAssets.mockResolvedValue({ items: [] })

    render(<ProjectManagementView />)
    expect(await screen.findByRole('button', { name: '打开项目 个人项目A' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '只看我的' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '按成员筛选' })).not.toBeInTheDocument()
    // 个人空间不发 mine=true 请求:mine 即全部,多拉一次是浪费
    expect(mocks.listCreativeProjects).not.toHaveBeenCalledWith(expect.objectContaining({ mine: true }))
  })

  it('flow tabs filter projects into 爆款成片 / 爆款复刻, legacy projects only under 全部', async () => {
    mocks.workspace.type = 'personal'
    mocks.listCreativeProjects.mockResolvedValue([
      project(1, '智能成片项目'),
      { ...project(2, '真人成片项目'), draft_json: { flow: 'real-person-video', smart: {} } },
      { ...project(3, '爆款复刻项目'), draft_json: { flow: 'hot-copy', smart: {} } },
      { ...project(4, '旧版项目'), draft_json: { flow: 'legacy', smart: {} } },
    ])
    mocks.listAssets.mockResolvedValue({ items: [] })

    render(<ProjectManagementView />)
    expect(await screen.findByRole('button', { name: '打开项目 智能成片项目' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开项目 旧版项目' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '爆款成片' }))
    expect(screen.getByRole('button', { name: '打开项目 智能成片项目' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开项目 真人成片项目' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开项目 爆款复刻项目' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开项目 旧版项目' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '爆款复刻' }))
    expect(screen.getByRole('button', { name: '打开项目 爆款复刻项目' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开项目 智能成片项目' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开项目 真人成片项目' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '全部' }))
    expect(screen.getByRole('button', { name: '打开项目 旧版项目' })).toBeInTheDocument()
  })

  it('batch-classifies every unclassified video into the chosen project and hides them optimistically', async () => {
    const user = userEvent.setup()
    mocks.listCreativeProjects.mockResolvedValue([project(9, '目标项目')])
    mocks.listAssets.mockResolvedValue({ items: [looseAsset(501, '散视频一'), looseAsset(502, '散视频二')] })
    mocks.requestConfirm.mockResolvedValue(true)
    mocks.addClassifiedVideo.mockResolvedValue(undefined)

    render(<ProjectManagementView />)

    await user.click(await screen.findByRole('button', { name: '批量归类（2）' }))
    await user.click(screen.getByRole('menuitem', { name: '目标项目' }))

    await waitFor(() => expect(mocks.addClassifiedVideo).toHaveBeenCalledTimes(2))
    expect(mocks.requestConfirm).toHaveBeenCalledWith(
      expect.stringContaining('2 条视频全部归类到「目标项目」'),
      expect.anything(),
    )
    // sourceKey 走资产维度的新格式（assetId 稳定，签名 URL 会漂移）
    expect(mocks.addClassifiedVideo).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 9, videoAssetId: 501, sourceKey: 'asset::501' }),
    )
    // 归类成功后乐观隐藏，待刷新用云端口径接管
    await waitFor(() => expect(screen.queryByText('散视频一')).not.toBeInTheDocument())
    expect(screen.queryByText('散视频二')).not.toBeInTheDocument()
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
