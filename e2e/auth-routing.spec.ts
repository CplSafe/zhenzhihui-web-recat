import { expect, test } from '@playwright/test'

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
    await expect(page.getByRole('heading', { name: '想打造什么样的爆款短视频？' })).toBeVisible()

    await page.goto('/hot-copy')
    await expect(page).toHaveURL(/\/hot-copy$/)
    await expect(page.getByRole('heading', { name: '爆款作业直接抄,你的产品当主角!' })).toBeVisible()
  })
})
