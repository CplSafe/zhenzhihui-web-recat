import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  banners: [] as any[],
  clearExistingSession: vi.fn(),
  clearToast: vi.fn(),
  getAuthNavigationUrl: vi.fn(),
  getAuthenticatedSession: vi.fn(),
  getCaptcha: vi.fn(),
  handleLoginSuccess: vi.fn(),
  locationState: undefined as unknown,
  loginWithPassword: vi.fn(),
  loginWithSmsCode: vi.fn(),
  loggerWarn: vi.fn(),
  markAuthSessionExpected: vi.fn(),
  navigate: vi.fn(),
  registerAccount: vi.fn(),
  sendAuthSms: vi.fn(),
  showToast: vi.fn(),
  startOAuth: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/login', search: window.location.search, state: mocks.locationState }),
}))

vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  clearExistingSession: mocks.clearExistingSession,
  getAuthNavigationUrl: mocks.getAuthNavigationUrl,
  getAuthenticatedSession: mocks.getAuthenticatedSession,
  getCaptcha: mocks.getCaptcha,
  loginWithPassword: mocks.loginWithPassword,
  loginWithSmsCode: mocks.loginWithSmsCode,
  markAuthSessionExpected: mocks.markAuthSessionExpected,
  registerAccount: mocks.registerAccount,
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
  useSwr: () => ({ data: mocks.banners }),
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

import { AuthApiError } from '@/api/auth'
import { consumeOAuthLoginReturnTo, keepOAuthLoginReturnTo } from '@/utils/loginReturnTo'
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
  await user.type(screen.getByRole('textbox', { name: '手机号' }), mobile)
  await user.type(screen.getByLabelText('密码'), password)
}

