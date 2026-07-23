import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearInviteCode: vi.fn(),
  ensureAuthStart: vi.fn(),
  getCaptcha: vi.fn(),
  getInviteCode: vi.fn(),
  onAuthed: vi.fn(),
  onClose: vi.fn(),
  onResetDone: vi.fn(),
  registerAccount: vi.fn(),
  resetPassword: vi.fn(),
  sendAuthSms: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@/api/auth', () => ({
  getAuthErrorMessage: (error: any, fallback: string) => error?.message || fallback,
  getCaptcha: mocks.getCaptcha,
  isCaptchaChallengeError: () => false,
  registerAccount: mocks.registerAccount,
  resetPassword: mocks.resetPassword,
  sendAuthSms: mocks.sendAuthSms,
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('@/utils/inviteCode', () => ({
  clearInviteCode: mocks.clearInviteCode,
  getInviteCode: mocks.getInviteCode,
}))

import AuthActionModal from '@/components/auth/AuthActionModal'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function forgotModal(overrides: Record<string, unknown> = {}) {
  return (
    <AuthActionModal
      ensureAuthStart={mocks.ensureAuthStart}
      mode="forgot"
      onClose={mocks.onClose}
      onResetDone={mocks.onResetDone}
      {...overrides}
    />
  )
}

async function fillForgotForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: '手机号' }), '17633125265')
  await user.type(screen.getByLabelText('新密码'), 'Safe-New-Password-1!')
  await user.type(screen.getByRole('textbox', { name: '验证码' }), '592442')
}

describe('AuthActionModal behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/login')
    mocks.ensureAuthStart.mockResolvedValue({ state: 'auth-state' })
    mocks.getCaptcha.mockResolvedValue({ id: 'captcha', image: 'data:image/png;base64,AA' })
    mocks.getInviteCode.mockReturnValue('')
    mocks.registerAccount.mockResolvedValue({ ok: true })
    mocks.resetPassword.mockResolvedValue({ ok: true })
    mocks.sendAuthSms.mockResolvedValue(undefined)
  })

  it('is a modal dialog, focuses the first field, and closes with Escape', async () => {
    const user = userEvent.setup()
    render(forgotModal())

    const dialog = screen.getByRole('dialog', { name: '重置密码' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('textbox', { name: '手机号' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('rejects empty and malformed mobiles before OAuth or SMS calls', async () => {
    const user = userEvent.setup()
    render(forgotModal())

    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(screen.getByText('请输入手机号')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '手机号' }), '123')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(screen.getByText('请输入正确的手机号')).toBeInTheDocument()
    expect(mocks.ensureAuthStart).not.toHaveBeenCalled()
    expect(mocks.sendAuthSms).not.toHaveBeenCalled()
  })

  it('deduplicates a rapid reset submission while pending', async () => {
    const user = userEvent.setup()
    const pending = deferred<any>()
    mocks.resetPassword.mockReturnValue(pending.promise)
    render(forgotModal())
    await fillForgotForm(user)

    await user.dblClick(screen.getByRole('button', { name: '重置密码' }))
    expect(mocks.resetPassword).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled()

    await act(async () => {
      pending.resolve({ ok: true })
      await pending.promise
    })
  })

  it('recovers after reset failure, preserves the mobile, and never leaks credentials to URL or logs', async () => {
    const user = userEvent.setup()
    const secret = 'Do-Not-Log-This-1!'
    const code = '731955'
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.resetPassword.mockRejectedValueOnce(new Error('重置服务繁忙')).mockResolvedValueOnce({ ok: true })
    render(forgotModal())
    await user.type(screen.getByRole('textbox', { name: '手机号' }), '17633125265')
    await user.type(screen.getByLabelText('新密码'), secret)
    await user.type(screen.getByRole('textbox', { name: '验证码' }), code)

    await user.click(screen.getByRole('button', { name: '重置密码' }))
    expect(await screen.findByText('重置服务繁忙')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '手机号' })).toHaveValue('17633125265')
    expect(screen.getByRole('button', { name: '重置密码' })).toBeEnabled()
    expect(window.location.href).not.toContain(secret)
    expect(window.location.href).not.toContain(code)
    expect(JSON.stringify(warning.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(warning.mock.calls)).not.toContain(code)

    await user.click(screen.getByRole('button', { name: '重置密码' }))
    await waitFor(() => expect(mocks.resetPassword).toHaveBeenCalledTimes(2))
  })

  it('ignores a reset response that resolves after the modal was closed and unmounted', async () => {
    const user = userEvent.setup()
    const pending = deferred<any>()
    mocks.resetPassword.mockReturnValue(pending.promise)
    const closeSpy = vi.fn()

    function Host() {
      const [open, setOpen] = useState(true)
      return open
        ? forgotModal({
            onClose: () => {
              closeSpy()
              setOpen(false)
            },
          })
        : null
    }

    render(<Host />)
    await fillForgotForm(user)
    await user.click(screen.getByRole('button', { name: '重置密码' }))
    await user.click(screen.getByRole('button', { name: '关闭' }))
    expect(closeSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve({ ok: true })
      await pending.promise
    })
    expect(mocks.onResetDone).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalledWith('重置密码成功,可重新登录', 'success')
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })
})
