import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`展示 T+1 和 T+5 入口 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
    await page.route('**/api/v1/promo/config', (route) =>
      route.fulfill({ json: { code: 0, data: { enabled: false, entry_name: '定制宣传片' } } }),
    )
    await page.route('**/api/v1/ai/models**', (route) => {
      if (new URL(route.request().url()).searchParams.get('capability') !== 'video') return route.fallback()
      return route.fulfill({
        json: {
          code: 0,
          data: [{ id: 77, provider: 'manual-video', enabled: true, operation_codes: ['video.t1'] }],
        },
      })
    })
    await page.goto('/smart')
    await expect(page.getByRole('textbox', { name: '创作需求' })).toBeVisible()
    const settings = page.getByRole('button', { name: '生成设置' })
    if (await settings.isVisible()) await settings.click()
    await page.getByRole('button', { name: /生成模型/ }).click()
    await expect(page.getByRole('button', { name: /精制交付 · T\+1/ })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`t1-entry-${width}.png`) })
    await page.goto('/promo')
    await expect(page).toHaveURL(/\/promo$/)
    await expect(page.getByRole('heading', { name: '定制宣传片' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`promo-entry-${width}.png`) })
    await page.goto('/projects')
    await expect(page.getByRole('tab', { name: '宣传片' })).toBeVisible()
  })
}
