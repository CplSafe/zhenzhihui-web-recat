import { expect, test, type Request } from '@playwright/test'
import {
  installStrictAuthenticatedApp,
  expectNoUnexpectedApi,
  TEAM_WORKSPACE_NAME,
  WORKSPACE_ID,
} from './fixtures/strict-authenticated-app'

const unauthorizedResponse = JSON.stringify({
  code: 'UNAUTHORIZED',
  message: 'session expired',
})

async function resetBrowserStorage(page: import('@playwright/test').Page, options: { staleSession?: boolean } = {}) {
  await page.addInitScript(({ staleSession }) => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    if (staleSession) window.localStorage.setItem('zzh_has_auth_session', '1')
  }, options)
}

test('注册短信支持失败重试、更换手机号以及填完后提交', async ({ page }, testInfo) => {
  await resetBrowserStorage(page)
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 401, body: unauthorizedResponse }))
  let oauthStarts = 0
  await page.route('**/api/v1/auth/oauth-start?**', (route) => {
    oauthStarts++
    return route.fulfill({ json: { code: 0, data: { client_id: 'browser-test', return_to: '/auth/callback' } } })
  })
  const smsMobiles: string[] = []
  const registrations: unknown[] = []
  let failFirstSms!: () => void
  const firstSms = new Promise<void>((resolve) => {
    failFirstSms = resolve
  })
  await page.route('**/deepauth/api/v1/public/auth/sms/send', async (route) => {
    const body = route.request().postDataJSON()
    expect(body.purpose).toBe('register')
    smsMobiles.push(body.mobile)
    if (smsMobiles.length === 1) {
      await firstSms
      return route.fulfill({ status: 503, json: { code: 503, message: '短信服务繁忙，请重试' } })
    }
    return route.fulfill({ json: { code: 0, data: null } })
  })
  await page.route('**/deepauth/api/v1/public/auth/register', (route) => {
    registrations.push(route.request().postDataJSON())
    return route.fulfill({ status: 400, json: { code: 10003, message: '验证码错误' } })
  })

  await page.goto('/login')
  await page.getByRole('button', { name: '免费注册' }).click()
  const dialog = page.getByRole('dialog', { name: '注册新用户' })
  const mobile = dialog.getByRole('textbox', { name: '手机号' })
  const password = dialog.getByLabel('密码', { exact: true })
  const code = dialog.getByRole('textbox', { name: '验证码', exact: true })
  const send = dialog.getByRole('button', { name: '获取验证码', exact: true })
  const submit = dialog.getByRole('button', { name: '注册', exact: true })
  await expect(submit).toBeDisabled()
  await mobile.fill('13800000000')
  await password.fill('Test-password-1!')
  await code.fill('123456')
  await expect(submit).toBeDisabled()
  await send.click()
  try {
    await expect(dialog.getByRole('button', { name: '发送中…' })).toBeDisabled()
    await expect(submit).toBeDisabled()
    await expect(mobile).not.toBeEditable()
    await expect(dialog.getByRole('button', { name: '关闭' })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('registration-sending.png') })
  } finally {
    failFirstSms()
  }
  await expect(send).toBeEnabled()
  await expect(dialog.getByText('短信服务繁忙，请重试')).toBeVisible()
  await expect(submit).toBeDisabled()
  await code.clear()
  await send.click()
  const countdown = dialog.getByRole('button', { name: /s后重发/ })
  await expect(countdown).toBeDisabled()
  await expect(mobile).toBeEditable()
  await expect(submit).toBeDisabled()
  await code.fill('123456')
  await expect(submit).toBeEnabled()
  await mobile.fill('13900000000')
  await expect(code).toHaveValue('')
  await expect(submit).toBeDisabled()
  await mobile.fill('13800000000')
  await expect(countdown).toBeDisabled()
  await mobile.fill('13900000000')
  await send.click()
  await expect(countdown).toBeDisabled()

  await mobile.fill('13800000000')
  await expect(countdown).toBeDisabled()
  await expect(code).toHaveValue('')
  await code.fill('123456')
  await expect(submit).toBeEnabled()
  await mobile.fill('13900000000')
  await expect(code).toHaveValue('')
  await expect(submit).toBeDisabled()
  await code.fill('654321')
  await expect(submit).toBeEnabled()
  expect(oauthStarts).toBe(0)
  expect(registrations).toEqual([])
  await submit.click()
  await expect(dialog.getByText('验证码错误')).toBeVisible()
  expect(oauthStarts).toBe(1)
  expect(smsMobiles).toEqual(['13800000000', '13800000000', '13900000000'])
  expect(registrations).toEqual([
    expect.objectContaining({ mobile: '13900000000', sms_code: '654321', terms_accepted: true }),
  ])
  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).toBeHidden()
})

