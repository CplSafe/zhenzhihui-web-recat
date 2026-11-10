import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`展示精制交付与宣传片入口 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
    await page.route('**/api/v1/promo/config', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            enabled: true,
            entry_name: '定制宣传片',
            duration_options_seconds: [180],
            ratio_options: ['16:9'],
            resolution_options: ['1080P'],
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
    await page.route('**/api/v1/ai/models**', (route) => {
      const query = new URL(route.request().url()).searchParams
      if (query.get('capability') !== 'video' && query.get('operation_code') !== 'video.generate')
        return route.fallback()
      return route.fulfill({
        json: {
          code: 0,
          data: [
            {
              id: 77,
              model: 'video.t1',
              display_name: '人工精制模型',
              provider: 'manual-video',
              enabled: true,
              operation_codes: ['video.generate'],
            },
          ],
        },
      })
    })
    await page.goto('/smart')
    await expect(page.getByRole('textbox', { name: '创作需求' })).toBeVisible()
    const settings = page.getByRole('button', { name: '生成设置' })
    if (await settings.isVisible()) await settings.click()
    await page.getByRole('button', { name: /生成模型/ }).click()
    await expect(page.getByRole('option', { name: /人工精制模型.*T\+1/ })).toBeVisible()
    await expect(page.getByText('定制宣传片', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`t1-entry-${width}.png`) })
    await page.goto('/promo')
    await expect(page).toHaveURL(/\/promo$/)
    await expect(page.getByRole('heading', { name: '定制宣传片' })).toBeVisible()
    await expect(page.getByRole('button', { name: '提交需求，进入制作排期' })).toBeVisible()
    await page.goto('/projects')
    await expect(page.getByRole('tab', { name: '宣传片' })).toBeVisible()
    await page.goto('/smart')
    await page.getByRole('button', { name: '展开任务管理' }).click()
    await expect(page.getByRole('tab', { name: '宣传片' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`visible-${width}.png`) })
  })
}
