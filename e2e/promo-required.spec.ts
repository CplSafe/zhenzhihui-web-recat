import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`宣传片必填项提示与非空校验 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
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
    const names = ['单位 / 公司名称', '联系人', '联系电话', '制作需求']
    for (const name of names) {
      await expect(page.getByLabel(name, { exact: true })).toHaveAttribute('required', '')
      await expect(page.locator('label').filter({ has: page.getByLabel(name, { exact: true }) })).toContainText('*')
    }
    await page.getByLabel('单位 / 公司名称', { exact: true }).fill('   ')
    await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
    for (const name of names) {
      await expect(page.getByLabel(name, { exact: true })).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByText(`请填写${name}`, { exact: true })).toBeVisible()
    }
    await expect(page.getByLabel(names[0], { exact: true })).toBeFocused()
    await page.screenshot({
      path: testInfo.outputPath(`promo-required-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    })
    for (const name of names) {
      await page.getByLabel(name, { exact: true }).fill('测试内容')
      await expect(page.getByLabel(name, { exact: true })).toHaveAttribute('aria-invalid', 'false')
      await expect(page.getByText(`请填写${name}`, { exact: true })).toHaveCount(0)
    }
    await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
    await expect(page.getByRole('heading', { name: '上传素材' })).toBeVisible()
  })
}