test('提交注册才清理旧会话并用新的 OAuth 回调登录新账号', async ({ page }) => {
  test.slow()
  const api = await installStrictAuthenticatedApp(page)
  const cookie = 'e2e_registration_session'
  const oldUser = { id: 8, nickname: 'E2E 旧账号', mobile: '13800000000' }
  const newUser = { id: 7, nickname: 'E2E 新账号', mobile: '13900000000' }
  const workspace = {
    id: WORKSPACE_ID,
    name: TEAM_WORKSPACE_NAME,
    type: 'team',
    owner_user_id: newUser.id,
    status: 'active',
  }
  const events: string[] = []
  let oldSessionReads = 0
  let finishLogout!: () => void
  const logoutResponse = new Promise<void>((resolve) => {
    finishLogout = resolve
  })
  let finishCallback!: () => void
  const callbackResponse = new Promise<void>((resolve) => {
    finishCallback = resolve
  })
  // WebKit 的拦截请求不公开 Cookie 请求头，用当前 URL 对应的浏览器 Cookie 检查会话。
  const hasCookie = async (request: Request, value: string) =>
    (await page.context().cookies(request.url())).some(
      (entry) => entry.name === cookie && entry.value === value && entry.httpOnly,
    )
  const unauthorized = { status: 401, json: { code: 10101, message: 'UNAUTHORIZED' } }
  const authStart = (state: 'old' | 'fresh') => `/deepauth/oauth2/authorize?state=${state}`

  await page.route('**/api/v1/auth/session', async (route) => {
    const request = route.request()
    if (await hasCookie(request, 'old')) {
      oldSessionReads++
      return route.fulfill({ json: { code: 0, data: { user: oldUser, workspace, workspaces: [workspace] } } })
    }
    if (await hasCookie(request, 'new')) {
      expect(events).toContain('callback-completed')
      return route.fallback()
    }
    return route.fulfill(unauthorized)
  })
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill(unauthorized))
  await page.route('**/api/v1/me', async (route) => {
    const request = route.request()
    if (await hasCookie(request, 'old')) return route.fulfill({ json: { code: 0, data: { user: oldUser } } })
    if (await hasCookie(request, 'new')) {
      expect(events).toContain('callback-completed')
      return route.fulfill({ json: { code: 0, data: { user: newUser } } })
    }
    return route.fulfill(unauthorized)
  })
  await page.route('**/api/v1/auth/logout', async (route) => {
    expect(route.request().method()).toBe('POST')
    expect(await hasCookie(route.request(), 'old')).toBe(true)
    events.push('logout')
    await logoutResponse
    events.push('logout-completed')
    return route.fulfill({
      headers: { 'set-cookie': `${cookie}=; HttpOnly; Path=/; Max-Age=0` },
      json: { code: 0, data: null },
    })
  })
  await page.route('**/api/v1/auth/oauth-start?**', async (route) => {
    const state = (await hasCookie(route.request(), 'old')) ? 'old' : 'fresh'
    events.push(`start-${state}`)
    return route.fulfill({
      json: {
        code: 0,
        data: { client_id: 'browser-test', return_to: authStart(state), authorize_url: authStart(state) },
      },
    })
  })
  await page.route('**/deepauth/api/v1/public/auth/sms/send', async (route) => {
    expect(await hasCookie(route.request(), 'old')).toBe(true)
    expect(route.request().postDataJSON()).toMatchObject({ mobile: newUser.mobile, purpose: 'register' })
    events.push('sms')
    return route.fulfill({ json: { code: 0, data: null } })
  })
  await page.route('**/deepauth/api/v1/public/auth/register', async (route) => {
    expect(await hasCookie(route.request(), 'old')).toBeFalsy()
    expect(route.request().postDataJSON()).toMatchObject({
      mobile: newUser.mobile,
      sms_code: '123456',
      terms_accepted: true,
      return_to: authStart('fresh'),
    })
    events.push('register')
    return route.fulfill({ json: { code: 0, data: { redirect_to: authStart('fresh') } } })
  })
  await page.route('**/deepauth/oauth2/authorize?**', (route) => {
    expect(new URL(route.request().url()).searchParams.get('state')).toBe('fresh')
    events.push('authorize')
    // Playwright 只拦截重定向链的首个 URL，文档跳转让回调作为独立请求进入下方夹具。
    return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta http-equiv="refresh" content="0;url=/api/v1/auth/callback?state=fresh">',
    })
  })
  await page.route('**/api/v1/auth/callback?**', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('state')).toBe('fresh')
    events.push('callback')
    await callbackResponse
    events.push('callback-completed')
    return route.fulfill({
      contentType: 'text/html',
      headers: { 'set-cookie': `${cookie}=new; HttpOnly; Path=/` },
      body: '<!doctype html><title>OAuth callback</title>',
    })
  })
  await page.route('**/api/v1/banners?**', (route) => route.fulfill({ json: { code: 0, data: [] } }))

  await page.goto('/hot-copy')
  const guestLogin = page.getByRole('button', { name: '登录', exact: true })
  await expect(guestLogin).toBeVisible()
  await page.context().addCookies([{ name: cookie, value: 'old', url: new URL('/', page.url()).href, httpOnly: true }])
  // 旧 Cookie 仍能通过真实请求形状读到 A，页面缺少登录标记，因此可以进入注册。
  expect(
    await page.evaluate(async () => {
      const response = await fetch('/api/v1/auth/session', { credentials: 'include' })
      return { status: response.status, userId: (await response.json()).data?.user?.id }
    }),
  ).toEqual({ status: 200, userId: oldUser.id })
  expect(await page.evaluate(() => localStorage.getItem('zzh_has_auth_session'))).toBeNull()
  await guestLogin.click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('button', { name: '免费注册' }).click()

  const dialog = page.getByRole('dialog', { name: '注册新用户' })
  const submit = dialog.getByRole('button', { name: '注册', exact: true })
  await dialog.getByRole('textbox', { name: '手机号' }).fill(newUser.mobile)
  await dialog.getByLabel('密码', { exact: true }).fill('Test-password-1!')
  await expect(submit).toBeDisabled()
  await dialog.getByRole('button', { name: '获取验证码', exact: true }).click()
  await expect(dialog.getByRole('button', { name: /s后重发/ })).toBeDisabled()
  await expect(submit).toBeDisabled()
  expect(events).toEqual(['sms'])

  await dialog.getByRole('textbox', { name: '验证码', exact: true }).fill('123456')
  await expect(submit).toBeEnabled()
  await submit.click()
  try {
    await expect.poll(() => events).toEqual(['sms', 'logout'])
    await expect(page).toHaveURL(/\/login$/)
    await expect(dialog.getByRole('button', { name: '关闭' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
  } finally {
    finishLogout()
  }

  try {
    await expect.poll(() => events.at(-1)).toBe('callback')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByText(oldUser.nickname, { exact: true })).toHaveCount(0)
    await expect(page.getByText(newUser.nickname, { exact: true })).toHaveCount(0)
  } finally {
    finishCallback()
  }

  await expect(page).toHaveURL(/\/hot-copy$/)
  await expect(page.getByText(newUser.nickname, { exact: true })).toBeVisible()
  await expect(page.getByText(oldUser.nickname, { exact: true })).toHaveCount(0)
  expect(oldSessionReads).toBe(1)
  expect(events).toEqual([
    'sms',
    'logout',
    'logout-completed',
    'start-fresh',
    'register',
    'authorize',
    'callback',
    'callback-completed',
  ])
  expectNoUnexpectedApi(api)
})

