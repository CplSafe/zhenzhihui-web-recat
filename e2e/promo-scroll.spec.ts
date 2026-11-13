import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 390, height: 667 },
]) {
  test(`宣传片需求表单可滚动到底部 ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/promo/config', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            enabled: true,
            entry_name: '定制宣传片',
            duration_options_seconds: [60],
            ratio_options: ['16:9'],
            resolution_options: ['720P'],
            allowed_mime: ['image/png'],
            max_file_bytes: 10000,
            max_files: 10,
            max_total_bytes: 50000,
            footage_min_count: 1,
            offline_fallback: true,
            price_show: true,
            manual_quote_required: false,
            service_tel: '10000',
            authorization_text: '素材授权声明',
            acknowledgement_text: '制作须知',
            authorization_version: 'v1',
          },
        },
      }),
    )
    await page.route('**/api/v1/promo/intakes', (route) =>
      route.fulfill({ json: { code: 0, data: { token: 'intake-1' } } }),
    )
    await page.goto('/promo')
    await page.getByRole('button', { name: '提交需求，进入制作排期' }).click()
    await expect(page.getByRole('heading', { name: '定制宣传片 · 需求填写' })).toBeVisible()
    const workspace = page.locator('[data-promo-real] main').locator('..')
    const next = page.getByRole('button', { name: '下一步：上传素材 →' })
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await page.mouse.wheel(0, 2000)
    await expect.poll(() => workspace.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect(next).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath(`promo-scroll-${viewport.width}.png`), animations: 'disabled' })
  })
}
