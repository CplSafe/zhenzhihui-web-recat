import { expect, test } from '@playwright/test'

const emptyApiResponse = JSON.stringify({
  data: [],
  items: [],
  list: [],
  records: [],
  total: 0,
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    ;(window as Window & { __zzh_dev_logout__?: boolean }).__zzh_dev_logout__ = true
  })

  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: emptyApiResponse,
      })
    },
  )
})

test('公开首页在无真实后端和登录态时可访问', async ({ page }) => {
  // WebKit 与多个浏览器 worker 并行冷启动时，主包下载/解析偶尔会耗尽
  // 默认 30 秒总预算；断言仍保留全局 10 秒上限，只放宽冷启动用例。
  test.slow()
  await page.goto('/home')

  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { name: '快捷入口' })).toBeVisible()
  await expect(page.getByRole('button', { name: '智能成片 输入灵感，秒出大片', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '模板库', exact: true })).toBeVisible()
})

test('未知路由回落到公开首页', async ({ page }) => {
  await page.goto('/route-that-does-not-exist?from=e2e')

  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { name: '快捷入口' })).toBeVisible()
})

test('直接访问或中断在空间切换桥时可恢复到首页', async ({ page }) => {
  await page.goto('/workspace-switch')

  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { name: '快捷入口' })).toBeVisible()
})
