import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('真实宣传片订单详情、免费修改及退款条件使用后端状态', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page)
  let status = 'delivered'
  let reworkCount = 0
  const order = () => ({
    id: 10,
    workspace_id: 21,
    task_id: 11,
    status,
    billing_status: status === 'overdue' ? 'frozen' : 'settled',
    promised_date: '2026-11-10',
    is_overdue: status === 'overdue',
    first_delivered_at: status === 'overdue' ? null : '2026-11-04T00:00:00+08:00',
    can_rework: status === 'delivered',
    delivered_material_id: status === 'delivered' ? 42 : null,
    rework_status: status === 'reworking' ? 'requested' : null,
  })
  await page.route('**/api/v1/promo/orders**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/rework')) {
      expect(route.request().postDataJSON()).toEqual({ text: '调整片尾' })
      reworkCount += 1
      status = 'reworking'
      await route.fulfill({ json: { code: 0, data: {} } })
    } else if (path.endsWith('/refund')) {
      expect(route.request().postDataJSON()).toEqual({ confirmed: true })
      status = 'cancelled'
      await route.fulfill({ json: { code: 0, data: {} } })
    } else if (path.endsWith('/10')) {
      await route.fulfill({ json: { code: 0, data: { order: order(), materials: [] } } })
    } else {
      await route.fulfill({
        json: { code: 0, data: { items: [order()], total: 1, limit: 20, offset: 0, has_unfinished: false } },
      })
    }
  })
  await page.route('**/api/v1/promo/materials/42/download', (route) =>
    route.fulfill({ json: { code: 0, data: { download_url: '/tutorials/smart-create.mp4' } } }),
  )
  await page.goto('/promo')
  await page.getByRole('button', { name: '查看我的订单' }).click()
  await page.getByRole('button', { name: /订单 #10/ }).click()
  await expect(page.getByText('2026-11-10')).toBeVisible()
  await expect(page.getByLabel('宣传片成片')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('promo-delivery.png'), fullPage: true, animations: 'disabled' })
  await expect(page.getByRole('button', { name: '申请退回积分' })).toHaveCount(0)
  await page.getByLabel('修改意见').fill('调整片尾')
  await page.getByRole('button', { name: '申请免费修改' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确\s*认/ })
    .click()
  await expect(page.getByText('待受理')).toBeVisible()
  expect(reworkCount).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('promo-orders-rework.png'), fullPage: true })
  await page.getByRole('button', { name: '返回订单列表' }).click()
  status = 'overdue'
  await page.getByRole('button', { name: /订单 #10/ }).click()
  await page.getByRole('button', { name: '申请退回积分' }).click()
  await expect(page.getByRole('dialog')).toContainText('全额退回积分并终止制作')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确\s*认/ })
    .click()
  await expect(page.getByText('已取消', { exact: true })).toBeVisible()
})
