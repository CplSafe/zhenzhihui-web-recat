import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`通知列表可滚动至最早一条 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 700 })
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => {
      localStorage.setItem('zzh_guide_seen_home_u7', '1')
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
    })
    await page.route('**/api/v1/ai/tasks**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/v1/ai/tasks/1')
        return route.fulfill({ json: { code: 0, data: { id: 1, operation_code: 'video.t1', status: 'succeeded' } } })
      if (url.pathname !== '/api/v1/ai/tasks' || url.searchParams.get('operation_code') !== 'video.t1')
        return route.fallback()
      return route.fulfill({
        json: {
          code: 0,
          data: {
            items: Array.from({ length: 12 }, (_, index) => ({
              id: index + 1,
              operation_code: 'video.t1',
              status: 'succeeded',
              created_at: `2026-11-${String(index + 1).padStart(2, '0')}T09:00:00Z`,
            })),
            total: 12,
          },
        },
      })
    })
    await page.goto('/home')
    await page.getByRole('button', { name: /^通知/ }).click()
    const panel = page.getByRole('dialog', { name: '通知列表' })
    const last = panel.getByRole('button', { name: /T\+1 精制任务 #1：已交付/ })
    await expect(last).toHaveCount(1)
    const list = panel.locator('.notify__list')
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect
      .poll(async () =>
        last.evaluate((element) => {
          const item = element.getBoundingClientRect()
          const container = element.closest('.notify__panel')!.getBoundingClientRect()
          return item.bottom <= container.bottom && item.top >= container.top
        }),
      )
      .toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`notification-bottom-${width}.png`), animations: 'disabled' })
    await last.click()
    await expect(panel.getByRole('heading', { name: 'T+1 精制任务 #1' })).toBeVisible()
  })
}
