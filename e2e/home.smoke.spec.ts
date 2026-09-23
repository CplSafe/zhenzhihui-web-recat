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

test('旧首页地址在无真实后端和登录态时落到爆款复刻', async ({ page }) => {
  // WebKit 与多个浏览器 worker 并行冷启动时，主包下载/解析偶尔会耗尽
  // 默认 30 秒总预算；断言仍保留全局 10 秒上限，只放宽冷启动用例。
  test.slow()
  await page.goto('/home')

  await expect(page).toHaveURL(/\/hot-copy$/)
  await expect(page.getByRole('heading', { name: '爆款作业直接抄,你的产品当主角!' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '模板库' })).toBeVisible()
  await expect(page.getByRole('button', { name: '供需商单' })).toBeVisible()
})

test('供需商单展示「我要发单」与「我要接单」两个标签，发单在前且默认选中', async ({ page }) => {
  await page.goto('/market')

  // 页面不再显示「供需商单」大标题
  await expect(page.getByRole('heading', { name: '供需商单' })).toHaveCount(0)
  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveText(['我要发单', '我要接单'])
  await expect(page.getByRole('tab', { name: '我要发单' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: '发布需求' })).toBeVisible()
  await page.getByRole('tab', { name: '我要接单' }).click()
  await expect(page.getByRole('tab', { name: '我要接单' })).toHaveAttribute('aria-selected', 'true')
})

test('未知路由回落到爆款复刻', async ({ page }) => {
  await page.goto('/route-that-does-not-exist?from=e2e')

  await expect(page).toHaveURL(/\/hot-copy$/)
  await expect(page.getByRole('heading', { name: '爆款作业直接抄,你的产品当主角!' })).toBeVisible()
})

test('直接访问或中断在空间切换桥时可恢复到爆款复刻', async ({ page }) => {
  await page.goto('/workspace-switch')

  await expect(page).toHaveURL(/\/hot-copy$/)
  await expect(page.getByRole('heading', { name: '爆款作业直接抄,你的产品当主角!' })).toBeVisible()
})
