import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

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
  await page.route('**/api/v1/auth/oauth-start?**', (route) =>
    route.fulfill({ json: { code: 0, data: { client_id: 'browser-test', return_to: '/auth/callback' } } }),
  )
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
  await code.fill('654321')
  await expect(submit).toBeEnabled()
  expect(registrations).toEqual([])
  await submit.click()
  await expect(dialog.getByText('验证码错误')).toBeVisible()
  expect(smsMobiles).toEqual(['13800000000', '13800000000', '13900000000'])
  expect(registrations).toEqual([
    expect.objectContaining({ mobile: '13900000000', sms_code: '654321', terms_accepted: true }),
  ])
  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).toBeHidden()
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
  await page.goto('/projects')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('tab', { name: '密码登录' }).click()
  await page.getByRole('textbox', { name: '手机号' }).fill('13800000000')
  await page.getByLabel('密码', { exact: true }).fill('test-password-only')
  await page.getByRole('checkbox', { name: '记住账号' }).check()
  await page.getByRole('checkbox', { name: /已经阅读并同意/ }).check()
  await page.screenshot({ path: testInfo.outputPath('remembered-account-login.png') })
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { name: '项目管理' })).toBeVisible()
  await expect(page.getByText('页面加载失败', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('zzh_remembered_login_account'))).toBe('13800000000')
  expect(loginPosts).toBe(1)
  expect(pageErrors).toEqual([])
  expectNoUnexpectedApi(api)
})
