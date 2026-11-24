import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearInviteCode: vi.fn(),
  prepareRegistration: vi.fn(),
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
      prepareRegistration={mocks.prepareRegistration}
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
    mocks.prepareRegistration.mockResolvedValue({ state: 'auth-state' })
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
        prepareRegistration={mocks.prepareRegistration}
        prefill={{ mobile: '17633125265' }}
        onClose={mocks.onClose}
        onAuthed={mocks.onAuthed}
      />,
    )
    const submit = screen.getByRole('button', { name: '完成并登录' })
    const code = screen.getByRole('textbox', { name: '验证码' })
    await user.type(code, '123456')
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(mocks.sendAuthSms).toHaveBeenCalledWith(
      expect.objectContaining({
        authStart: null,
        mobile: '17633125265',
        purpose: 'register',
      }),
    )
    expect(code).toHaveValue('')
    expect(submit).toBeDisabled()
    expect(mocks.prepareRegistration).not.toHaveBeenCalled()
    expect(mocks.registerAccount).not.toHaveBeenCalled()
    await user.type(code, '592442')
    await user.click(submit)
    expect(mocks.registerAccount).toHaveBeenCalledTimes(1)
    expect(mocks.registerAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        mobile: '17633125265',
        smsCode: '592442',
        termsAccepted: true,
      }),
    )
    expect(mocks.prepareRegistration).toHaveBeenCalledOnce()
    expect(mocks.onAuthed).toHaveBeenCalledWith({ state: 'auth-state' }, { ok: true }, '17633125265')
  })

  it('sends registration SMS without submitting a fabricated registration', async () => {
    const user = userEvent.setup()
    render(<AuthActionModal mode="register" prepareRegistration={mocks.prepareRegistration} onClose={mocks.onClose} />)
    await user.type(screen.getByRole('textbox', { name: '手机号' }), '17633125265')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(mocks.registerAccount).not.toHaveBeenCalled()
    expect(mocks.prepareRegistration).not.toHaveBeenCalled()
    expect(mocks.sendAuthSms).toHaveBeenCalledTimes(1)
  })

  it('prevents duplicate registration SMS sends and starts its own cooldown', async () => {
    const user = userEvent.setup()
    const pending = deferred<void>()
    mocks.sendAuthSms.mockReturnValue(pending.promise)
    render(
      <AuthActionModal
        mode="sms-register"
        prepareRegistration={mocks.prepareRegistration}
        prefill={{ mobile: '17633125265' }}
        onClose={mocks.onClose}
      />,
    )
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
        prepareRegistration={mocks.prepareRegistration}
        prefill={{ mobile: '17633125265' }}
        onClose={mocks.onClose}
        onAuthed={mocks.onAuthed}
      />,
    )
    const code = screen.getByRole('textbox', { name: '验证码' })
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
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
        prepareRegistration={mocks.prepareRegistration}
        prefill={{ mobile: '17633125265' }}
        onClose={mocks.onClose}
        onAlreadyRegistered={onAlreadyRegistered}
      />,
    )
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
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
    expect(mocks.prepareRegistration).not.toHaveBeenCalled()
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
    expect(mocks.prepareRegistration).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled()

    await act(async () => {
      pending.resolve({ ok: true })
      await pending.promise
    })
  })

  it('keeps registration blocked until SMS succeeds for the current mobile and required fields are filled', async () => {
    const user = userEvent.setup()
    const pending = deferred<void>()
    mocks.sendAuthSms.mockReturnValueOnce(pending.promise)
    render(forgotModal({ mode: 'register', onAuthed: mocks.onAuthed }))
    const mobile = screen.getByRole('textbox', { name: '手机号' })
    const code = screen.getByRole('textbox', { name: '验证码' })
    const password = screen.getByLabelText('密码', { exact: true })
    const submit = screen.getByRole('button', { name: '注册' })
    await user.type(mobile, '13800000000')
    await user.type(code, '123456')
    await user.type(password, 'Test-password-1!')
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(screen.getByRole('button', { name: '发送中…' })).toBeDisabled()
    expect(submit).toBeDisabled()
    expect(mocks.registerAccount).not.toHaveBeenCalled()

    await act(async () => pending.resolve())
    expect(screen.getByRole('button', { name: /s后重发/ })).toBeDisabled()
    expect(submit).toBeEnabled()
    await user.clear(mobile)
    await user.type(mobile, '13900000000')
    expect(code).toHaveValue('')
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    await user.type(code, '654321')
    expect(submit).toBeEnabled()

    await user.clear(mobile)
    await user.type(mobile, '13800000000')
    expect(screen.getByRole('button', { name: /s后重发/ })).toBeDisabled()
    expect(code).toHaveValue('')
    expect(submit).toBeDisabled()
    await user.type(code, '123456')
    await user.click(submit)
    expect(mocks.registerAccount).toHaveBeenCalledOnce()
    expect(mocks.registerAccount).toHaveBeenCalledWith(
      expect.objectContaining({ mobile: '13800000000', smsCode: '123456' }),
    )
  })

  it('ties a late password reset SMS response to the phone that requested it', async () => {
    const user = userEvent.setup()
    const pending = deferred<void>()
    mocks.sendAuthSms.mockReturnValueOnce(pending.promise)
    render(forgotModal())
    const mobile = screen.getByRole('textbox', { name: '手机号' })
    const code = screen.getByRole('textbox', { name: '验证码' })
    await user.type(mobile, '13800000000')
    await user.type(code, '123456')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    await user.clear(mobile)
    await user.type(mobile, '13900000000')
    expect(code).toHaveValue('')

    await act(async () => pending.resolve())
    expect(mocks.showToast).not.toHaveBeenCalled()
    const send = screen.getByRole('button', { name: '获取验证码' })
    expect(send).toBeEnabled()
    await user.click(send)
    expect(mocks.sendAuthSms).toHaveBeenLastCalledWith(
      expect.objectContaining({ mobile: '13900000000', purpose: 'reset_password', authStart: null }),
    )
    expect(mocks.prepareRegistration).not.toHaveBeenCalled()

    await user.clear(mobile)
    await user.type(mobile, '13800000000')
    expect(screen.getByRole('button', { name: /s后重发/ })).toBeDisabled()
  })

  it('keeps the registration dialog open until its result has been handled', async () => {
    const user = userEvent.setup()
    const pending = deferred<{ ok: boolean }>()
    mocks.registerAccount.mockReturnValueOnce(pending.promise)
    render(forgotModal({ mode: 'register', onAuthed: mocks.onAuthed }))
    await user.type(screen.getByRole('textbox', { name: '手机号' }), '13800000000')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    await user.type(screen.getByLabelText('密码'), 'Test-password-1!')
    await user.type(screen.getByRole('textbox', { name: '验证码' }), '123456')
    await user.click(screen.getByRole('button', { name: '注册' }))
    expect(mocks.registerAccount).toHaveBeenCalledOnce()

    const close = screen.getByRole('button', { name: '关闭' })
    expect(close).toBeDisabled()
    await user.click(close)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('dialog').parentElement!)
    expect(mocks.onClose).not.toHaveBeenCalled()

    await act(async () => pending.resolve({ ok: true }))
    expect(mocks.onAuthed).toHaveBeenCalledWith({ state: 'auth-state' }, { ok: true }, '13800000000')
    expect(mocks.onClose).toHaveBeenCalledOnce()
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
