import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearExistingSession: vi.fn(),
  clearToast: vi.fn(),
  getAuthenticatedSession: vi.fn(),
  getCaptcha: vi.fn(),
  handleLoginSuccess: vi.fn(),
  loginWithPassword: vi.fn(),
  loginWithSmsCode: vi.fn(),
  loggerWarn: vi.fn(),
  markAuthSessionExpected: vi.fn(),
  navigate: vi.fn(),
  sendAuthSms: vi.fn(),
  showToast: vi.fn(),
  startOAuth: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/api/auth', () => ({
  clearExistingSession: mocks.clearExistingSession,
  getAuthErrorMessage: (error: any, fallback: string) => error?.message || fallback,
  getAuthNavigationUrl: () => '/auth/continue',
  getAuthenticatedSession: mocks.getAuthenticatedSession,
  getCaptcha: mocks.getCaptcha,
  isCaptchaChallengeError: () => false,
  loginWithPassword: mocks.loginWithPassword,
  loginWithSmsCode: mocks.loginWithSmsCode,
  markAuthSessionExpected: mocks.markAuthSessionExpected,
  sendAuthSms: mocks.sendAuthSms,
  startOAuth: mocks.startOAuth,
}))

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ handleLoginSuccess: mocks.handleLoginSuccess }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ clearToast: mocks.clearToast, showToast: mocks.showToast }),
}))

vi.mock('@/api/banners', () => ({ listBanners: vi.fn() }))

vi.mock('@/composables/useSwr', () => ({
  useSwr: () => ({ data: [] }),
}))

vi.mock('@/utils/mediaPreload', () => ({ isPreloaded: () => false }))

vi.mock('@/observability/openobserve-logger', () => ({
  logger: { warn: mocks.loggerWarn },
}))

vi.mock('@/components/auth/AgreementModal', () => ({
  default: ({ onAgree, onCancel }: { onAgree?: () => void; onCancel?: () => void }) => (
    <div role="dialog" aria-label="用户协议确认">
      <button type="button" onClick={onCancel}>
        不同意
      </button>
      <button type="button" onClick={onAgree}>
        同意并继续
      </button>
    </div>
  ),
}))

vi.mock('@/components/auth/AuthActionModal', () => ({
  default: ({ mode }: { mode: string }) => <div role="dialog" aria-label={`认证操作-${mode}`} />,
}))

import LoginView from '@/views/LoginView'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function selectPasswordLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: '密码登录' }))
  expect(screen.getByRole('tab', { name: '密码登录' })).toHaveAttribute('aria-selected', 'true')
}

async function fillPasswordLogin(
  user: ReturnType<typeof userEvent.setup>,
  { mobile = '17633125265', password = 'Secret-987!' } = {},
) {
  await selectPasswordLogin(user)
  await user.type(screen.getByRole('textbox', { name: '账号或手机号' }), mobile)
  await user.type(screen.getByLabelText('密码'), password)
}

