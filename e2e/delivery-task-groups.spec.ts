import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`交付任务按制作和交付状态分类 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
    let delivered = false
    await page.route('**/api/v1/ai/tasks**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname !== '/api/v1/ai/tasks' || url.searchParams.get('operation_code') !== 'video.t1')
        return route.fallback()
      return route.fulfill({
        json: {
          code: 0,
          data: {
            items: [
              {
                id: 91,
                operation_code: 'video.t1',
                status: delivered ? 'succeeded' : 'awaiting_manual',
                prompt: 'T1 测试任务',
                outputs: delivered ? [{ type: 'video', url: '/tutorials/smart-create.mp4' }] : [],
              },
            ],
            total: 1,
          },
        },
      })
    })
    await page.route('**/api/v1/promo/orders**', (route) => {
      if (new URL(route.request().url()).pathname !== '/api/v1/promo/orders') return route.fallback()
      return route.fulfill({
        json: {
          code: 0,
          data: {
            items: [
              {
                id: 31,
                workspace_id: 21,
                company: 'T5 测试订单',
                status: delivered ? 'delivered' : 'producing',
                first_delivered_at: delivered ? '2026-11-10' : null,
              },
            ],
            total: 1,
          },
        },
      })
    })
    await page.goto('/smart')
    await page.getByRole('button', { name: '展开任务管理' }).click()
    await page.getByRole('tab', { name: '正在生成', exact: true }).click()
    let panel = page.getByRole('tabpanel', { name: '正在生成任务' })
    await expect(panel.getByText('T1 测试任务')).toBeVisible()
    await expect(panel.getByText('T5 测试订单')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`active-${width}.png`), animations: 'disabled' })
    await page.getByRole('tab', { name: '爆款成片', exact: true }).click()
    await expect(page.getByRole('tabpanel', { name: '爆款成片任务' }).getByText('T1 测试任务')).toHaveCount(0)
    await page.getByRole('tab', { name: '宣传片', exact: true }).click()
    await expect(page.getByRole('tabpanel', { name: '宣传片任务' }).getByText('T5 测试订单')).toHaveCount(0)
    delivered = true
    await page.getByRole('tab', { name: '正在生成', exact: true }).click()
    panel = page.getByRole('tabpanel', { name: '正在生成任务' })
    await expect(panel.getByText('T1 测试任务')).toHaveCount(0)
    await expect(panel.getByText('T5 测试订单')).toHaveCount(0)
    await page.getByRole('tab', { name: '爆款成片', exact: true }).click()
    await expect(page.getByRole('tabpanel', { name: '爆款成片任务' }).getByText('T1 测试任务')).toBeVisible()
    await page.getByRole('tab', { name: '宣传片', exact: true }).click()
    await expect(page.getByRole('tabpanel', { name: '宣传片任务' }).getByText('T5 测试订单')).toBeVisible()
  })
}
