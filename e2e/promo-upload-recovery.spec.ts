import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

const config = {
  enabled: true,
  entry_name: '定制宣传片',
  duration_options_seconds: [60],
  ratio_options: ['16:9'],
  resolution_options: ['720P'],
  allowed_mime: ['image/png', 'video/mp4'],
  max_file_bytes: 10000,
  max_total_bytes: 50000,
  max_files: 10,
  footage_min_count: 1,
  offline_fallback: true,
  price_show: false,
  manual_quote_required: false,
  service_tel: '10000',
  authorization_text: '素材授权声明',
  acknowledgement_text: '制作须知',
  authorization_version: 'v1',
}

for (const file of [
  { name: '视频.mp4', mimeType: 'video/mp4' },
  { name: '图片.png', mimeType: 'image/png' },
]) {
  test(`恢复未完成素材后处理确认冲突并重新上传：${file.name}`, async ({ page }, testInfo) => {
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => {
      localStorage.setItem('zzh.promo.intake.7.21', 'saved-intake')
      localStorage.setItem(
        'zzh.promo.draft.7.21',
        JSON.stringify({ company: '测试公司', contact: '测试', phone: '13800000000', brief: '测试需求' }),
      )
    })
    const material = {
      id: 35,
      role: 'footage',
      status: 'pending',
      name: file.name,
      size_bytes: 3,
      mime_type: file.mimeType,
    }
    let uploads = 0
    let creates = 0
    let deletes = 0
    let confirmations = 0
    await page.route('**/api/v1/promo/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/config')) return route.fulfill({ json: { code: 0, data: config } })
      if (path.endsWith('/intakes/saved-intake'))
        return route.fulfill({ json: { code: 0, data: { intake: {}, materials: [material] } } })
      if (path.endsWith('/uploads')) {
        creates++
        return route.fulfill({
          json: {
            code: 0,
            data: {
              material: { ...material, id: 36 },
              url: 'https://bucket.aliyuncs.com/upload',
              form_fields: { key: 'test' },
              expires_at: '2027-01-01',
            },
          },
        })
      }
      if (path.endsWith('/materials/35/complete')) {
        confirmations++
        return route.fulfill({
          status: 409,
          json: { code: 10409, code_string: 'PROMO_STATE_CONFLICT', message: '宣传片订单状态已变化，请刷新后重试' },
        })
      }
      if (path.endsWith('/materials/36/complete')) {
        confirmations++
        return route.fulfill({ json: { code: 0, data: { ...material, id: 36, status: 'active' } } })
      }
      if (path.endsWith('/materials/35') && route.request().method() === 'DELETE') {
        deletes++
        return route.fulfill({ json: { code: 0, data: {} } })
      }
      return route.fallback()
    })
    await page.route('https://bucket.aliyuncs.com/upload', (route) => {
      uploads++
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    })
    await page.goto('/promo')
    await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
    await expect(page.getByText(`${file.name} · 未完成，上传状态未知`, { exact: false })).toBeVisible()
    await page.getByRole('button', { name: '重试确认' }).click()
    await expect(page.getByText(/素材确认失败，状态可能已变化/)).toBeVisible()
    expect(uploads).toBe(0)
    await page.screenshot({ path: testInfo.outputPath('conflict.png'), animations: 'disabled' })
    await page
      .getByText('选择原文件重试')
      .locator('input')
      .setInputFiles({ ...file, buffer: Buffer.from('abc') })
    await expect(page.getByText(`${file.name} · 已就绪`, { exact: false })).toBeVisible()
    await expect(page.getByText(`${file.name} · 未完成`, { exact: false })).toHaveCount(0)
    expect(creates).toBe(1)
    expect(deletes).toBe(1)
    expect(uploads).toBe(1)
    expect(confirmations).toBe(2)
  })
}

