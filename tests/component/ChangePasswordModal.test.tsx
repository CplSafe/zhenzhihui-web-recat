import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCaptcha: vi.fn(),
  getCurrentUser: vi.fn(),
  resetPassword: vi.fn(),
  sendAuthSms: vi.fn(),
  showToast: vi.fn(),
  store: { authSession: { user: { mobile: '17633125265' } } as any },
}))

vi.mock('@/api/auth', () => ({
  getAuthErrorMessage: (error: any, fallback: string) => error?.message || fallback,
  getCaptcha: mocks.getCaptcha,
  getCurrentUser: mocks.getCurrentUser,
  isCaptchaChallengeError: () => false,
  resetPassword: mocks.resetPassword,
  sendAuthSms: mocks.sendAuthSms,
}))

vi.mock('@/stores/workspaceSession', () => ({
  useWorkspaceSessionStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

import ChangePasswordModal from '@/components/auth/ChangePasswordModal'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function fillChangePassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('新密码'), 'Changed-Password-1!')
  await user.type(screen.getByRole('textbox', { name: '验证码' }), '135790')
}

describe('ChangePasswordModal behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.store.authSession = { user: { mobile: '17633125265' } }
    mocks.getCaptcha.mockResolvedValue({ id: '', image: '' })
    mocks.getCurrentUser.mockResolvedValue({ mobile: '17633125265' })
    mocks.resetPassword.mockResolvedValue({ ok: true })
    mocks.sendAuthSms.mockResolvedValue(undefined)
  })

  it('exposes modal semantics, focuses the mobile field, and closes with Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ChangePasswordModal onClose={onClose} />)

    expect(screen.getByRole('dialog', { name: '修改密码' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('textbox', { name: '手机号' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('validates password and code before reset and keeps SMS disabled for an invalid mobile', async () => {
    const user = userEvent.setup()
    mocks.store.authSession = null as any
    mocks.getCurrentUser.mockResolvedValue({})
    render(<ChangePasswordModal onClose={vi.fn()} />)

    const mobile = screen.getByRole('textbox', { name: '手机号' })
    await user.type(mobile, '123')
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '确认修改' }))
    expect(screen.getByText('请输入正确的手机号')).toBeInTheDocument()
    expect(mocks.resetPassword).not.toHaveBeenCalled()

    await user.clear(mobile)
    await user.type(mobile, '17633125265')
    await user.click(screen.getByRole('button', { name: '确认修改' }))
    expect(screen.getByText('请输入新密码')).toBeInTheDocument()
    await user.type(screen.getByLabelText('新密码'), 'Changed-Password-1!')
    await user.click(screen.getByRole('button', { name: '确认修改' }))
    expect(screen.getByText('请输入验证码')).toBeInTheDocument()
  })

  it('deduplicates reset submission, recovers after failure, and allows retry', async () => {
    const user = userEvent.setup()
    const first = deferred<any>()
    const onClose = vi.fn()
    mocks.resetPassword.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true })
    render(<ChangePasswordModal onClose={onClose} />)
    await fillChangePassword(user)

    await user.dblClick(screen.getByRole('button', { name: '确认修改' }))
    expect(mocks.resetPassword).toHaveBeenCalledTimes(1)
    await act(async () => {
      first.reject(new Error('修改服务繁忙'))
      await first.promise.catch(() => undefined)
    })
    expect(await screen.findByText('修改服务繁忙')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认修改' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '确认修改' }))
    await waitFor(() => expect(mocks.resetPassword).toHaveBeenCalledTimes(2))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores a successful reset response after close and unmount', async () => {
    const user = userEvent.setup()
    const pending = deferred<any>()
    mocks.resetPassword.mockReturnValue(pending.promise)
    const closeSpy = vi.fn()

    function Host() {
      const [open, setOpen] = useState(true)
      return open ? (
        <ChangePasswordModal
          onClose={() => {
            closeSpy()
            setOpen(false)
          }}
        />
      ) : null
    }

    render(<Host />)
    await fillChangePassword(user)
    await user.click(screen.getByRole('button', { name: '确认修改' }))
    await user.click(screen.getByRole('button', { name: '关闭' }))
    expect(closeSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve({ ok: true })
      await pending.promise
    })
    expect(mocks.showToast).not.toHaveBeenCalledWith('密码修改成功,下次请用新密码登录', 'success')
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })
})
