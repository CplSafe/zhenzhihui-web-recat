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
