import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkspaceMemberStatistics: vi.fn(),
  getWorkspaceOverview: vi.fn(),
  listAiTasks: vi.fn(),
  listCreditLedgers: vi.fn(),
  listCreativeProjects: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  workspace: {
    id: 21,
    current: { id: 21, type: 'team', owner_user_id: 999 },
    member: { user_id: 7, workspace_id: 21, role: 'admin' },
    user: { id: 7 },
  },
}))

vi.mock('@/components/home/AppSidebar', () => ({
  default: () => <nav aria-label="应用侧边栏" />,
}))

vi.mock('@/components/layout/AppTopbar', () => ({
  default: () => <header aria-label="应用顶栏" />,
}))

vi.mock('antd', () => ({
  DatePicker: ({ onChange }: { onChange?: (value: { format: () => string }) => void }) => (
    <button type="button" aria-label="月份选择器" onClick={() => onChange?.({ format: () => '2026-06' })}>
      选择上月
    </button>
  ),
}))

vi.mock('@/api/business', () => ({
  getBusinessErrorMessage: (error: any, fallback: string) => error?.message || fallback,
  getWorkspaceMemberStatistics: mocks.getWorkspaceMemberStatistics,
  getWorkspaceOverview: mocks.getWorkspaceOverview,
  listAiTasks: mocks.listAiTasks,
  listCreditLedgers: mocks.listCreditLedgers,
  listCreativeProjects: mocks.listCreativeProjects,
}))

vi.mock('@/api/auth', () => ({
  listWorkspaceMembers: mocks.listWorkspaceMembers,
}))

vi.mock('@/stores/workspaceSession', () => {
  const useWorkspaceSessionStore = Object.assign(vi.fn(), {
    getState: () => ({ workspaceId: mocks.workspace.id }),
  })
  return {
    deriveWorkspaceId: (state: { workspaceId: number }) => state.workspaceId,
    useCurrentMember: () => mocks.workspace.member,
    useCurrentUser: () => mocks.workspace.user,
    useCurrentWorkspace: () => mocks.workspace.current,
    useWorkspaceId: () => mocks.workspace.id,
    useWorkspaceSessionStore,
  }
})

vi.mock('@/stores/ui', () => ({
  openComingSoon: vi.fn(),
}))

import SpaceDashboardView, { clearSpaceDashboardTrendCache } from '@/views/SpaceDashboardView'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('SpaceDashboardView request isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSpaceDashboardTrendCache()
    mocks.workspace.id = 21
    mocks.workspace.current = { id: 21, type: 'team', owner_user_id: 999 }
    mocks.workspace.member = { user_id: 7, workspace_id: 21, role: 'admin' }
    mocks.listAiTasks.mockResolvedValue([])
    mocks.listCreditLedgers.mockResolvedValue([])
    mocks.listWorkspaceMembers.mockResolvedValue([])
  })

  it('does not let a slower previous workspace overwrite the active dashboard', async () => {
    const overviewA = deferred<any>()
    const overviewB = deferred<any>()
    const membersA = deferred<any[]>()
    const membersB = deferred<any[]>()
    const projectsA = deferred<any[]>()
    const projectsB = deferred<any[]>()

    mocks.getWorkspaceOverview.mockImplementation((workspaceId: number) =>
      workspaceId === 21 ? overviewA.promise : overviewB.promise,
    )
    mocks.getWorkspaceMemberStatistics.mockImplementation((workspaceId: number) =>
      workspaceId === 21 ? membersA.promise : membersB.promise,
    )
    mocks.listCreativeProjects.mockImplementation(({ workspaceId }: { workspaceId: number }) =>
      workspaceId === 21 ? projectsA.promise : projectsB.promise,
    )

    const { rerender } = render(
      <MemoryRouter>
        <SpaceDashboardView />
      </MemoryRouter>,
    )
    await waitFor(() => expect(mocks.getWorkspaceOverview).toHaveBeenCalledWith(21))

    mocks.workspace.id = 22
    mocks.workspace.current = { id: 22, type: 'team', owner_user_id: 999 }
    mocks.workspace.member = { user_id: 7, workspace_id: 22, role: 'admin' }
    rerender(
      <MemoryRouter>
        <SpaceDashboardView />
      </MemoryRouter>,
    )
    await waitFor(() => expect(mocks.getWorkspaceOverview).toHaveBeenCalledWith(22))

    await act(async () => {
      overviewB.resolve({ total: { member_count: 1, video_count: 2, total_credits: 3 } })
      membersB.resolve([{ user_id: 7, nickname: 'Workspace B member', video_count: 2, total_credits: 3 }])
      projectsB.resolve([])
    })
    expect(await screen.findByText('Workspace B member')).toBeInTheDocument()

    await act(async () => {
      overviewA.resolve({ total: { member_count: 9, video_count: 99, total_credits: 999 } })
      membersA.resolve([{ user_id: 8, nickname: 'Workspace A stale member', video_count: 99 }])
      projectsA.resolve([])
    })

    expect(screen.queryByText('Workspace A stale member')).not.toBeInTheDocument()
    expect(screen.getByText('Workspace B member')).toBeInTheDocument()
  })

  it('reuses one workspace trend history when only the selected month changes', async () => {
    mocks.getWorkspaceOverview.mockResolvedValue({
      total: { member_count: 1, video_count: 2, total_credits: 3 },
    })
    mocks.getWorkspaceMemberStatistics.mockResolvedValue([])
    mocks.listCreativeProjects.mockResolvedValue([])

    render(
      <MemoryRouter>
        <SpaceDashboardView />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.listAiTasks).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(mocks.listCreditLedgers).toHaveBeenCalledTimes(1))

    await act(async () => {
      screen.getByRole('button', { name: '月份选择器' }).click()
    })

    await waitFor(() => expect(screen.getByText('统计日期：2026-06-01 至 2026-06-30')).toBeInTheDocument())
    expect(mocks.listAiTasks).toHaveBeenCalledTimes(3)
    expect(mocks.listCreditLedgers).toHaveBeenCalledTimes(1)
  })

  it('总生成视频数按成功视频任务计数，不使用 overview 的 works 数', async () => {
    mocks.getWorkspaceOverview.mockResolvedValue({
      total: { member_count: 1, video_count: 99, total_works: 99, total_credits: 300 },
    })
    mocks.getWorkspaceMemberStatistics.mockResolvedValue([])
    mocks.listCreativeProjects.mockResolvedValue([])
    mocks.listAiTasks.mockImplementation(({ operationCode }: { operationCode: string }) => {
      if (operationCode === 'video.generate') return Promise.resolve([{ id: 1 }, { id: 2 }])
      if (operationCode === 'video.edit') return Promise.resolve([{ id: 3 }])
      return Promise.resolve([])
    })

    render(
      <MemoryRouter>
        <SpaceDashboardView />
      </MemoryRouter>,
    )

    await screen.findAllByText('总生成视频数')
    const card = document.querySelector('[data-metric="videos"]')
    expect(card).not.toBeNull()
    await waitFor(() => expect(card).toHaveTextContent('3个'))
    expect(card).not.toHaveTextContent('99个')
    expect(mocks.listAiTasks).toHaveBeenCalledTimes(3)
  })
})
