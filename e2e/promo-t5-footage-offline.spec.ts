import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

const baseConfig = {
  enabled: true,
  entry_name: '定制宣传片',
  duration_options_seconds: [180],
  ratio_options: ['16:9'],
  resolution_options: ['1080P'],
  allowed_mime: ['image/png'],
  max_file_bytes: 10000,
  max_files: 10,
  max_total_bytes: 50000,
  footage_min_count: 3,
  offline_fallback: true,
  price_show: true,
  manual_quote_required: false,
  service_tel: '10000',
  authorization_text: '素材授权声明',
  acknowledgement_text: '制作须知',
  authorization_version: 'v1',
}

type Capture = { quotes: string[]; offline: string[]; orders: string[] }

async function mockPromo(page: Parameters<typeof installStrictAuthenticatedApp>[0]) {
  const capture: Capture = { quotes: [], offline: [], orders: [] }
  let materialId = 4

  await page.route('**/api/v1/promo/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    let data: unknown = {}
    if (path.endsWith('/config')) data = baseConfig
    else if (path.endsWith('/intakes') && method === 'POST') data = { token: 'intake-1' }
    else if (path.endsWith('/uploads')) {
      materialId += 1
      data = {
        material: {
          id: materialId,
          role: 'footage',
          status: 'pending',
          name: '素材.png',
          size_bytes: 3,
          mime_type: 'image/png',
        },
        url: 'https://bucket.aliyuncs.com/upload',
        form_fields: { key: 'sample' },
        expires_at: '2027-01-01',
      }
    } else if (/\/materials\/\d+\/complete$/.test(path)) {
      const id = Number(path.split('/').slice(-2)[0])
      data = { id, role: 'footage', status: 'active', name: '素材.png', size_bytes: 3, mime_type: 'image/png' }
    } else if (path.endsWith('/offline')) {
      capture.offline.push(route.request().postData() || '')
      data = { offline: true }
    } else if (path.endsWith('/quote')) {
      capture.quotes.push(route.request().postData() || '')
      data = { base_cost: 100, service_cost: 50, total_cost: 150, config_hash: 'hash1', promised_date: '2026-11-15' }
    } else if (path.endsWith('/orders') && method === 'POST') {
      capture.orders.push(route.request().postData() || '')
      data = { id: 41, task_id: 42 }
    } else return route.fallback()
    await route.fulfill({ json: { code: 0, data } })
  })
  await page.route('https://bucket.aliyuncs.com/upload', async (route) => {
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  })
  return capture
}

async function openMaterialStage(page: Parameters<typeof installStrictAuthenticatedApp>[0]) {
  await page.goto('/promo')
  await page.getByRole('button', { name: '提交需求，进入制作排期' }).click()
  await page.getByLabel('单位 / 公司名称').fill('测试公司')
  await page.getByLabel('联系人', { exact: true }).fill('李先生')
  await page.getByLabel('联系电话').fill('13800000000')
  await page.getByLabel('制作需求', { exact: true }).fill('介绍产品')
  await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
}

async function uploadFootage(page: Parameters<typeof installStrictAuthenticatedApp>[0]) {
  await page
    .getByLabel('上传实拍素材')
    .setInputFiles({ name: '素材.png', mimeType: 'image/png', buffer: Buffer.from('abc') })
  await expect(page.getByText(/素材\.png · 已就绪/)).toBeVisible()
}

test('实拍素材少于最少条数时阻断报价并明确提示', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const capture = await mockPromo(page)
  await openMaterialStage(page)

  await expect(page.getByText(/至少 3 条图片或视频/).first()).toBeVisible()
  await uploadFootage(page)
  await page.getByLabel('素材授权声明').check()
  await page.getByLabel('制作须知').check()
  await expect(page.getByRole('button', { name: '下一步：确认并提交' })).toBeDisabled()
  expect(capture.quotes).toHaveLength(0)
  expect(capture.orders).toHaveLength(0)
  await page.screenshot({
    path: testInfo.outputPath('promo-footage-min-blocked.png'),
    fullPage: true,
    animations: 'disabled',
  })
})

test('可登记线下交接，登记后不再受实拍最少条数阻断', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const capture = await mockPromo(page)
  await openMaterialStage(page)

  await uploadFootage(page)
  await page.getByRole('button', { name: '素材我线下交给顾问' }).click()
  await expect(page.getByText('已登记线下交接，具体交付日期以报价为准。')).toBeVisible()
  expect(capture.offline).toHaveLength(1)
  await page
    .getByRole('button', { name: '素材我线下交给顾问' })
    .isVisible()
    .catch(() => false)

  await page.getByLabel('素材授权声明').check()
  await page.getByLabel('制作须知').check()
  await page.getByRole('button', { name: '下一步：确认并提交' }).click()

  await expect(page.getByText('150 积分', { exact: true })).toBeVisible()
  expect(capture.quotes).toHaveLength(1)
  await page.screenshot({
    path: testInfo.outputPath('promo-offline-handover-quoted.png'),
    fullPage: true,
    animations: 'disabled',
  })
})
