import { expect, test, type Page } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

async function installDeliveryData(page: Page) {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => {
    localStorage.setItem('zzh_guide_seen_smart_u7', '1')
    localStorage.setItem('zzh_guide_seen_home_u7', '1')
  })
  await page.route('**/api/v1/ai/tasks**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/ai/tasks' && url.searchParams.get('operation_code') === 'video.t1')
      return route.fulfill({
        json: {
          code: 0,
          data: {
            items: [
              {
                id: 91,
                operation_code: 'video.t1',
                status: 'succeeded',
                prompt: '精制产品短片',
                created_at: '2026-11-08T09:00:00Z',
                outputs: [{ type: 'video', url: '/tutorials/smart-create.mp4' }],
              },
              { id: 99, operation_code: 'video.generate', status: 'succeeded', prompt: '普通任务' },
            ],
            total: 2,
          },
        },
      })
    if (url.pathname === '/api/v1/ai/tasks/91')
      return route.fulfill({
        json: {
          code: 0,
          data: {
            id: 91,
            status: 'succeeded',
            operation_code: 'video.t1',
            prompt: '精制产品短片',
            poll_after_ms: 0,
            outputs: [],
          },
        },
      })
    return route.fallback()
  })
  await page.route('**/api/v1/promo/orders**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/promo/orders')
      return route.fulfill({
        json: {
          code: 0,
          data: {
            items: [
              {
                id: 31,
                task_id: 32,
                workspace_id: 21,
                company: '本空间公司',
                status: 'delivered',
                billing_status: 'settled',
                first_delivered_at: '2026-11-08',
                is_overdue: false,
                can_rework: false,
                created_at: '2026-11-08T10:00:00Z',
                delivered_material_id: 80,
              },
              { id: 41, task_id: 42, workspace_id: 22, company: '其他空间公司', status: 'pending' },
            ],
            total: 2,
          },
        },
      })
    if (url.pathname === '/api/v1/promo/orders/31')
      return route.fulfill({
        json: {
          code: 0,
          data: {
            order: {
              id: 31,
              workspace_id: 21,
              task_id: 32,
              status: 'delivered',
              billing_status: 'settled',
              first_delivered_at: '2026-11-08',
              is_overdue: false,
              can_rework: false,
            },
            materials: [],
          },
        },
      })
    return route.fallback()
  })
  await page.route('**/api/v1/promo/config', (route) =>
    route.fulfill({ json: { code: 0, data: { enabled: false, entry_name: '定制宣传片' } } }),
  )
  await page.route('**/api/v1/promo/materials/80/download', (route) =>
    route.fulfill({ json: { code: 0, data: { download_url: '/tutorials/smart-create.mp4' } } }),
  )
}

test('项目管理将真实 T+1 放在爆款成片，支持搜索和打开', async ({ page }, testInfo) => {
  await installDeliveryData(page)
  await page.goto('/projects')
  await page.getByRole('tab', { name: '爆款成片', exact: true }).click()
  const card = page.getByRole('button', { name: '打开精制任务 精制产品短片' })
  await expect(card).toBeVisible()
  await expect(card.locator('video')).toHaveAttribute('src', '/tutorials/smart-create.mp4')
  await expect
    .poll(() => card.locator('video').evaluate((video) => (video as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2)
  await expect(page.getByRole('button', { name: /普通任务/ })).toHaveCount(0)
  await page.getByPlaceholder('搜索项目名称、团队').fill('精制产品')
  await expect(card).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('project-manual.png'), animations: 'disabled' })
  await card.click()
  await expect(page).toHaveURL(/\/smart\?manualTask=91/)
  await expect(page.getByText(/任务 #91/)).toBeVisible()
})

test('项目管理展示当前空间真实 T+5 订单并打开交付', async ({ page }, testInfo) => {
  await installDeliveryData(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/projects')
  await page.getByRole('tab', { name: '宣传片', exact: true }).click()
  const heading = await page.getByRole('heading', { name: '项目管理' }).boundingBox()
  expect(heading!.width).toBeGreaterThan(70)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const card = page.getByRole('button', { name: '打开宣传片订单 本空间公司' })
  await expect(card).toBeVisible()
  await expect(card.locator('video')).toHaveAttribute('src', '/tutorials/smart-create.mp4')
  await expect
    .poll(() => card.locator('video').evaluate((video) => (video as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2)
  await expect(page.getByText('其他空间公司')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('project-promo.png'), animations: 'disabled' })
  await card.click()
  await expect(page).toHaveURL(/\/promo\?order=31/)
  await expect(page.getByRole('heading', { name: '宣传片订单 #31' })).toBeVisible()
})

test('项目列表显示进行中交付任务的倒计时', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-10T07:30:00Z'))
  await installDeliveryData(page)
  await page.route('**/api/v1/ai/tasks**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/ai/tasks' && url.searchParams.get('operation_code') === 'video.t1')
      return route.fulfill({
        json: {
          code: 0,
          data: {
            items: [
              {
                id: 91,
                operation_code: 'video.t1',
                status: 'awaiting_manual',
                prompt: '待交付精制',
                created_at: '2026-11-10T07:30:00Z',
              },
            ],
            total: 1,
          },
        },
      })
    return route.fallback()
  })
  await page.route('**/api/v1/promo/orders**', (route) => {
    if (new URL(route.request().url()).pathname === '/api/v1/promo/orders')
      return route.fulfill({
        json: {
          code: 0,
          data: {
            items: [
              {
                id: 31,
                task_id: 32,
                workspace_id: 21,
                company: '待交付宣传片',
                status: 'pending',
                created_at: '2026-11-10T07:30:00Z',
                promised_date: '2026-11-15',
                first_delivered_at: null,
                is_overdue: false,
                billing_status: 'frozen',
                can_rework: false,
              },
            ],
            total: 1,
          },
        },
      })
    return route.fallback()
  })
  await page.goto('/projects')
  await expect(page.getByRole('button', { name: '打开精制任务 待交付精制' }).getByRole('timer')).toContainText('24:00')
  await expect(page.getByRole('button', { name: '打开宣传片订单 待交付宣传片' }).getByRole('timer')).toContainText(
    '05天00',
  )
})
