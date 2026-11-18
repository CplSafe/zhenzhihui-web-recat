import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearInviteCode: vi.fn(),
  ensureAuthStart: vi.fn(),
  getCaptcha: vi.fn(),
  getInviteCode: vi.fn(),
  getInviteType: vi.fn(),
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
  getInviteType: mocks.getInviteType,
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
    mocks.getInviteType.mockReturnValue('customer')
    mocks.registerAccount.mockResolvedValue({ ok: true })
    mocks.resetPassword.mockResolvedValue({ ok: true })
    mocks.sendAuthSms.mockResolvedValue(undefined)
  })

  it('requires a fresh registration code instead of reusing the login code', async () => {
    const user = userEvent.setup()
    render(
      <AuthActionModal
        mode="sms-register"
        ensureAuthStart={mocks.ensureAuthStart}
        prefill={{ mobile: '17633125265' }}
        onClose={mocks.onClose}
        onAuthed={mocks.onAuthed}
      />,
    )
    await user.click(screen.getByRole('button', { name: '完成并登录' }))
    expect(mocks.registerAccount).not.toHaveBeenCalled()
    expect(screen.getByText('请输入验证码')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(mocks.sendAuthSms).toHaveBeenCalledWith(
      expect.objectContaining({
        mobile: '17633125265',
        purpose: 'register',
      }),
    )
    await user.type(screen.getByRole('textbox', { name: '验证码' }), '592442')
    await user.click(screen.getByRole('button', { name: '完成并登录' }))
    expect(mocks.registerAccount).toHaveBeenCalledTimes(1)
    expect(mocks.registerAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        mobile: '17633125265',
        smsCode: '592442',
        termsAccepted: true,
      }),
    )
    expect(mocks.onAuthed).toHaveBeenCalledWith({ state: 'auth-state' }, { ok: true })
  })

  it('sends registration SMS without submitting a fabricated registration', async () => {
    const user = userEvent.setup()
    render(<AuthActionModal mode="register" ensureAuthStart={mocks.ensureAuthStart} onClose={mocks.onClose} />)
    await user.type(screen.getByRole('textbox', { name: '手机号' }), '17633125265')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(mocks.registerAccount).not.toHaveBeenCalled()
    expect(mocks.sendAuthSms).toHaveBeenCalledTimes(1)
  })

  it('honors the remaining login SMS cooldown and prevents duplicate sends', async () => {
    const user = userEvent.setup()
    const pending = deferred<void>()
    mocks.sendAuthSms.mockReturnValue(pending.promise)
    const modal = (cooldown: number) => (
      <AuthActionModal
        mode="sms-register"
        ensureAuthStart={mocks.ensureAuthStart}
        prefill={{ mobile: '17633125265' }}
        smsCooldown={cooldown}
        onClose={mocks.onClose}
      />
    )
    const { rerender } = render(modal(30))
    await user.click(screen.getByRole('button', { name: '30s后重发' }))
    expect(mocks.sendAuthSms).not.toHaveBeenCalled()
    rerender(modal(0))
    await user.dblClick(screen.getByRole('button', { name: '获取验证码' }))
    expect(mocks.sendAuthSms).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(screen.getByRole('button', { name: '60s后重发' })).toBeDisabled()
  })

  it('keeps the registration code editable after rejection and supports a corrected retry', async () => {
    const user = userEvent.setup()
    mocks.registerAccount
      .mockRejectedValueOnce({ code: 10003, message: '验证码错误或已过期' })
      .mockResolvedValueOnce({ ok: true })
    render(
      <AuthActionModal
        mode="sms-register"
        ensureAuthStart={mocks.ensureAuthStart}
        prefill={{ mobile: '17633125265' }}
        onClose={mocks.onClose}
        onAuthed={mocks.onAuthed}
      />,
    )
    const code = screen.getByRole('textbox', { name: '验证码' })
    await user.type(code, '111111')
    await user.click(screen.getByRole('button', { name: '完成并登录' }))
    expect(await screen.findByText('验证码错误或已过期')).toBeInTheDocument()
    expect(mocks.onClose).not.toHaveBeenCalled()
    await user.clear(code)
    await user.type(code, '592442')
    await user.click(screen.getByRole('button', { name: '完成并登录' }))
    expect(mocks.registerAccount).toHaveBeenLastCalledWith(expect.objectContaining({ smsCode: '592442' }))
    expect(mocks.onAuthed).toHaveBeenCalledTimes(1)
  })

  it('lets an already registered account return to login from the completion modal', async () => {
    const user = userEvent.setup()
    const onAlreadyRegistered = vi.fn()
    mocks.registerAccount.mockRejectedValueOnce({ code: 10401 })
    render(
      <AuthActionModal
        mode="sms-register"
        ensureAuthStart={mocks.ensureAuthStart}
        prefill={{ mobile: '17633125265' }}
        onClose={mocks.onClose}
        onAlreadyRegistered={onAlreadyRegistered}
      />,
    )
    await user.type(screen.getByRole('textbox', { name: '验证码' }), '592442')
    await user.click(screen.getByRole('button', { name: '完成并登录' }))
    await user.click(await screen.findByRole('button', { name: '直接登录' }))
    expect(onAlreadyRegistered).toHaveBeenCalledWith('17633125265')
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
