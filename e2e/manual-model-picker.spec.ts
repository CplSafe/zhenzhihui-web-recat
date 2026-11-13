import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`智能成片展示并选择 T+1 模型 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
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
              params_schema: { fields: [{ name: 'duration', type: 'integer', default: 30 }] },
            },
            {
              id: 78,
              display_name: '人工模型乙',
              provider: 'manual-video',
              enabled: true,
              operation_codes: ['video.t1'],
              params_schema: {
                fields: [
                  { name: 'duration', type: 'integer', min: 20, max: 90, default: 30 },
                  { name: 'ratio', options: ['9:16'], default: '9:16' },
                  { name: 'resolution', options: ['480p'], default: '480p' },
                ],
              },
            },
          ],
        },
      })
    })
    await page.route('**/api/v1/ai/tasks/estimate-cost', (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        model_version_id: 78,
        operation_code: 'video.t1',
        params: { duration: 60, ratio: '9:16', resolution: '480p' },
      })
      return route.fulfill({
        json: { code: 0, data: { estimated_cost: 123, balance: 1000, frozen: 0, can_afford: true } },
      })
    })
    await page.goto('/smart')
    await page.getByRole('textbox', { name: '创作需求' }).fill('产品介绍')
    const settings = page.getByRole('button', { name: '生成设置' })
    if (await settings.isVisible()) await settings.click()
    await page.getByRole('button', { name: /生成模型/ }).click()
    await expect(page.getByRole('option', { name: '精制交付 · 人工模型甲 · T+1' })).toBeVisible()
    await expect(page.getByRole('option', { name: '精制交付 · 人工模型乙 · T+1' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`model-picker-${width}.png`), animations: 'disabled' })
    await page.getByRole('option', { name: '精制交付 · 人工模型乙 · T+1' }).click()
    await expect(page.getByRole('button', { name: /生成模型，人工模型乙 · T\+1/ })).toBeVisible()
    const duration = page.getByRole('slider', { name: '视频时长' })
    await duration.focus()
    await duration.press('End')
    await expect(duration).toHaveAttribute('aria-valuetext', '60s')
    await page.screenshot({ path: testInfo.outputPath(`manual-params-${width}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '提交精制需求' }).click()
    await expect(page.getByText('123 积分（交付时结算）', { exact: true })).toBeVisible()
  })
}