test.describe('游客访问边界', () => {
  test('受保护的项目页在过期会话下回到登录页', async ({ page }) => {
    await resetBrowserStorage(page, { staleSession: true })

    await page.route(
      (url) => url.pathname === '/api/v1/auth/session' || url.pathname === '/api/v1/auth/refresh',
      async (route) => {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: unauthorizedResponse,
        })
      },
    )

    await page.goto('/projects')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: '欢迎加入帧智汇' })).toBeVisible()
  })

  test('智能成片和爆款复制入口允许游客浏览', async ({ page }) => {
    // 两个大型创作路由都按需加载；WebKit 在全套并行运行、连续两次整页导航时
    // 会接近默认 30 秒总时限。保留各断言的 10 秒上限，只放宽整条双路由用例。
    test.slow()
    await resetBrowserStorage(page)

    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], items: [], list: [], records: [], total: 0 }),
        })
      },
    )

    await page.goto('/smart')
    await expect(page).toHaveURL(/\/smart$/)
    await expect(page.getByRole('heading', { name: '打造我想要的爆款视频' })).toBeVisible()

    await page.goto('/hot-copy')
    await expect(page).toHaveURL(/\/hot-copy$/)
    await expect(page.getByRole('heading', { name: '爆款作业直接抄,你的产品当主角!' })).toBeVisible()
  })
})

