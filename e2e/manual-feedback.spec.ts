import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`精制任务失败时展示平台反馈 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => {
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
      localStorage.setItem('zzh.manual.tasks.7.21', JSON.stringify([91]))
    })
    await page.route('**/api/v1/ai/tasks/91?**', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            id: 91,
            status: 'failed',
            poll_after_ms: 0,
            prompt: '测试需求',
            error_message: '素材不符合制作要求\n请联系客服',
          },
        },
      }),
    )
    await page.goto('/smart?manualTask=91')
    await expect(page.getByRole('heading', { name: '制作失败' })).toBeVisible()
    const feedback = page.getByRole('region', { name: '平台反馈' })
    await expect(feedback).toContainText('素材不符合制作要求')
    await expect(feedback).toContainText('请联系客服')
    await expect(page.getByText('任务详情', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '需要帮忙？' })).toHaveCSS('color', 'rgb(10, 156, 130)')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`feedback-${viewport.width}.png`),
      fullPage: true,
      animations: 'disabled',
    })
  })

  test(`取消精制任务后展示任务反馈 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => {
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
      localStorage.setItem('zzh.manual.tasks.7.21', JSON.stringify([91]))
    })
    await page.route('**/api/v1/ai/tasks/91?**', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: { id: 91, status: 'cancelled', prompt: '测试需求', error_message: '后台取消原因' },
        },
      }),
    )
    await page.goto('/smart?manualTask=91')
    await expect(page.getByText('任务详情', { exact: true })).toBeVisible()
    const feedback = page.getByRole('region', { name: '任务反馈' })
    await expect(feedback).toContainText('已取消当前订单')
    await expect(page.getByText('后台取消原因')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`cancelled-feedback-${viewport.width}.png`),
      fullPage: true,
      animations: 'disabled',
    })
  })
}
