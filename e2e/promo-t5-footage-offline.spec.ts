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

async function mockPromo(page: Parameters<typeof installStrictAuthenticatedApp>[0], config = baseConfig) {
  const capture: Capture = { quotes: [], offline: [], orders: [] }
  let materialId = 4

  await page.route('**/api/v1/promo/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    let data: unknown = {}
    if (path.endsWith('/config')) data = config
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

for (const withFootage of [false, true]) {
  test(`实拍素材${withFootage ? '少于三条' : '未上传'}时可以获取报价`, async ({ page }, testInfo) => {
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    const capture = await mockPromo(page)
    await openMaterialStage(page)

    await expect(page.getByText('尽可能上传', { exact: true })).toBeVisible()
    if (withFootage) await uploadFootage(page)
    await expect(page.getByLabel('素材授权声明')).not.toBeChecked()
    await expect(page.getByLabel('制作须知')).not.toBeChecked()
    await page.getByLabel('素材授权声明').check()
    await page.getByLabel('制作须知').check()
    await page.screenshot({
      path: testInfo.outputPath('promo-optional-footage.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '下一步：确认并提交' }).click()
    await expect(page.getByText('150 积分', { exact: true })).toBeVisible()
    expect(capture.quotes).toHaveLength(1)
    expect(capture.orders).toHaveLength(0)
  })
}

test('直接显示客服电话，不自动登记线下交接', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const capture = await mockPromo(page)
  await openMaterialStage(page)

  await uploadFootage(page)
  await expect(page.getByRole('button', { name: '素材我线下交给顾问' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /复制客服电话/ })).toBeVisible()
  expect(capture.offline).toHaveLength(0)

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

for (const width of [1440, 390]) {
  test(`点击顾问号码复制并显示结果 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await mockPromo(page)
    await openMaterialStage(page)
    const phone = page.getByRole('button', { name: '复制客服电话 10000' })
    await expect(phone).toBeVisible()
    const help = page.locator('[class*="materialHelp"]').filter({ hasText: '请拨打客服电话，与顾问沟通素材交接。' })
    await expect(help).toContainText('客服电话：')
    const bounds = await help.boundingBox()
    const phoneBounds = await phone.boundingBox()
    expect(bounds).not.toBeNull()
    expect(phoneBounds).not.toBeNull()
    expect(bounds!.x + bounds!.width - (phoneBounds!.x + phoneBounds!.width)).toBeLessThan(25)
    await expect(phone).toHaveText('复制')
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            ;(window as any).__copiedPhone = value
          },
        },
      })
    })
    await phone.click()
    await expect.poll(() => page.evaluate(() => (window as any).__copiedPhone)).toBe('10000')
    await expect(page.getByText('复制成功', { exact: true })).toBeVisible()
    await phone.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`copy-phone-${width}.png`), animations: 'disabled' })
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error('clipboard denied')
          },
        },
      })
    })
    await phone.click()
    await expect(page.getByText('复制失败，请手动选择号码', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/promo/)
  })
}

for (const width of [1440, 390]) {
  test(`上传区展示服务端视频格式与单文件大小 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await mockPromo(page, {
      ...baseConfig,
      allowed_mime: ['video/mp4', 'video/quicktime', 'video/webm', 'image/png'],
      max_file_bytes: 1073741824,
    })
    await openMaterialStage(page)
    const upload = page.getByLabel('上传实拍素材')
    await expect(upload).toHaveAccessibleDescription('视频支持 MP4、MOV、WebM，单个文件不超过 1 GB')
    await expect(page.getByText('视频支持 MP4、MOV、WebM，单个文件不超过 1 GB')).toBeVisible()
    await upload.locator('..').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`video-requirements-${width}.png`), animations: 'disabled' })
  })
}

test('视频格式和大小提示跟随配置变化', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await mockPromo(page, { ...baseConfig, allowed_mime: ['video/webm', 'image/png'], max_file_bytes: 52428800 })
  await openMaterialStage(page)
  await expect(page.getByText('视频支持 WebM，单个文件不超过 50 MB')).toBeVisible()
  await expect(page.getByText(/视频支持 MP4/)).toHaveCount(0)
})

test('未配置视频格式时明确提示', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await mockPromo(page)
  await openMaterialStage(page)
  await expect(page.getByText('当前不支持上传视频')).toBeVisible()
})

test('恢复缺少规格的草稿后使用有效配置报价，并阻止重复请求', async ({ page }) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => {
    localStorage.setItem('zzh.promo.intake.7.21', 'saved-intake')
    localStorage.setItem(
      'zzh.promo.draft.7.21',
      JSON.stringify({
        company: '测试公司',
        contact: '测试',
        phone: '13800000000',
        brief: '测试需求',
        duration_seconds: 0,
        ratio: '',
        resolution: '',
      }),
    )
  })
  let quotes = 0
  await page.route('**/api/v1/promo/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/config')) return route.fulfill({ json: { code: 0, data: baseConfig } })
    if (path.endsWith('/intakes/saved-intake'))
      return route.fulfill({ json: { code: 0, data: { intake: {}, materials: [] } } })
    if (path.endsWith('/quote')) {
      quotes++
      expect(route.request().postDataJSON()).toMatchObject({
        duration_seconds: 180,
        ratio: '16:9',
        resolution: '1080P',
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      return route.fulfill({
        json: { code: 0, data: { base_cost: 100, service_cost: 50, total_cost: 150, config_hash: 'hash1' } },
      })
    }
    return route.fallback()
  })
  await page.goto('/promo')
  await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
  await page.getByLabel('素材授权声明').check()
  await page.getByLabel('制作须知').check()
  await page.getByRole('button', { name: '下一步：确认并提交' }).dblclick({ delay: 10, force: true })
  await expect(page.getByText('150 积分', { exact: true })).toBeVisible()
  expect(quotes).toBe(1)
})