test('过期会话下记住账号重新登录恢复受保护路由，无认证上下文白屏', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  const projectTarget = '/projects?from=login-regression#project-list'
  let loggedIn = false
  let loginPosts = 0
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route(
    (url) => url.pathname === '/api/v1/auth/session' || url.pathname === '/api/v1/auth/refresh',
    (route) => {
      if (loggedIn) return route.fallback()
      return route.fulfill({
        status: 401,
        json: { code: 10101, code_string: 'UNAUTHORIZED', message: 'session expired' },
      })
    },
  )
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ json: { code: 0, data: null } }))
  await page.route('**/api/v1/auth/oauth-start?**', (route) =>
    route.fulfill({ json: { code: 0, data: { client_id: 'browser-test', return_to: '/auth/callback' } } }),
  )
  await page.route('**/deepauth/api/v1/public/auth/login', (route) => {
    expect(route.request().method()).toBe('POST')
    loginPosts++
    loggedIn = true
    return route.fulfill({ json: { code: 0, data: { success: true } } })
  })
  await page.route(
    (url) => url.pathname.includes('/banners'),
    (route) => route.fulfill({ json: { code: 0, data: [] } }),
  )
  await page.goto(projectTarget)
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('tab', { name: '密码登录' }).click()
  await page.getByRole('textbox', { name: '手机号' }).fill('13800000000')
  await page.getByLabel('密码', { exact: true }).fill('test-password-only')
  await page.getByRole('checkbox', { name: '记住账号' }).check()
  await page.getByRole('checkbox', { name: /已经阅读并同意/ }).check()
  await page.screenshot({ path: testInfo.outputPath('remembered-account-login.png') })
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(new URL(projectTarget, page.url()).href)
  await expect(page.getByRole('heading', { name: '项目管理' })).toBeVisible()
  await expect(page.getByText('页面加载失败', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('zzh_remembered_login_account'))).toBe('13800000000')
  expect(loginPosts).toBe(1)
  expect(pageErrors).toEqual([])
  expectNoUnexpectedApi(api)
})

