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
    await expect(page.getByRole('button', { name: '下一步：上传素材 →' })).toBeDisabled()
    await page.screenshot({
      path: testInfo.outputPath(`promo-required-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    })
    for (const name of names.filter((name) => name !== '联系电话')) {
      await page.getByLabel(name, { exact: true }).fill('测试内容')
    }
    const phone = page.getByLabel('联系电话', { exact: true })
    const next = page.getByRole('button', { name: '下一步：上传素材 →' })
    await phone.fill('水电费收到')
    await expect(phone).toHaveAttribute('aria-invalid', 'true')
    await next.click()
    await expect(page.getByRole('heading', { name: '定制宣传片 · 需求填写' })).toBeVisible()
    await expect(phone).toBeFocused()
    await phone.fill('13800000000')
    await expect(phone).toHaveAttribute('aria-invalid', 'false')
    const reference = page.getByLabel('参考链接（选填）')
    await reference.fill('不是链接')
    await next.click()
    await expect(reference).toBeFocused()
    await expect(reference).toHaveAttribute('aria-invalid', 'true')
    await reference.fill('https://example.com/video')
    await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
    await expect(page.getByRole('heading', { name: '上传素材' })).toBeVisible()
  })
}

test('恢复的旧草稿参考链接无效时可定位修正，避免提交请求', async ({ page }) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => {
    localStorage.setItem(
      'zzh.promo.draft.7.21',
      JSON.stringify({
        company: '测试公司',
        contact: '测试',
        phone: '13800000000',
        brief: '宣传需求',
        reference_url: '旧草稿错误内容',
      }),
    )
  })
  let orderRequests = 0
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
  await page.route('**/api/v1/promo/orders', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    orderRequests++
    return route.fulfill({ status: 400 })
  })
  await page.goto('/promo')
  await page.getByRole('button', { name: '提交需求，进入制作排期' }).click()
  const reference = page.getByLabel('参考链接（选填）')
  await expect(reference).toHaveValue('旧草稿错误内容')
  await expect(reference).toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
  await expect(reference).toBeFocused()
  expect(orderRequests).toBe(0)
  await reference.clear()
  await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
  await expect(page.getByRole('heading', { name: '上传素材' })).toBeVisible()
})