describe('LoginView behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/login')
    mocks.clearExistingSession.mockResolvedValue(undefined)
    mocks.getAuthenticatedSession.mockResolvedValue({ user: { id: 7 } })
    mocks.getCaptcha.mockResolvedValue({ id: '', image: '' })
    mocks.loginWithPassword.mockResolvedValue({ ok: true })
    mocks.loginWithSmsCode.mockResolvedValue({ ok: true })
    mocks.sendAuthSms.mockResolvedValue(undefined)
    mocks.startOAuth.mockResolvedValue({ authorize_url: '/auth/continue', state: 'oauth-state' })
  })

  it('switches between SMS and password modes and validates required fields including whitespace-only mobile', async () => {
    const user = userEvent.setup()
    render(<LoginView />)

    expect(screen.getByRole('tab', { name: '短信登录' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: '短信验证码' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByText('请输入手机号')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: '账号或手机号' }), '   ')
    await user.type(screen.getByRole('textbox', { name: '短信验证码' }), '123456')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByText('请输入手机号')).toBeInTheDocument()
    expect(mocks.loginWithSmsCode).not.toHaveBeenCalled()

    await selectPasswordLogin(user)
    expect(screen.queryByRole('textbox', { name: '短信验证码' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByText('请输入手机号')).toBeInTheDocument()
  })

  it('rejects whitespace-only and malformed mobiles before requesting an SMS code', async () => {
    const user = userEvent.setup()
    render(<LoginView />)

    await user.type(screen.getByRole('textbox', { name: '账号或手机号' }), '   ')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(screen.getByText('请输入手机号')).toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: '账号或手机号' }))
    await user.type(screen.getByRole('textbox', { name: '账号或手机号' }), '123')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))

    expect(mocks.startOAuth).not.toHaveBeenCalled()
    expect(mocks.sendAuthSms).not.toHaveBeenCalled()
    expect(screen.getByText('请输入正确的手机号')).toBeInTheDocument()
  })

  it('accepts an 11-digit mainland mobile when requesting an SMS code', async () => {
    const user = userEvent.setup()
    render(<LoginView />)

    await user.type(screen.getByRole('textbox', { name: '账号或手机号' }), '17633125265')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))

    await waitFor(() =>
      expect(mocks.sendAuthSms).toHaveBeenCalledWith(
        expect.objectContaining({ mobile: '17633125265', purpose: 'login' }),
      ),
    )
    expect(screen.getByRole('button', { name: '60s后重发' })).toBeDisabled()
  })

  it('rejects a malformed mobile at SMS login submission before starting OAuth', async () => {
    const user = userEvent.setup()
    render(<LoginView />)

    await user.type(screen.getByRole('textbox', { name: '账号或手机号' }), '123')
    await user.type(screen.getByRole('textbox', { name: '短信验证码' }), '592442')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(screen.getByText('请输入正确的手机号')).toBeInTheDocument()
    expect(mocks.clearExistingSession).not.toHaveBeenCalled()
    expect(mocks.startOAuth).not.toHaveBeenCalled()
    expect(mocks.loginWithSmsCode).not.toHaveBeenCalled()
  })

  it('requires agreement, cancels without logging in, and continues exactly once after confirmation', async () => {
    const user = userEvent.setup()
    const login = deferred<any>()
    mocks.loginWithPassword.mockReturnValue(login.promise)
    render(<LoginView />)
    await fillPasswordLogin(user)

    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByRole('dialog', { name: '用户协议确认' })).toBeInTheDocument()
    expect(mocks.loginWithPassword).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '不同意' }))
    expect(screen.queryByRole('dialog', { name: '用户协议确认' })).not.toBeInTheDocument()
    expect(mocks.loginWithPassword).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '登录' }))
    await user.click(screen.getByRole('button', { name: '同意并继续' }))
    await waitFor(() => expect(mocks.loginWithPassword).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('checkbox')).toBeChecked()

    await act(async () => {
      login.resolve({ ok: true })
      await login.promise
    })
  })

  it('submits with Enter and prevents a rapid second submission while login is pending', async () => {
    const user = userEvent.setup()
    const clearing = deferred<void>()
    mocks.clearExistingSession.mockReturnValue(clearing.promise)
    render(<LoginView />)
    await fillPasswordLogin(user)
    await user.click(screen.getByRole('checkbox'))

    const password = screen.getByLabelText('密码')
    password.focus()
    await user.keyboard('{Enter}')
    await user.dblClick(screen.getByRole('button', { name: '登录中…' }))

    expect(mocks.clearExistingSession).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '登录中…' })).toBeDisabled()

    await act(async () => {
      clearing.resolve()
      await clearing.promise
    })
    await waitFor(() => expect(mocks.loginWithPassword).toHaveBeenCalledTimes(1))
  })

  it('keeps the mobile after a failed password login and never puts credentials in the URL or logs', async () => {
    const user = userEvent.setup()
    const mobile = '17633125265'
    const secret = 'Never-Log-This-987!'
    const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.loginWithPassword.mockRejectedValue(new Error('认证失败'))
    render(<LoginView />)
    await fillPasswordLogin(user, { mobile, password: secret })
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('认证失败', 'error', 5000))
    expect(screen.getByRole('textbox', { name: '账号或手机号' })).toHaveValue(mobile)
    expect(window.location.href).not.toContain(secret)
    expect(window.location.href).not.toContain(mobile)

    const emittedLogs = JSON.stringify([...mocks.loggerWarn.mock.calls, ...consoleWarning.mock.calls])
    expect(emittedLogs).not.toContain(secret)
    expect(emittedLogs).not.toContain(mobile)
  })

  it('normalizes spaces in SMS credentials without exposing the code in the URL or logs', async () => {
    const user = userEvent.setup()
    const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(<LoginView />)
    await user.type(screen.getByRole('textbox', { name: '账号或手机号' }), '176 3312 5265')
    await user.type(screen.getByRole('textbox', { name: '短信验证码' }), ' 592442 ')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() =>
      expect(mocks.loginWithSmsCode).toHaveBeenCalledWith(
        expect.objectContaining({ mobile: '17633125265', smsCode: '592442' }),
      ),
    )
    expect(window.location.href).not.toContain('592442')
    expect(JSON.stringify([...mocks.loggerWarn.mock.calls, ...consoleWarning.mock.calls])).not.toContain('592442')
  })

  it('ignores an older asynchronous session result after a newer login flow succeeds', async () => {
    const user = userEvent.setup()
    const oldSession = deferred<any>()
    const newSession = { user: { id: 22, nickname: '新账号' } }
    mocks.getAuthenticatedSession.mockReset()
    mocks.getAuthenticatedSession.mockReturnValueOnce(oldSession.promise).mockResolvedValueOnce(newSession)
    mocks.loginWithPassword.mockResolvedValueOnce({ attempt: 'old' }).mockResolvedValueOnce({ attempt: 'new' })
    render(<LoginView />)
    await fillPasswordLogin(user, { password: 'Old-Password-1!' })
    await user.click(screen.getByRole('checkbox'))

    await user.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(mocks.getAuthenticatedSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeEnabled())

    const password = screen.getByLabelText('密码')
    await user.clear(password)
    await user.type(password, 'New-Password-2!')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(mocks.handleLoginSuccess).toHaveBeenCalledWith(newSession))
    await act(async () => {
      oldSession.resolve({ user: { id: 11, nickname: '旧账号' } })
      await oldSession.promise
    })
    await new Promise((resolve) => window.setTimeout(resolve, 350))

    expect(mocks.handleLoginSuccess).toHaveBeenCalledTimes(1)
    expect(mocks.handleLoginSuccess).not.toHaveBeenCalledWith(expect.objectContaining({ user: { id: 11 } }))
  })
})
