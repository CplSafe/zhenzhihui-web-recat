import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  joinTeam: vi.fn(),
  showToast: vi.fn(),
  switchWorkspaceSafely: vi.fn(),
  ui: {
    joinTeamOpen: true,
    workspaceSwitchLocked: false,
    workspaceSwitchLockReason: '',
  },
}))

vi.mock('@/stores/ui', () => ({
  useUiStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ ...mocks.ui, closeJoinTeam: mocks.close }),
}))

vi.mock('@/stores/workspaceSession', () => ({
  useWorkspaceSessionStore: (selector: (state: { joinTeam: typeof mocks.joinTeam }) => unknown) =>
    selector({ joinTeam: mocks.joinTeam }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('@/composables/useSafeWorkspaceSwitch', () => ({
  useSafeWorkspaceSwitch: () => mocks.switchWorkspaceSafely,
}))

vi.mock('@/api/business', () => ({
  getBusinessErrorMessage: (error: any, fallback: string) => error?.message || fallback,
}))

import GlobalJoinTeamDialog from '@/components/team/GlobalJoinTeamDialog'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('GlobalJoinTeamDialog behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ui.joinTeamOpen = true
    mocks.ui.workspaceSwitchLocked = false
    mocks.ui.workspaceSwitchLockReason = ''
    mocks.joinTeam.mockResolvedValue({ sourceWorkspace: { id: 21 }, workspaceId: 22 })
    mocks.switchWorkspaceSafely.mockReturnValue(true)
  })

  it('normalizes the invite code, joins, switches safely, and closes on success', async () => {
    const user = userEvent.setup()
    render(<GlobalJoinTeamDialog />)

    await user.type(screen.getByRole('textbox', { name: '邀请码' }), ' AB C 123 ')
    await user.click(screen.getByRole('button', { name: '确认加入' }))

    await waitFor(() => expect(mocks.joinTeam).toHaveBeenCalledWith('ABC123'))
    expect(mocks.switchWorkspaceSafely).toHaveBeenCalledWith(22, { sourceWorkspace: { id: 21 } })
    expect(mocks.showToast).toHaveBeenCalledWith('已加入团队空间', 'success')
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })

  it('submits with Enter and closes with Escape', async () => {
    const user = userEvent.setup()
    render(<GlobalJoinTeamDialog />)

    const input = screen.getByRole('textbox', { name: '邀请码' })
    expect(input).toHaveFocus()
    await user.type(input, 'ENTER123{Enter}')
    await waitFor(() => expect(mocks.joinTeam).toHaveBeenCalledWith('ENTER123'))

    await user.keyboard('{Escape}')
    expect(mocks.close).toHaveBeenCalled()
  })

  it('deduplicates rapid submission and disables controls while pending', async () => {
    const user = userEvent.setup()
    const pending = deferred<any>()
    mocks.joinTeam.mockReturnValue(pending.promise)
    render(<GlobalJoinTeamDialog />)

    await user.type(screen.getByRole('textbox', { name: '邀请码' }), 'TEAM123')
    await user.dblClick(screen.getByRole('button', { name: '确认加入' }))
    expect(mocks.joinTeam).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '加入中...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()

    await act(async () => {
      pending.resolve({ sourceWorkspace: { id: 21 }, workspaceId: 22 })
      await pending.promise
    })
  })

  it('recovers after a failure and allows retry', async () => {
    const user = userEvent.setup()
    mocks.joinTeam.mockRejectedValueOnce(new Error('邀请码已失效')).mockResolvedValueOnce({ workspaceId: 22 })
    render(<GlobalJoinTeamDialog />)

    await user.type(screen.getByRole('textbox', { name: '邀请码' }), 'EXPIRED')
    await user.click(screen.getByRole('button', { name: '确认加入' }))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('邀请码已失效', 'error'))
    expect(screen.getByRole('button', { name: '确认加入' })).toBeEnabled()
    expect(mocks.close).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '确认加入' }))
    await waitFor(() => expect(mocks.joinTeam).toHaveBeenCalledTimes(2))
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })

  it('does not switch, toast, or close a reopened dialog when an old request resolves after close', async () => {
    const user = userEvent.setup()
    const oldJoin = deferred<any>()
    mocks.joinTeam.mockReturnValue(oldJoin.promise)
    const view = render(<GlobalJoinTeamDialog />)
    await user.type(screen.getByRole('textbox', { name: '邀请码' }), 'OLDTEAM')
    await user.click(screen.getByRole('button', { name: '确认加入' }))

    await user.keyboard('{Escape}')
    expect(mocks.close).toHaveBeenCalledTimes(1)
    mocks.ui.joinTeamOpen = false
    view.rerender(<GlobalJoinTeamDialog />)
    mocks.ui.joinTeamOpen = true
    view.rerender(<GlobalJoinTeamDialog />)

    await act(async () => {
      oldJoin.resolve({ sourceWorkspace: { id: 21 }, workspaceId: 99 })
      await oldJoin.promise
    })

    expect(mocks.switchWorkspaceSafely).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '确认加入' })).toBeDisabled()
  })

  it('blocks joining while workspace switching is locked', async () => {
    const user = userEvent.setup()
    mocks.ui.workspaceSwitchLocked = true
    mocks.ui.workspaceSwitchLockReason = '视频处理中'
    render(<GlobalJoinTeamDialog />)
    await user.type(screen.getByRole('textbox', { name: '邀请码' }), 'LOCKED')
    await user.click(screen.getByRole('button', { name: '确认加入' }))

    expect(mocks.joinTeam).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('视频处理中', 'info')
  })
})
