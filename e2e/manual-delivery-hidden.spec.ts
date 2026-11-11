import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`隐藏 T+1 与 T+5 入口 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.addInitScript(() => localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
    await page.route('**/api/v1/ai/models**', (route) => {
      if (new URL(route.request().url()).searchParams.get('capability') !== 'video') return route.fallback()
      return route.fulfill({
        json: {
          code: 0,
          data: [
            {
              id: 77,
              display_name: '人工模型甲',
              provider: 'manual-video',
              enabled: true,
              operation_codes: ['video.t1'],
            },
          ],
        },
      })
    })
    await page.goto('/smart')
    await expect(page.getByRole('textbox', { name: '创作需求' })).toBeVisible()
    await expect(page.getByText(/T\+1|T\+5/)).toHaveCount(0)
    await expect(page.getByRole('link', { name: '定制宣传片' })).toHaveCount(0)
    const settings = page.getByRole('button', { name: '生成设置' })
    if (await settings.isVisible()) await settings.click()
    await page.getByRole('button', { name: /生成模型/ }).click()
    await expect(page.getByRole('option', { name: /T\+1/ })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`smart-${width}.png`) })
    await page.goto('/promo')
    await expect(page).not.toHaveURL(/\/promo/)
    await expect(page.getByText('提交宣传片任务（T+5）')).toHaveCount(0)
  })
}