describe('LoginView behavior', () => {
  it('上下级邀请自动打开注册，提交和重试均传递邀请关系且无推广码', async () => {
    const user = userEvent.setup()
    const mobile = '13900139000'
    window.history.replaceState({}, '', '/login?hierarchy_invite=hierarchy-test-token')
    sessionStorage.setItem('zzh_invite_code', 'STALE-REFERRAL')
    mocks.registerAccount.mockRejectedValueOnce(new AuthApiError('验证码有误，请重试'))
    mocks.getAuthenticatedSession.mockResolvedValue({ user: { id: 7, mobile } })
    render(<LoginView />)

    const dialog = within(await screen.findByRole('dialog', { name: '注册新用户' }))
    await user.type(dialog.getByRole('textbox', { name: '手机号' }), mobile)
    await user.click(dialog.getByRole('button', { name: '获取验证码' }))
    await user.type(dialog.getByLabelText('密码'), 'Registration-Test-1!')
    await user.type(dialog.getByRole('textbox', { name: '验证码' }), '839172')
    expect(mocks.startOAuth).not.toHaveBeenCalled()

    await user.click(dialog.getByRole('button', { name: '注册' }))
    await dialog.findByText('验证码有误，请重试')
    await user.click(dialog.getByRole('button', { name: '注册' }))
    await waitFor(() => expect(mocks.handleLoginSuccess).toHaveBeenCalledTimes(1))

    expect(mocks.clearExistingSession).toHaveBeenCalledTimes(2)
    const hierarchyContext = expect.objectContaining({
      hierarchyInvite: 'hierarchy-test-token',
      inviteCode: '',
      inviteType: '',
    })
    expect(mocks.startOAuth.mock.calls).toEqual([[hierarchyContext], [hierarchyContext]])
  })
  it('隐私政策入口不会打开用户服务协议或自动同意', async () => {
    render(<LoginView />)
    fireEvent.click(screen.getByText('《隐私政策》'))
    expect(await screen.findByRole('dialog', { name: '帧智汇隐私政策' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '用户协议确认' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /关\s*闭/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: /已经阅读并同意/ })).not.toBeChecked()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.banners = []
    window.history.replaceState({}, '', '/login')
    mocks.clearExistingSession.mockResolvedValue(undefined)
    mocks.getAuthNavigationUrl.mockReturnValue('/auth/continue')
    mocks.getAuthenticatedSession.mockResolvedValue({ user: { id: 7 } })
    mocks.getCaptcha.mockResolvedValue({ id: '', image: '' })
    mocks.loginWithPassword.mockResolvedValue({ ok: true })
    mocks.loginWithSmsCode.mockResolvedValue({ ok: true })
    mocks.registerAccount.mockResolvedValue({ ok: true })
    mocks.sendAuthSms.mockResolvedValue(undefined)
    mocks.startOAuth.mockResolvedValue({ authorize_url: '/auth/continue', state: 'oauth-state' })
  })

  it('remembers the account across login tabs and remounts without storing credentials', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<LoginView />)
    const phone = screen.getByRole('textbox', { name: '手机号' })
    expect(screen.getByRole('checkbox', { name: '记住账号' })).not.toBeChecked()
    await user.type(phone, '13800138000')
    expect(localStorage.getItem('zzh_remembered_login_account')).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: '记住账号' }))
    await selectPasswordLogin(user)
    expect(screen.getByRole('checkbox', { name: '记住账号' })).toBeChecked()
    await user.type(screen.getByLabelText('密码'), 'Secret-987!')
    await user.clear(phone)
    await user.type(phone, '13900139000')
    expect(localStorage.getItem('zzh_remembered_login_account')).toBe('13900139000')
    unmount()
    render(<LoginView />)
    expect(screen.getByRole('textbox', { name: '手机号' })).toHaveValue('13900139000')
    expect(screen.getByRole('checkbox', { name: '记住账号' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: '短信验证码' })).toHaveValue('')
    await selectPasswordLogin(user)
    expect(screen.getByLabelText('密码')).toHaveValue('')
  })

  it('clears the saved account when unchecked and after browser storage is cleared', async () => {
    const user = userEvent.setup()
    localStorage.setItem('zzh_remembered_login_account', '13800138000')
    const first = render(<LoginView />)
    await user.click(screen.getByRole('checkbox', { name: '记住账号' }))
    expect(localStorage.getItem('zzh_remembered_login_account')).toBeNull()
    expect(screen.getByRole('textbox', { name: '手机号' })).toHaveValue('13800138000')
    first.unmount()
    const second = render(<LoginView />)
    expect(screen.getByRole('textbox', { name: '手机号' })).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: '记住账号' })).not.toBeChecked()
    second.unmount()
    localStorage.setItem('zzh_remembered_login_account', '13800138000')
    localStorage.clear()
    render(<LoginView />)
    expect(screen.getByRole('textbox', { name: '手机号' })).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: '记住账号' })).not.toBeChecked()
  })

  it('keeps login usable when local storage is unavailable', async () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      const user = userEvent.setup()
      render(<LoginView />)
      await user.type(screen.getByRole('textbox', { name: '手机号' }), '13800138000')
      await user.click(screen.getByRole('checkbox', { name: '记住账号' }))
      expect(screen.getByRole('textbox', { name: '手机号' })).toHaveValue('13800138000')
      expect(screen.getByRole('checkbox', { name: '记住账号' })).toBeChecked()
    } finally {
      read.mockRestore()
      write.mockRestore()
    }
  })

  it('keeps the current banner visible until the selected video has decoded its first frame', async () => {
    const user = userEvent.setup()
    mocks.banners = [
      { id: 1, title: '食品饮料', mediaType: 'video', mediaUrl: '/food.mp4' },
      { id: 2, title: '生活服务', mediaType: 'video', mediaUrl: '/life.mp4' },
    ]

    const { container } = render(<LoginView />)
    const lifeVideo = container.querySelector<HTMLVideoElement>('video[src="/life.mp4"]')!
    fireEvent.loadedData(lifeVideo)
    await waitFor(() => expect(lifeVideo.closest('.zlogin-hero-media')).toHaveClass('is-ready'))

    await user.click(screen.getByRole('button', { name: '食品饮料' }))
    const foodVideo = container.querySelector<HTMLVideoElement>('video[src="/food.mp4"]')!

    expect(lifeVideo).toBeInTheDocument()
    expect(lifeVideo.closest('.zlogin-hero-media')).toHaveClass('is-ready')
    expect(foodVideo.closest('.zlogin-hero-media')).not.toHaveClass('is-ready')

    // 旧视频的迟到事件不能让目标视频提前显示。
    fireEvent.playing(lifeVideo)
    expect(foodVideo.closest('.zlogin-hero-media')).not.toHaveClass('is-ready')

    fireEvent.loadedData(foodVideo)
    await waitFor(() => expect(foodVideo.closest('.zlogin-hero-media')).toHaveClass('is-ready'))
  })

  it('switches between SMS and password modes and validates required fields including whitespace-only mobile', async () => {
    const user = userEvent.setup()
    render(<LoginView />)

    expect(screen.getByRole('tab', { name: '短信登录' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: '短信验证码' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByText('请输入手机号')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: '手机号' }), '   ')
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

    await user.type(screen.getByRole('textbox', { name: '手机号' }), '   ')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(screen.getByText('请输入手机号')).toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: '手机号' }))
    await user.type(screen.getByRole('textbox', { name: '手机号' }), '123')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))

    expect(mocks.startOAuth).not.toHaveBeenCalled()
    expect(mocks.sendAuthSms).not.toHaveBeenCalled()
    expect(screen.getByText('请输入正确的手机号')).toBeInTheDocument()
  })

  it('accepts an 11-digit mainland mobile when requesting an SMS code', async () => {
    const user = userEvent.setup()
    render(<LoginView />)

    await user.type(screen.getByRole('textbox', { name: '手机号' }), '17633125265')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))

    await waitFor(() =>
      expect(mocks.sendAuthSms).toHaveBeenCalledWith(
        expect.objectContaining({ mobile: '17633125265', purpose: 'login' }),
      ),
    )
    expect(screen.getByRole('button', { name: '60s后重发' })).toBeDisabled()
    expect(mocks.startOAuth).not.toHaveBeenCalled()
    expect(mocks.clearExistingSession).not.toHaveBeenCalled()
  })

  it('keeps login SMS cooldowns per mobile and drops the previous mobile’s credentials', async () => {
    const user = userEvent.setup()
    const mobileA = '13800138000'
    const mobileB = '13900139000'
    const firstSend = deferred<void>()
    mocks.sendAuthSms.mockReturnValueOnce(firstSend.promise)
    render(<LoginView />)
    const phone = screen.getByRole('textbox', { name: '手机号' })
    const code = screen.getByRole('textbox', { name: '短信验证码' })

    fireEvent.change(phone, { target: { value: mobileA } })
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(screen.getByRole('button', { name: /发送中/ })).toBeDisabled()
    await user.type(code, '123456')

    fireEvent.change(phone, { target: { value: mobileB } })
    expect(code).toHaveValue('')
    await act(async () => {
      firstSend.resolve()
      await firstSend.promise
    })
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeEnabled()
    expect(mocks.showToast).not.toHaveBeenCalledWith('验证码已发送', 'success', 3000)
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(screen.getByRole('button', { name: /s后重发/ })).toBeDisabled()
    await user.type(code, '654321')

    fireEvent.change(phone, { target: { value: mobileA } })
    expect(code).toHaveValue('')
    expect(screen.getByRole('button', { name: /s后重发/ })).toBeDisabled()
    expect(mocks.sendAuthSms.mock.calls.map(([request]) => request.mobile)).toEqual([mobileA, mobileB])
    expect(mocks.startOAuth).not.toHaveBeenCalled()

    await selectPasswordLogin(user)
    const password = screen.getByLabelText('密码')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    await user.type(password, 'Old-mobile-password')
    fireEvent.change(phone, { target: { value: mobileB } })
    expect(password).toHaveValue('')
  })

  it('refreshes a challenged graphic code by keyboard and keeps it available after a failed refresh', async () => {
    const user = userEvent.setup()
    const challenge = new AuthApiError('请输入图形验证码', { code: 20007 })
    const initialImage = 'data:image/png;base64,AA'
    const refreshedImage = 'data:image/png;base64,AB'
    mocks.sendAuthSms.mockRejectedValueOnce(challenge)
    mocks.getCaptcha
      .mockResolvedValueOnce({ id: 'initial-captcha', image: initialImage })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ id: 'new-captcha', image: refreshedImage })
    render(<LoginView />)
    const phone = screen.getByRole('textbox', { name: '手机号' })
    fireEvent.change(phone, { target: { value: '13800138000' } })
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    const refresh = await screen.findByRole('button', { name: /刷新图形验证码/ })
    const answer = screen.getByRole('textbox', { name: '图形验证码' })
    await user.type(answer, 'ABCD')
    await user.tab()
    expect(refresh).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(mocks.getCaptcha).toHaveBeenCalledTimes(2)
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('图形验证码刷新失败'), 'error', 5000)
    expect(refresh.querySelector('img')).toHaveAttribute('src', initialImage)

    await user.keyboard(' ')
    expect(mocks.getCaptcha).toHaveBeenCalledTimes(3)
    expect(refresh.querySelector('img')).toHaveAttribute('src', refreshedImage)
    expect(answer).toHaveValue('')

    fireEvent.change(phone, { target: { value: '13900139000' } })
    expect(screen.queryByRole('textbox', { name: '图形验证码' })).not.toBeInTheDocument()
  })

  it('uses new OAuth for registration and waits for the registered account instead of accepting an old session', async () => {
    const user = userEvent.setup()
    const registrationMobile = '13900139000'
    const code = '839172'
    const registrationOAuth = { authorize_url: '/auth/continue', state: 'created-after-logout' }
    const oldSession = { user: { id: 11, mobile: '13800138000' } }
    const newSession = { user: { id: 22, mobile: registrationMobile } }
    const clearing = deferred<void>()
    mocks.startOAuth.mockResolvedValue(registrationOAuth)
    mocks.clearExistingSession.mockReturnValue(clearing.promise)
    mocks.getAuthenticatedSession.mockImplementation(async () =>
      mocks.getAuthenticatedSession.mock.calls.length === 1 ? oldSession : newSession,
    )
    localStorage.setItem('zzh_remembered_login_account', oldSession.user.mobile)
    render(<LoginView />)
    await selectPasswordLogin(user)
    const originalPassword = screen.getByLabelText('密码')
    await user.type(originalPassword, 'Existing-account-pass-1!')
    await user.click(screen.getByRole('checkbox', { name: /已经阅读并同意/ }))

    await user.click(screen.getByRole('button', { name: '免费注册' }))
    const dialog = within(screen.getByRole('dialog', { name: '注册新用户' }))
    await user.type(dialog.getByRole('textbox', { name: '手机号' }), registrationMobile)
    await user.click(dialog.getByRole('button', { name: '获取验证码' }))
    await waitFor(() =>
      expect(mocks.sendAuthSms).toHaveBeenCalledWith(
        expect.objectContaining({ mobile: registrationMobile, purpose: 'register' }),
      ),
    )
    expect(mocks.clearExistingSession).not.toHaveBeenCalled()
    expect(mocks.startOAuth).not.toHaveBeenCalled()
    await user.type(dialog.getByLabelText('密码'), 'Registration-Test-1!')
    await user.type(dialog.getByRole('textbox', { name: '验证码' }), code)
    await user.click(dialog.getByRole('button', { name: '注册' }))

    expect(mocks.clearExistingSession).toHaveBeenCalledTimes(1)
    expect(mocks.startOAuth).not.toHaveBeenCalled()
    expect(mocks.registerAccount).not.toHaveBeenCalled()
    expect(dialog.getByRole('button', { name: '处理中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^登录$/ })).toBeDisabled()
    originalPassword.focus()
    await user.keyboard('{Enter}')
    expect(mocks.clearExistingSession).toHaveBeenCalledTimes(1)
    await act(async () => {
      clearing.resolve()
      await clearing.promise
    })

    await waitFor(() => expect(mocks.handleLoginSuccess).toHaveBeenCalledWith(newSession, ''))
    expect(mocks.handleLoginSuccess).toHaveBeenCalledTimes(1)
    expect(mocks.getAuthenticatedSession).toHaveBeenCalledTimes(2)
    expect(mocks.loginWithPassword).not.toHaveBeenCalled()
    expect(mocks.clearExistingSession).toHaveBeenCalledTimes(1)
    expect(mocks.startOAuth).toHaveBeenCalledTimes(1)
    expect(mocks.sendAuthSms).toHaveBeenCalledTimes(1)
    expect(mocks.registerAccount).toHaveBeenCalledTimes(1)
    expect(mocks.registerAccount).toHaveBeenCalledWith(
      expect.objectContaining({ authStart: registrationOAuth, mobile: registrationMobile, smsCode: code }),
    )
  })

  it('waits for the phone-wide cooldown before sending a separate registration SMS', async () => {
    const user = userEvent.setup()
    const mobile = '13900139000'
    const session = { user: { id: 8, mobile } }
    mocks.loginWithSmsCode.mockRejectedValueOnce(new AuthApiError('手机号尚未注册', { code: 20003 }))
    mocks.getAuthenticatedSession.mockResolvedValue(session)
    render(<LoginView />)
    fireEvent.change(screen.getByRole('textbox', { name: '手机号' }), { target: { value: mobile } })
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    expect(screen.getByRole('button', { name: /s后重发/ })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: '短信验证码' }), '123456')
    await user.click(screen.getByRole('checkbox', { name: /已经阅读并同意/ }))
    await user.click(screen.getByRole('button', { name: '登录' }))

    const dialog = within(await screen.findByRole('dialog', { name: '完善账号信息' }))
    const code = dialog.getByRole('textbox', { name: '验证码' })
    await user.type(code, '123456')
    await user.click(dialog.getByRole('button', { name: '完成并登录' }))
    expect(mocks.registerAccount).not.toHaveBeenCalled()

    expect(dialog.getByRole('button', { name: /s后重发/ })).toBeDisabled()
    expect(mocks.sendAuthSms).toHaveBeenCalledTimes(1)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    let getRegistrationCode: HTMLElement
    try {
      getRegistrationCode = await dialog.findByRole('button', { name: '获取验证码' }, { timeout: 2000 })
    } finally {
      clock.mockRestore()
    }
    expect(getRegistrationCode).toBeEnabled()
    await user.click(getRegistrationCode)
    expect(mocks.sendAuthSms.mock.calls.map(([request]) => [request.mobile, request.purpose])).toEqual([
      [mobile, 'login'],
      [mobile, 'register'],
    ])
    expect(mocks.startOAuth).toHaveBeenCalledTimes(1)
    await user.clear(code)
    await user.type(code, '654321')
    await user.type(dialog.getByLabelText(/设置密码/), 'Registration-Test-1!')
    await user.click(dialog.getByRole('button', { name: '完成并登录' }))

    await waitFor(() => expect(mocks.handleLoginSuccess).toHaveBeenCalledWith(session, ''))
    expect(mocks.startOAuth).toHaveBeenCalledTimes(2)
    expect(mocks.registerAccount).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ mobile, smsCode: '654321' }),
    )
  })

  it('rejects a malformed mobile at SMS login submission before starting OAuth', async () => {
    const user = userEvent.setup()
    render(<LoginView />)

    await user.type(screen.getByRole('textbox', { name: '手机号' }), '123')
    await user.type(screen.getByRole('textbox', { name: '短信验证码' }), '592442')
    await user.click(screen.getByRole('checkbox', { name: /已经阅读并同意/ }))
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
    expect(screen.getByRole('checkbox', { name: /已经阅读并同意/ })).toBeChecked()

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
    await user.click(screen.getByRole('checkbox', { name: /已经阅读并同意/ }))

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
    mocks.loginWithPassword.mockRejectedValue(new AuthApiError('认证失败'))
    render(<LoginView />)
    await fillPasswordLogin(user, { mobile, password: secret })
    await user.click(screen.getByRole('checkbox', { name: /已经阅读并同意/ }))
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('认证失败', 'error', 5000))
    expect(screen.getByRole('textbox', { name: '手机号' })).toHaveValue(mobile)
    expect(window.location.href).not.toContain(secret)
    expect(window.location.href).not.toContain(mobile)

    const emittedLogs = JSON.stringify([...mocks.loggerWarn.mock.calls, ...consoleWarning.mock.calls])
    expect(emittedLogs).not.toContain(secret)
    expect(emittedLogs).not.toContain(mobile)
  })

  it.each([
    {
      phase: 'starting OAuth',
      failingRequest: mocks.startOAuth,
      message: '登录初始化失败，请稍后重试。',
      reachesPasswordLogin: false,
    },
    {
      phase: 'submitting the password',
      failingRequest: mocks.loginWithPassword,
      message: '登录失败，请稍后重试，也可以尝试短信验证码登录。',
      reachesPasswordLogin: true,
    },
  ])(
    'shows a recovery message after an unexpected failure while $phase',
    async ({ failingRequest, message, reachesPasswordLogin }) => {
      const user = userEvent.setup()
      failingRequest.mockRejectedValueOnce(new Error())
      render(<LoginView />)
      await fillPasswordLogin(user)
      await user.click(screen.getByRole('checkbox', { name: /已经阅读并同意/ }))
      await user.click(screen.getByRole('button', { name: '登录' }))

      await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(message, 'error', 5000))
      expect(mocks.loginWithPassword).toHaveBeenCalledTimes(reachesPasswordLogin ? 1 : 0)
      expect(mocks.getAuthenticatedSession).not.toHaveBeenCalled()
      expect(mocks.handleLoginSuccess).not.toHaveBeenCalled()
    },
  )

  it('normalizes spaces in SMS credentials without exposing the code in the URL or logs', async () => {
    const user = userEvent.setup()
    const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(<LoginView />)
    await user.type(screen.getByRole('textbox', { name: '手机号' }), '176 3312 5265')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    await user.type(screen.getByRole('textbox', { name: '短信验证码' }), ' 592442 ')
    await user.click(screen.getByRole('checkbox', { name: /已经阅读并同意/ }))
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() =>
      expect(mocks.loginWithSmsCode).toHaveBeenCalledWith(
        expect.objectContaining({ mobile: '17633125265', smsCode: '592442' }),
      ),
    )
    expect(window.location.href).not.toContain('592442')
    expect(JSON.stringify([...mocks.loggerWarn.mock.calls, ...consoleWarning.mock.calls])).not.toContain('592442')
  })

  it.each(['credentials', 'session'] as const)('discards a late %s response after leaving login', async (stage) => {
    const user = userEvent.setup()
    const response = deferred<unknown>()
    const request = stage === 'credentials' ? mocks.loginWithPassword : mocks.getAuthenticatedSession
    request.mockReturnValueOnce(response.promise)
    const { unmount } = render(<LoginView />)
    await fillPasswordLogin(user)
    await user.click(screen.getByRole('checkbox', { name: /已经阅读并同意/ }))
    await user.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: '返回上一页' }))
    expect(mocks.navigate).toHaveBeenCalledWith('/welcome', { replace: true })
    unmount()

    await act(async () => {
      response.resolve(stage === 'credentials' ? { ok: true } : { user: { id: 22, nickname: '迟到的会话' } })
      await response.promise
    })

    const sessionStarted = stage === 'credentials' ? 0 : 1
    expect(mocks.markAuthSessionExpected).toHaveBeenCalledTimes(sessionStarted)
    expect(mocks.getAuthenticatedSession).toHaveBeenCalledTimes(sessionStarted)
    expect(mocks.handleLoginSuccess).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledTimes(1)
  })

  it('keeps login locked while confirming the session and finishes the original attempt', async () => {
    const user = userEvent.setup()
    const pendingSession = deferred<{ user: { id: number; nickname: string } }>()
    const session = { user: { id: 22, nickname: '当前账号' } }
    mocks.getAuthenticatedSession.mockReturnValueOnce(pendingSession.promise)
    render(<LoginView />)
    await fillPasswordLogin(user)
    await user.click(screen.getByRole('checkbox', { name: /已经阅读并同意/ }))

    await user.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(mocks.getAuthenticatedSession).toHaveBeenCalledTimes(1))

    const submit = screen.getByRole('button', { name: '登录中…' })
    expect(submit).toBeDisabled()
    const password = screen.getByLabelText('密码')
    password.focus()
    await user.keyboard('{Enter}')
    await user.dblClick(submit)
    expect(mocks.clearExistingSession).toHaveBeenCalledTimes(1)
    expect(mocks.startOAuth).toHaveBeenCalledTimes(1)
    expect(mocks.loginWithPassword).toHaveBeenCalledTimes(1)
    expect(mocks.handleLoginSuccess).not.toHaveBeenCalled()

    await act(async () => {
      pendingSession.resolve(session)
      await pendingSession.promise
    })

    expect(mocks.handleLoginSuccess).toHaveBeenCalledWith(session, '')
    expect(mocks.handleLoginSuccess).toHaveBeenCalledTimes(1)
  })

  it('allows a fresh login after a stalled direct session request times out', async () => {
    const user = userEvent.setup()
    const stalled = deferred<{ user: { id: number } }>()
    const session = { user: { id: 22, nickname: '重试账号' } }
    mocks.getAuthNavigationUrl.mockReturnValueOnce('/')
    mocks.getAuthenticatedSession.mockReturnValueOnce(stalled.promise)
    render(<LoginView />)
    await fillPasswordLogin(user)
    await user.click(screen.getByRole('checkbox', { name: /已经阅读并同意/ }))

    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: '登录' }))
      await act(async () => vi.advanceTimersByTimeAsync(1199))
      expect(mocks.getAuthenticatedSession).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: '登录中…' })).toBeDisabled()
      expect(mocks.showToast).not.toHaveBeenCalled()

      await act(async () => vi.advanceTimersByTimeAsync(1))

      expect(mocks.showToast).toHaveBeenCalledWith('未能建立登录会话，请重新登录。', 'error', 5000)
      expect(mocks.handleLoginSuccess).not.toHaveBeenCalled()
      const retry = screen.getByRole('button', { name: '登录' })
      expect(retry).toBeEnabled()

      mocks.getAuthenticatedSession.mockResolvedValue(session)
      fireEvent.click(retry)
      await act(async () => vi.advanceTimersByTimeAsync(0))

      expect(mocks.loginWithPassword).toHaveBeenCalledTimes(2)
      await act(async () => {
        stalled.resolve({ user: { id: 11 } })
        await stalled.promise
      })
      expect(mocks.handleLoginSuccess).toHaveBeenCalledExactlyOnceWith(session, '')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops a stalled iframe session check by the end of the bridge time limit', async () => {
    const user = userEvent.setup()
    const stalled = deferred<{ user: { id: number } }>()
    mocks.getAuthenticatedSession
      .mockImplementation(() => {
        if (document.querySelector('iframe[aria-hidden="true"]')) return stalled.promise
        return Promise.reject(new AuthApiError('未登录'))
      })
      .mockResolvedValueOnce({ user: { id: 11, mobile: '13800138000' } })
    render(<LoginView />)
    await fillPasswordLogin(user)
    await user.click(screen.getByRole('checkbox', { name: /已经阅读并同意/ }))

    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: '登录' }))
      await act(async () => vi.advanceTimersByTimeAsync(2500))
      const frame = document.querySelector('iframe[aria-hidden="true"]')
      expect(frame).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '登录中…' })).toBeDisabled()

      await act(async () => vi.advanceTimersByTimeAsync(4700))
      expect(frame).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '登录' })).toBeEnabled()
      expect(mocks.handleLoginSuccess).not.toHaveBeenCalled()
      expect(mocks.showToast).toHaveBeenCalledWith('登录会话与提交的账号不一致，请重新登录。', 'error', 5000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('consumes the callback failure marker once and carries the original target into the retry', () => {
    const returnTo = '/projects?from=oauth-callback-error#project-list'
    keepOAuthLoginReturnTo(returnTo)
    window.history.replaceState({}, '', '/login?oauth_callback=failed')
    const { rerender } = render(
      <StrictMode>
        <LoginView />
      </StrictMode>,
    )

    expect(mocks.showToast).toHaveBeenCalledExactlyOnceWith('登录回调失败，请重新登录。', 'error', 5000)
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/login', { replace: true, state: { returnTo } })
    expect(consumeOAuthLoginReturnTo()).toBe('')
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled()

    window.history.replaceState({}, '', '/login')
    rerender(
      <StrictMode>
        <LoginView />
      </StrictMode>,
    )
    expect(mocks.showToast).toHaveBeenCalledTimes(1)
    expect(mocks.navigate).toHaveBeenCalledTimes(1)
    expect(mocks.startOAuth).not.toHaveBeenCalled()
  })

  it('forwards the guarded page (returnTo) to the auth context after login', async () => {
    const user = userEvent.setup()
    const session = { user: { id: 22, nickname: '回跳账号' } }
    mocks.locationState = { returnTo: '/projects/12/videos?x=1' }
    mocks.getAuthenticatedSession.mockReset()
    mocks.getAuthenticatedSession.mockResolvedValue(session)
    mocks.loginWithPassword.mockResolvedValue({ attempt: 'ok' })
    try {
      render(<LoginView />)
      await fillPasswordLogin(user, { password: 'Some-Password-1!' })
      await user.click(screen.getByRole('checkbox', { name: /已经阅读并同意/ }))
      await user.click(screen.getByRole('button', { name: '登录' }))
      await waitFor(() => expect(mocks.handleLoginSuccess).toHaveBeenCalledWith(session, '/projects/12/videos?x=1'))
    } finally {
      mocks.locationState = undefined
    }
  })
})
