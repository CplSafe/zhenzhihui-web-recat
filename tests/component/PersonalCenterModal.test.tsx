import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applyOverrides: vi.fn((user: any) => user),
  getCurrentUser: vi.fn(),
  saveAvatarOverride: vi.fn(),
  setState: vi.fn(),
  showToast: vi.fn(),
  state: {
    session: { user: { id: 101, mobile: '17633125265', nickname: 'Alice', avatar: '/broken.png' } } as any,
    user: { id: 101, mobile: '17633125265', nickname: 'Alice', avatar: '/broken.png' } as any,
  },
  updateMyProfile: vi.fn(),
  uploadMyAvatar: vi.fn(),
}))

vi.mock('@/api/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
  updateMyProfile: mocks.updateMyProfile,
  uploadMyAvatar: mocks.uploadMyAvatar,
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => mocks.state.user,
  useWorkspaceSessionStore: Object.assign(
    (selector: (state: any) => unknown) => selector({ authSession: mocks.state.session }),
    {
      setState: mocks.setState,
    },
  ),
}))
vi.mock('@/utils/profileOverrides', () => ({
  applyUserProfileOverrides: mocks.applyOverrides,
  saveUserAvatarOverride: mocks.saveAvatarOverride,
}))

import PersonalCenterModal from '@/components/layout/PersonalCenterModal'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('PersonalCenterModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.user = { id: 101, mobile: '17633125265', nickname: 'Alice', avatar: '/broken.png' }
    mocks.state.session = { user: mocks.state.user }
    mocks.updateMyProfile.mockResolvedValue({})
    mocks.getCurrentUser.mockResolvedValue({ id: 101, nickname: 'Alice更新' })
    mocks.uploadMyAvatar.mockResolvedValue({ avatar_url: '/new.png' })
  })

  it('focuses the nickname, exposes account semantics, falls back from a broken avatar, and closes with Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PersonalCenterModal onClose={onClose} />)

    expect(screen.getByRole('dialog', { name: '个人中心' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('textbox', { name: '昵称' })).toHaveFocus()
    expect(screen.getByText('17633125265')).toBeInTheDocument()
    fireEvent.error(screen.getByRole('img', { name: '头像' }))
    expect(screen.getByText('A')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('validates nickname, deduplicates save, recovers after failure, and allows retry', async () => {
    const user = userEvent.setup()
    const first = deferred<any>()
    const onClose = vi.fn()
    mocks.updateMyProfile.mockReturnValueOnce(first.promise).mockResolvedValueOnce({})
    render(<PersonalCenterModal onClose={onClose} />)
    const nickname = screen.getByRole('textbox', { name: '昵称' })

    await user.clear(nickname)
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(mocks.showToast).toHaveBeenCalledWith('昵称不能为空', 'error')
    await user.type(nickname, 'Alice新')
    await user.dblClick(screen.getByRole('button', { name: '保存' }))
    expect(mocks.updateMyProfile).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()

    await act(async () => {
      first.reject(new Error('资料服务繁忙'))
      await first.promise.catch(() => undefined)
    })
    expect(mocks.showToast).toHaveBeenCalledWith('资料服务繁忙', 'error')
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(mocks.updateMyProfile).toHaveBeenCalledTimes(2))
    expect(mocks.showToast).toHaveBeenCalledWith('保存成功', 'success')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the committed nickname when the refreshed profile briefly returns the old value', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mocks.getCurrentUser.mockResolvedValue({
      id: 101,
      mobile: '17633125265',
      nickname: 'Alice',
      name: 'Alice',
    })
    render(<PersonalCenterModal onClose={onClose} />)

    const nickname = screen.getByRole('textbox', { name: '昵称' })
    await user.clear(nickname)
    await user.type(nickname, '新名称')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(mocks.setState).toHaveBeenCalledTimes(2)

    const latestUpdater = mocks.setState.mock.calls[mocks.setState.mock.calls.length - 1]?.[0]
    const nextState = latestUpdater({
      authSession: {
        user: {
          id: 101,
          nickname: 'Alice',
          name: 'Alice',
        },
      },
    })
    expect(nextState.authSession.user).toMatchObject({
      nickname: '新名称',
      name: '新名称',
    })
  })

  it('ignores a save response after unmount', async () => {
    const user = userEvent.setup()
    const pending = deferred<any>()
    mocks.updateMyProfile.mockReturnValue(pending.promise)
    const onClose = vi.fn()
    const view = render(<PersonalCenterModal onClose={onClose} />)
    const nickname = screen.getByRole('textbox', { name: '昵称' })
    await user.clear(nickname)
    await user.type(nickname, '卸载前修改')
    await user.click(screen.getByRole('button', { name: '保存' }))
    view.unmount()

    await act(async () => {
      pending.resolve({})
      await pending.promise
    })
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
    expect(mocks.setState).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalledWith('保存成功', 'success')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores an old user save after the active account changes', async () => {
    const user = userEvent.setup()
    const pending = deferred<any>()
    mocks.updateMyProfile.mockReturnValue(pending.promise)
    const onClose = vi.fn()
    const view = render(<PersonalCenterModal onClose={onClose} />)
    const nickname = screen.getByRole('textbox', { name: '昵称' })
    await user.clear(nickname)
    await user.type(nickname, '旧账号修改')
    await user.click(screen.getByRole('button', { name: '保存' }))

    mocks.state.user = { id: 202, mobile: '18800000000', nickname: 'Bob' }
    mocks.state.session = { user: mocks.state.user }
    view.rerender(<PersonalCenterModal onClose={onClose} />)
    await act(async () => {
      pending.resolve({})
      await pending.promise
    })

    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
    expect(mocks.setState).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
