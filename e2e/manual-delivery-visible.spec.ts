import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`隐藏精制交付与宣传片入口 ${width}px`, async ({ page }, testInfo) => {
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
    await expect(page.getByRole('option', { name: /T\+1/ })).toHaveCount(0)
    await expect(page.getByText('定制宣传片', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`t1-entry-${width}.png`) })
    await page.goto('/promo')
    await expect(page).toHaveURL(/\/hot-copy$/)
    await page.goto('/projects')
    await expect(page.getByRole('tab', { name: '宣传片' })).toHaveCount(0)
    await expect(page.getByText(/T\+1|T\+5|精制交付/)).toHaveCount(0)
    await page.goto('/smart')
    await page.getByRole('button', { name: '展开任务管理' }).click()
    await expect(page.getByRole('tab', { name: '宣传片' })).toHaveCount(0)
    await expect(page.getByText(/T\+1|T\+5|精制交付/)).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`hidden-${width}.png`) })
  })
}

test('隐藏交付通知并停止请求交付列表', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  let deliveryRequests = 0
  await page.route('**/api/v1/ai/tasks**', (route) => {
    if (new URL(route.request().url()).searchParams.get('operation_code') === 'video.t1') deliveryRequests++
    return route.fallback()
  })
  await page.route('**/api/v1/promo/orders**', (route) => {
    deliveryRequests++
    return route.fulfill({ json: { code: 0, data: { items: [], total: 0 } } })
  })
  await page.goto('/home')
  await page.getByRole('button', { name: /^通知/ }).click()
  const panel = page.getByRole('dialog', { name: '通知列表' })
  await expect(panel.getByText(/T\+1|T\+5/)).toHaveCount(0)
  await expect(panel.getByText('暂无通知')).toBeVisible()
  expect(deliveryRequests).toBe(0)
})