test('确认冲突后服务端已完成时恢复已就绪，避免重复上传', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => {
    localStorage.setItem('zzh.promo.intake.7.21', 'saved-intake')
    localStorage.setItem(
      'zzh.promo.draft.7.21',
      JSON.stringify({ company: '测试公司', contact: '测试', phone: '13800000000', brief: '测试需求' }),
    )
  })
  let reads = 0
  let confirmations = 0
  await page.route('**/api/v1/promo/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/config')) return route.fulfill({ json: { code: 0, data: config } })
    if (path.endsWith('/intakes/saved-intake')) {
      reads++
      return route.fulfill({
        json: {
          code: 0,
          data: {
            intake: {},
            materials: [{ id: 35, role: 'footage', status: reads === 1 ? 'pending' : 'active', name: '视频.mp4' }],
          },
        },
      })
    }
    if (path.endsWith('/materials/35/complete')) {
      confirmations++
      return route.fulfill({ status: 409, json: { code: 10409, message: '状态冲突' } })
    }
    return route.fallback()
  })
  await page.goto('/promo')
  await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
  await page.getByRole('button', { name: '重试确认' }).click()
  await expect(page.getByText(/视频.mp4 · 已就绪/)).toBeVisible()
  expect(reads).toBe(2)
  expect(confirmations).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('confirmed.png'), animations: 'disabled' })
})

for (const outcome of ['success', 'upload-fail', 'delete-fail', 'old-active'] as const) {
  test(`替换未完成视频：${outcome}`, async ({ page }, testInfo) => {
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => {
      localStorage.setItem('zzh.promo.intake.7.21', 'saved-intake')
      localStorage.setItem(
        'zzh.promo.draft.7.21',
        JSON.stringify({ company: '测试公司', contact: '测试', phone: '13800000000', brief: '测试需求' }),
      )
    })
    const original = {
      id: 35,
      role: 'footage',
      status: 'pending',
      name: '视频.mp4',
      size_bytes: 3,
      mime_type: 'video/mp4',
    }
    const replacement = { ...original, id: 36 }
    let confirmed = false
    let deletes = 0
    await page.route('**/api/v1/promo/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/config')) return route.fulfill({ json: { code: 0, data: config } })
      if (path.endsWith('/intakes/saved-intake'))
        return route.fulfill({
          json: {
            code: 0,
            data: {
              intake: {},
              materials: [{ ...original, status: confirmed && outcome === 'old-active' ? 'active' : 'pending' }],
            },
          },
        })
      if (path.endsWith('/uploads'))
        return route.fulfill({
          json: {
            code: 0,
            data: {
              material: replacement,
              url: 'https://bucket.aliyuncs.com/upload',
              form_fields: {},
              expires_at: '2027-01-01',
            },
          },
        })
      if (path.endsWith('/materials/36/complete')) {
        confirmed = true
        return route.fulfill({ json: { code: 0, data: { ...replacement, status: 'active' } } })
      }
      if (path.endsWith('/materials/35') && route.request().method() === 'DELETE') {
        expect(confirmed).toBe(true)
        deletes++
        if (outcome === 'delete-fail') return route.fulfill({ status: 500, json: { code: 500, message: '删除失败' } })
        return route.fulfill({ json: { code: 0, data: {} } })
      }
      return route.fallback()
    })
    await page.route('https://bucket.aliyuncs.com/upload', (route) =>
      route.fulfill({ status: outcome === 'upload-fail' ? 500 : 204, headers: { 'access-control-allow-origin': '*' } }),
    )
    await page.goto('/promo')
    await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
    await page
      .getByLabel('选择原文件重试 视频.mp4')
      .setInputFiles({ name: '视频.mp4', mimeType: 'video/mp4', buffer: Buffer.from('abc') })
    if (outcome === 'success') {
      await expect(page.getByText(/视频.mp4 · 已就绪/)).toBeVisible()
      await expect(page.getByText(/视频.mp4 · 未完成/)).toHaveCount(0)
      expect(deletes).toBe(1)
    } else if (outcome === 'upload-fail') {
      await expect(page.getByText(/视频.mp4 · 上传失败/)).toBeVisible()
      await expect(page.getByText(/视频.mp4 · 未完成/)).toBeVisible()
      expect(deletes).toBe(0)
    } else if (outcome === 'delete-fail') {
      await expect(page.getByText(/新素材已上传，但旧素材未能清理/)).toBeVisible()
      await expect(page.getByText(/视频.mp4 · 未完成/)).toBeVisible()
      expect(deletes).toBe(1)
    } else {
      await expect(page.getByText(/原素材也已就绪/)).toBeVisible()
      await expect(page.getByText(/视频.mp4 · 已就绪/)).toHaveCount(2)
      expect(deletes).toBe(0)
    }
    await page.screenshot({ path: testInfo.outputPath('replacement.png'), animations: 'disabled' })
  })
}
