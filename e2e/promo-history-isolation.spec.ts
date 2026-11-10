import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, SECOND_TEAM_WORKSPACE_NAME } from './fixtures/strict-authenticated-app'

test('宣传片任务分页保留已有订单并隔离空间', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.route('**/api/v1/promo/config', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          enabled: false,
          entry_name: '定制宣传片',
          duration_options_seconds: [180],
          ratio_options: ['16:9'],
          resolution_options: ['1080P'],
          allowed_mime: ['image/png'],
          max_file_bytes: 10000,
          max_files: 10,
          max_total_bytes: 50000,
          footage_min_count: 1,
          authorization_text: '素材授权声明',
          acknowledgement_text: '制作须知',
          authorization_version: 'v1',
        },
      },
    }),
  )
  const offsets: number[] = []
  let pageTwoAttempts = 0
  const firstPage = [
    { id: 100, company: '空间甲订单', status: 'delivered' },
    ...Array.from({ length: 19 }, (_, i) => ({ id: 200 + i, company: `空间乙订单${i}`, status: 'delivered' })),
  ]
  await page.route('**/api/v1/ai/tasks**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/v1/ai/tasks' || url.searchParams.get('task_type') !== 'promo_t5') return route.fallback()
    const workspace = Number(url.searchParams.get('workspace_id'))
    const ids = workspace === 21 ? [100, 121] : workspace === 22 ? [200] : []
    return route.fulfill({
      json: {
        code: 0,
        data: { items: ids.map((id) => ({ order_type: 'promo_t5', promo_order_id: id })), total: ids.length },
      },
    })
  })
  await page.route('**/api/v1/promo/orders**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/121'))
      return route.fulfill({
        json: { code: 0, data: { order: { id: 121, task_id: 1001, status: 'pending' }, materials: [] } },
      })
    const offset = Number(url.searchParams.get('offset') || 0)
    offsets.push(offset)
    if (offset === 20 && ++pageTwoAttempts === 1) {
      return route.fulfill({ status: 503, json: { code: 503, message: '订单分页失败' } })
    }
    return route.fulfill({
      json: {
        code: 0,
        data: {
          items: offset === 0 ? firstPage : [{ id: 121, company: '空间甲后续订单', status: 'delivered' }],
          total: 21,
          limit: 20,
          offset,
          has_unfinished: true,
        },
      },
    })
  })
  await page.goto('/promo')
  await page.getByRole('button', { name: '展开任务管理' }).click()
  await page.getByRole('tab', { name: '宣传片', exact: true }).click()
  await expect(page.getByText('空间甲订单')).toBeVisible()
  await expect(page.getByText('空间乙订单0')).toHaveCount(0)
  await page.getByRole('button', { name: '加载更多订单' }).click()
  await expect(page.getByText(/订单分页失败/)).toBeVisible()
  await expect(page.getByText('空间甲订单')).toBeVisible()
  await expect(page.getByRole('button', { name: '加载更多订单' })).toHaveCount(0)
  await page.getByRole('tabpanel', { name: '宣传片任务' }).getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByText('空间甲后续订单')).toBeVisible()
  await expect(page.getByText('空间甲订单')).toBeVisible()
  expect(offsets).toContain(20)
  expect(pageTwoAttempts).toBe(2)
  await page.screenshot({ path: testInfo.outputPath('promo-history-page2.png'), animations: 'disabled' })
  await page.getByRole('button', { name: /E2E 用户/ }).click()
  await page
    .getByRole('dialog', { name: '用户面板' })
    .getByRole('button', { name: SECOND_TEAM_WORKSPACE_NAME, exact: true })
    .click()
  await page.goto('/promo')
  const expand = page.getByRole('button', { name: '展开任务管理' })
  if (await expand.isVisible()) await expand.click()
  await page.getByRole('tab', { name: '宣传片', exact: true }).click()
  await expect(page.getByText('空间乙订单0')).toBeVisible()
  await expect(page.getByText('空间甲订单', { exact: true })).toHaveCount(0)
  await expect(page.getByText('空间甲后续订单')).toHaveCount(0)
  await page.goto('/promo?order=121')
  await expect(page.getByText('该订单不属于当前工作空间')).toBeVisible()
})
