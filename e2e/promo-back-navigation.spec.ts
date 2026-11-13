import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`宣传片各步骤返回并保留草稿与素材 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
    let intakeCount = 0
    let quoteCount = 0
    let orderCount = 0
    await page.route('**/api/v1/promo/**', (route) => {
      const path = new URL(route.request().url()).pathname
      const method = route.request().method()
      let data: unknown
      if (path.endsWith('/config'))
        data = {
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
        }
      else if (path.endsWith('/intakes') && method === 'POST') {
        intakeCount++
        data = { token: 'intake-1' }
      } else if (path.endsWith('/uploads'))
        data = {
          material: {
            id: 5,
            role: 'footage',
            status: 'pending',
            name: '素材.png',
            size_bytes: 3,
            mime_type: 'image/png',
          },
          url: 'https://bucket.aliyuncs.com/upload',
          form_fields: { key: 'sample' },
        }
      else if (path.endsWith('/materials/5/complete'))
        data = { id: 5, role: 'footage', status: 'active', name: '素材.png', size_bytes: 3, mime_type: 'image/png' }
      else if (path.endsWith('/quote')) {
        quoteCount++
        data = { base_cost: 100, service_cost: 50, total_cost: 150, config_hash: 'hash1', promised_date: '2026-11-15' }
      } else if (path.endsWith('/orders') && method === 'POST') {
        orderCount++
        data = { id: 31, task_id: 32 }
      } else return route.fallback()
      return route.fulfill({ json: { code: 0, data } })
    })
    await page.route('https://bucket.aliyuncs.com/upload', (route) =>
      route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }),
    )
    await page.goto('/promo')
    const begin = page.getByRole('button', { name: '提交需求，进入制作排期' })
    await begin.click()
    const formHeading = page.getByRole('heading', { name: '定制宣传片 · 需求填写' })
    await expect(formHeading).toBeVisible()
    await page.getByLabel('单位 / 公司名称').fill('测试公司')
    await page.getByRole('button', { name: '上一步', exact: true }).click()
    await expect(begin).toBeVisible()
    await expect(formHeading).toHaveCount(0)
    await begin.click()
    await expect(page.getByLabel('单位 / 公司名称')).toHaveValue('测试公司')
    await page.getByLabel('联系人', { exact: true }).fill('李先生')
    await page.getByLabel('联系电话').fill('13800000000')
    await page.getByLabel('制作需求', { exact: true }).fill('介绍产品')
    await page.screenshot({ path: testInfo.outputPath(`form-back-${width}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
    await page
      .getByLabel('上传实拍素材')
      .setInputFiles({ name: '素材.png', mimeType: 'image/png', buffer: Buffer.from('abc') })
    await expect(page.getByText(/素材.png · 已就绪/)).toBeVisible()
    await page.getByLabel('素材授权声明').check()
    await page.getByRole('button', { name: '下一步：确认并提交' }).click()
    await expect(page.getByText('150 积分', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '上一步', exact: true }).click()
    await expect(page.getByText(/素材.png · 已就绪/)).toBeVisible()
    await page.getByRole('button', { name: '上一步', exact: true }).click()
    await expect(page.getByLabel('制作需求', { exact: true })).toHaveValue('介绍产品')
    await page.getByRole('button', { name: '上一步', exact: true }).click()
    await begin.click()
    await expect(page.getByLabel('制作需求', { exact: true })).toHaveValue('介绍产品')
    await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
    await expect(page.getByText(/素材.png · 已就绪/)).toBeVisible()
    await expect(page.getByLabel('素材授权声明')).toBeChecked()
    await page.getByRole('button', { name: '下一步：确认并提交' }).click()
    await expect(page.getByText('150 积分', { exact: true })).toBeVisible()
    expect(intakeCount).toBe(1)
    expect(quoteCount).toBe(2)
    expect(orderCount).toBe(0)
    expect(api.paidTaskSubmissions).toBe(0)
  })
}