test('静默 OAuth 被拦截后从整页回调一次性恢复原项目地址', async ({ page }) => {
  test.slow()
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const projectTarget = '/projects?from=oauth-fallback#project-list'
  const authorizeUrl = (state: string) => `/deepauth/oauth2/authorize?state=${state}`
  const expiredSession = { status: 401, json: { code: 10101, code_string: 'UNAUTHORIZED' } }
  const steps: string[] = []
  let authenticated = false
  let oauthStarts = 0
  await page.route('**/api/v1/auth/session', (route) =>
    authenticated ? route.fallback() : route.fulfill(expiredSession),
  )
  await page.route('**/api/v1/auth/refresh', (route) => {
    if (!authenticated) return route.fulfill(expiredSession)
    return route.fulfill({ json: { code: 0, data: { expires_in: 3600 } } })
  })
  await page.route('**/api/v1/auth/logout', (route) => {
    steps.push('logout')
    return route.fulfill({ json: { code: 0, data: null } })
  })
  await page.route('**/api/v1/auth/oauth-start?**', (route) => {
    const state = ++oauthStarts === 1 ? 'silent' : 'fallback'
    steps.push(`start-${state}`)
    const url = authorizeUrl(state)
    return route.fulfill({
      json: { code: 0, data: { client_id: 'browser-test', return_to: url, authorize_url: url } },
    })
  })
  await page.route('**/deepauth/api/v1/public/auth/login', (route) => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toMatchObject({ mobile: '13800000000', method: 'password' })
    steps.push('password-login')
    return route.fulfill({ json: { code: 0, data: { redirect_to: authorizeUrl('silent') } } })
  })
  await page.route('**/deepauth/oauth2/authorize?state=*', (route) => {
    const state = new URL(route.request().url()).searchParams.get('state')
    if (route.request().frame() !== page.mainFrame()) {
      steps.push(`iframe-blocked-${state}`)
      return route.fulfill({ headers: { 'x-frame-options': 'DENY' }, contentType: 'text/html', body: '' })
    }
    steps.push(`top-level-authorize-${state}`)
    if (state !== 'fallback') return route.fulfill({ status: 400, body: 'OAuth state already used' })
    return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta http-equiv="refresh" content="0;url=/api/v1/auth/callback?state=fallback">',
    })
  })
  await page.route('**/api/v1/auth/callback?state=fallback', (route) => {
    expect(route.request().frame()).toBe(page.mainFrame())
    steps.push('top-level-callback')
    authenticated = true
    return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta http-equiv="refresh" content="0;url=/home">',
    })
  })
  await page.route('**/api/v1/banners?**', (route) => route.fulfill({ json: { code: 0, data: [] } }))

  await page.goto(projectTarget)
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('tab', { name: '密码登录' }).click()
  await page.getByRole('textbox', { name: '手机号' }).fill('13800000000')
  await page.getByLabel('密码', { exact: true }).fill('test-password-only')
  await page.getByRole('checkbox', { name: /已经阅读并同意/ }).check()
  await page.getByRole('button', { name: '登录', exact: true }).click()

  await expect(page).toHaveURL(new URL(projectTarget, page.url()).href, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: '项目管理' })).toBeVisible()
  expect(steps).toEqual([
    'logout',
    'start-silent',
    'password-login',
    'iframe-blocked-silent',
    'start-fallback',
    'top-level-authorize-fallback',
    'top-level-callback',
  ])

  // 再次访问默认落点时，已经使用过的回跳目标不应把用户送回项目页。
  await page.goto('/home')
  await expect(page).toHaveURL(/\/hot-copy$/)
  await expect(page.getByText('E2E 用户', { exact: true })).toBeVisible()
  expectNoUnexpectedApi(api)
})

test('静默登录回调返回 400 时保留登录表单，用户重试使用新的 OAuth 状态', async ({ page }, testInfo) => {
  test.slow()
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const projectTarget = '/projects?from=oauth-callback-error#project-list'
  const authorizeUrl = (state: string) => `/deepauth/oauth2/authorize?state=${state}`
  const expiredSession = { status: 401, json: { code: 10101, code_string: 'UNAUTHORIZED' } }
  const steps: string[] = []
  let authenticated = false
  let oauthStarts = 0

  await page.route('**/api/v1/auth/session', (route) =>
    authenticated ? route.fallback() : route.fulfill(expiredSession),
  )
  await page.route('**/api/v1/auth/refresh', (route) =>
    authenticated ? route.fulfill({ json: { code: 0, data: { expires_in: 3600 } } }) : route.fulfill(expiredSession),
  )
  await page.route('**/api/v1/auth/logout', (route) => {
    steps.push('logout')
    return route.fulfill({ json: { code: 0, data: null } })
  })
  await page.route('**/api/v1/auth/oauth-start?**', (route) => {
    const state = ++oauthStarts === 1 ? 'first' : 'retry'
    steps.push(`start-${state}`)
    const url = authorizeUrl(state)
    return route.fulfill({
      json: { code: 0, data: { client_id: 'browser-test', return_to: url, authorize_url: url } },
    })
  })
  await page.route('**/deepauth/api/v1/public/auth/login', (route) => {
    const state = oauthStarts === 1 ? 'first' : 'retry'
    expect(route.request().postDataJSON()).toMatchObject({
      mobile: '13800000000',
      method: 'password',
      return_to: authorizeUrl(state),
    })
    steps.push(`password-login-${state}`)
    return route.fulfill({ json: { code: 0, data: { redirect_to: authorizeUrl(state) } } })
  })
  await page.route('**/deepauth/oauth2/authorize?state=*', (route) => {
    const request = route.request()
    const state = new URL(request.url()).searchParams.get('state')
    const frame = request.frame() === page.mainFrame() ? 'top-level' : 'iframe'
    steps.push(`${frame}-authorize-${state}`)
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta http-equiv="refresh" content="0;url=/auth/callback?code=mock-${state}&amp;state=${state}">`,
    })
  })
  await page.route('**/auth/callback?**', (route) => {
    const request = route.request()
    const state = new URL(request.url()).searchParams.get('state')
    const frame = request.frame() === page.mainFrame() ? 'top-level' : 'iframe'
    steps.push(`${frame}-callback-${state}`)
    if (state === 'first') {
      return route.fulfill({
        status: 400,
        json: { code: 10001, code_string: 'BAD_REQUEST', message: '登录回调处理失败，请重新登录' },
      })
    }
    authenticated = true
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>OAuth callback</title>' })
  })
  await page.route('**/api/v1/banners?**', (route) => route.fulfill({ json: { code: 0, data: [] } }))

  await page.goto(projectTarget)
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('tab', { name: '密码登录' }).click()
  await page.getByRole('textbox', { name: '手机号' }).fill('13800000000')
  const password = page.getByLabel('密码', { exact: true })
  await password.fill('test-password-only')
  await page.getByRole('checkbox', { name: /已经阅读并同意/ }).check()
  const login = page.getByRole('button', { name: '登录', exact: true })
  await login.click()

  await expect(page.locator('.toast-text')).toHaveText('登录回调失败，请重新登录。')
  await expect(page).toHaveURL(/\/login$/)
  await expect(login).toBeEnabled()
  expect(steps).toEqual([
    'logout',
    'start-first',
    'password-login-first',
    'iframe-authorize-first',
    'iframe-callback-first',
  ])
  await page.screenshot({ path: testInfo.outputPath('recoverable-oauth-callback-error.png') })

  await password.fill('test-password-only')
  await login.click()
  await expect(page).toHaveURL(new URL(projectTarget, page.url()).href, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: '项目管理' })).toBeVisible()
  expect(steps.slice(5)).toEqual([
    'logout',
    'start-retry',
    'password-login-retry',
    'iframe-authorize-retry',
    'iframe-callback-retry',
  ])
  expectNoUnexpectedApi(api)
})

test('短信登录按手机号保留重发冷却，切回第一组账号后用新输入的验证码登录', async ({ page }, testInfo) => {
  test.slow()
  const api = await installStrictAuthenticatedApp(page)
  const mobileA = '13800000000'
  const mobileB = '13900000000'
  const attempts: string[] = []
  const expiredSession = { status: 401, json: { code: 10101, code_string: 'UNAUTHORIZED' } }
  let loggedIn = false
  await page.route('**/api/v1/auth/session', (route) => (loggedIn ? route.fallback() : route.fulfill(expiredSession)))
  await page.route('**/api/v1/auth/refresh', (route) => {
    if (!loggedIn) return route.fulfill(expiredSession)
    return route.fulfill({ json: { code: 0, data: { expires_in: 3600 } } })
  })
  await page.route('**/deepauth/api/v1/public/auth/sms/send', (route) => {
    const request = route.request()
    expect(request.method()).toBe('POST')
    const { mobile, purpose } = request.postDataJSON()
    expect(purpose).toBe('login')
    attempts.push(`sms-${mobile}`)
    return route.fulfill({ json: { code: 0, data: null } })
  })
  await page.route('**/api/v1/auth/logout', (route) => {
    attempts.push('logout')
    return route.fulfill({ json: { code: 0, data: null } })
  })
  await page.route('**/api/v1/auth/oauth-start?**', (route) => {
    attempts.push('oauth-start')
    return route.fulfill({ json: { code: 0, data: { client_id: 'browser-test', return_to: '/auth/callback' } } })
  })
  await page.route('**/deepauth/api/v1/public/auth/login', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ mobile: mobileA, method: 'sms_code', sms_code: '123456' })
    attempts.push('sms-login')
    loggedIn = true
    return route.fulfill({ json: { code: 0, data: { success: true } } })
  })
  await page.route('**/api/v1/banners?**', (route) => route.fulfill({ json: { code: 0, data: [] } }))

  await page.goto('/projects')
  await expect(page).toHaveURL(/\/login$/)
  const mobile = page.getByRole('textbox', { name: '手机号' })
  const code = page.getByRole('textbox', { name: '短信验证码' })
  const getCode = page.getByRole('button', { name: '获取验证码', exact: true })
  const cooldown = page.getByRole('button', { name: /s后重发/ })
  await mobile.fill(mobileA)
  await getCode.click()
  await expect(cooldown).toBeDisabled()
  await code.fill('111111')

  await mobile.fill(mobileB)
  await expect(code).toHaveValue('')
  await expect(getCode).toBeEnabled()
  await getCode.click()
  await expect(cooldown).toBeDisabled()
  await code.fill('222222')

  await mobile.fill(mobileA)
  await expect(code).toHaveValue('')
  await expect(cooldown).toBeDisabled()
  expect(attempts).toEqual([`sms-${mobileA}`, `sms-${mobileB}`])
  await page.screenshot({ path: testInfo.outputPath('sms-login-return-to-first-number.png') })
  await code.fill('123456')
  await page.getByRole('checkbox', { name: /已经阅读并同意/ }).check()
  await page.getByRole('button', { name: '登录', exact: true }).click()

  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByText('E2E 用户', { exact: true })).toBeVisible()
  expect(attempts).toEqual([`sms-${mobileA}`, `sms-${mobileB}`, 'logout', 'oauth-start', 'sms-login'])
  expectNoUnexpectedApi(api)
})

test('密码验证成功后等待业务会话，回车不会重复提交', async ({ page }, testInfo) => {
  test.slow()
  const api = await installStrictAuthenticatedApp(page)
  const authRequests: string[] = []
  let passwordVerified = false
  let finishSession!: () => void
  const sessionResponse = new Promise<void>((resolve) => {
    finishSession = resolve
  })
  const expiredSession = { status: 401, json: { code: 10101, code_string: 'UNAUTHORIZED' } }

  await page.route('**/api/v1/auth/refresh', (route) => {
    if (!passwordVerified) return route.fulfill(expiredSession)
    return route.fulfill({ json: { code: 0, data: { expires_in: 3600 } } })
  })
  await page.route('**/api/v1/auth/session', async (route) => {
    if (!passwordVerified) return route.fulfill(expiredSession)
    authRequests.push('session')
    await sessionResponse
    return route.fallback()
  })
  await page.route('**/api/v1/auth/logout', (route) => {
    authRequests.push('logout')
    return route.fulfill({ json: { code: 0, data: null } })
  })
  await page.route('**/api/v1/auth/oauth-start?**', (route) => {
    authRequests.push('oauth-start')
    return route.fulfill({ json: { code: 0, data: { client_id: 'browser-test', return_to: '/auth/callback' } } })
  })
  await page.route('**/deepauth/api/v1/public/auth/login', (route) => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toMatchObject({ mobile: '13800000000', method: 'password' })
    authRequests.push('password-login')
    passwordVerified = true
    return route.fulfill({ json: { code: 0, data: { success: true } } })
  })
  await page.route('**/api/v1/banners?**', (route) => route.fulfill({ json: { code: 0, data: [] } }))

  await page.goto('/projects')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('tab', { name: '密码登录' }).click()
  await page.getByRole('textbox', { name: '手机号' }).fill('13800000000')
  const password = page.getByLabel('密码', { exact: true })
  await password.fill('test-password-only')
  await page.getByRole('checkbox', { name: /已经阅读并同意/ }).check()
  await page.getByRole('button', { name: '登录', exact: true }).click()

  const expectedRequests = ['logout', 'oauth-start', 'password-login', 'session']
  try {
    await expect.poll(() => authRequests).toEqual(expectedRequests)
    await expect(page).toHaveURL(/\/login$/)
    const submitting = page.getByRole('button', { name: /登录中|确认登录|确认会话/ })
    await expect(submitting).toBeDisabled()
    await password.press('Enter')
    await expect(submitting).toBeDisabled()
    expect(authRequests).toEqual(expectedRequests)
    await page.screenshot({ path: testInfo.outputPath('login-confirming-session.png') })
  } finally {
    finishSession()
  }

  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { name: '项目管理' })).toBeVisible()
  await expect(page.getByText('E2E 用户', { exact: true })).toBeVisible()
  // 返回项目页后可以重新读取会话；仍要求整个登录流程没有重复提交。
  expect(authRequests.filter((request) => request !== 'session')).toEqual(['logout', 'oauth-start', 'password-login'])
  expectNoUnexpectedApi(api)
})

test('修改密码时迟到的手机号预填不会覆盖手动输入', async ({ page }, testInfo) => {
  test.slow()
  const api = await installStrictAuthenticatedApp(page)
  const user = { id: 7, nickname: 'E2E 用户' }
  let profileReads = 0
  let finishPrefill!: () => void
  const prefillResponse = new Promise<void>((resolve) => {
    finishPrefill = resolve
  })
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ json: { code: 0, data: { expires_in: 3600 } } }),
  )
  await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/members`, (route) =>
    route.fulfill({ json: { code: 0, data: [{ user_id: user.id, role: 'owner' }] } }),
  )
  await page.route('**/api/v1/credit-requests/context', (route) =>
    route.fulfill({ json: { code: 0, data: { superior: null, workspaces: [] } } }),
  )
  await page.route('**/api/v1/me', async (route) => {
    profileReads++
    if (profileReads === 1) return route.fulfill({ json: { code: 0, data: { user } } })
    await prefillResponse
    return route.fulfill({ json: { code: 0, data: { user: { ...user, mobile: '13800000000' } } } })
  })

  await page.goto('/projects')
  const settings = page.getByRole('button', { name: '设置', exact: true })
  await expect(settings).toBeVisible({ timeout: 20_000 })
  await settings.click()
  await page.getByRole('menuitem', { name: '修改密码' }).click()

  const dialog = page.getByRole('dialog', { name: '修改密码' })
  const mobile = dialog.getByRole('textbox', { name: '手机号' })
  try {
    await expect.poll(() => profileReads).toBe(2)
    await expect(mobile).toHaveValue('')
    await mobile.fill('13900000000')
    const response = page.waitForResponse((entry) => new URL(entry.url()).pathname === '/api/v1/me')
    finishPrefill()
    await (await response).body()
    // 让浏览器先处理已返回的资料，再检查输入框的最终值。
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
    await expect(mobile).toHaveValue('13900000000')
    await dialog.screenshot({ path: testInfo.outputPath('change-password-manual-mobile.png') })
  } finally {
    finishPrefill()
  }

  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).toBeHidden()
  expect(api.seen.filter(({ method, path }) => method === 'POST' && path.startsWith('/deepauth/'))).toEqual([])
  expectNoUnexpectedApi(api)
})
