import { expect, test, type Page } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

const config = {
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
}

async function expectFullWidthSteps(page: Page) {
  const main = page.locator('[data-promo-real] main')
  const bar = main.getByRole('list').filter({ hasText: '确认并提交' }).locator('..')
  const bounds = await bar.boundingBox()
  const contentBounds = await main.boundingBox()
  expect(bounds).not.toBeNull()
  expect(contentBounds).not.toBeNull()
  expect(Math.abs(bounds!.x - contentBounds!.x)).toBeLessThan(1)
  expect(Math.abs(bounds!.width - contentBounds!.width)).toBeLessThan(1)
  await bar.getByText('需求与素材').scrollIntoViewIfNeeded()
  await expect(bar.getByText('需求与素材')).toBeInViewport()
  await bar.getByText('交付验收').scrollIntoViewIfNeeded()
  await expect(bar.getByText('交付验收')).toBeInViewport()
}

test('宣传片关闭时显示服务未开放，并保留订单入口', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/promo/config', (route) =>
    route.fulfill({ json: { code: 0, data: { enabled: false, entry_name: '定制宣传片' } } }),
  )
  await page.goto('/promo')
  await expect(page.getByText('新建服务暂未开放，已有订单仍可查看。')).toBeVisible()
  await expect(page.getByText('宣传片配置不完整，请联系客服')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '提交需求，进入制作排期' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('promo-disabled.png'), animations: 'disabled' })
})

for (const width of [1440, 390]) {
  test(`宣传片收起的任务入口在可视区域居中 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/promo/config', (route) =>
      route.fulfill({ json: { code: 0, data: { ...config, enabled: false } } }),
    )
    await page.goto('/promo')
    await expect(page.getByRole('heading', { name: '定制宣传片' })).toBeVisible()
    const rail = page.getByRole('button', { name: '展开任务管理' })
    const expectCentered = async () => {
      const button = await rail.boundingBox()
      const banner = await page.getByRole('banner').boundingBox()
      expect(button).not.toBeNull()
      expect(banner).not.toBeNull()
      expect(Math.abs(button!.y + button!.height / 2 - (banner!.y + banner!.height + 844) / 2)).toBeLessThan(2)
    }
    await expectCentered()
    await page.screenshot({ path: testInfo.outputPath(`promo-task-rail-${width}.png`), animations: 'disabled' })
    await rail.click()
    await expect(
      page.getByRole(width <= 900 ? 'dialog' : 'complementary', { name: '任务管理', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '收起任务管理' }).click()
    await expectCentered()
  })
}

test('宣传片素材完成后报价，下单失败后使用原请求重试', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-11-05T07:30:00Z'))
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const bodies: string[] = []
  let uploaded = false
  let releaseUpload!: () => void
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve
  })
  let orderStatus = 'pending'
  let reworkRequests = 0
  await page.route('**/api/v1/promo/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    let data: unknown = {}
    if (path.endsWith('/config')) data = config
    else if (path.endsWith('/intakes') && method === 'POST') data = { token: 'intake-1' }
    else if (path.endsWith('/uploads'))
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
        expires_at: '2027-01-01',
      }
    else if (path.endsWith('/materials/5/complete')) {
      expect(uploaded).toBe(true)
      data = { id: 5, role: 'footage', status: 'active', name: '素材.png', size_bytes: 3, mime_type: 'image/png' }
    } else if (path.endsWith('/quote'))
      data = { base_cost: 100, service_cost: 50, total_cost: 150, config_hash: 'hash1', promised_date: '2026-11-10' }
    else if (path.endsWith('/orders') && method === 'POST') {
      bodies.push(route.request().postData() || '')
      if (bodies.length === 1) {
        await route.fulfill({ status: 402, json: { code: 402, message: '余额不足' } })
        return
      }
      if (bodies.length === 2) {
        await route.fulfill({ status: 503, json: { code: 503, message: '暂不可用' } })
        return
      }
      data = { id: 31, task_id: 32 }
    } else if (path.endsWith('/orders/31/rework')) {
      expect(route.request().postDataJSON()).toEqual({ text: '调整片尾' })
      reworkRequests += 1
      orderStatus = 'reworking'
    } else if (path.endsWith('/materials/42/download')) {
      data = { download_url: '/tutorials/smart-create.mp4' }
    } else if (path.endsWith('/orders/31'))
      data = {
        order: {
          id: 31,
          workspace_id: 21,
          task_id: 32,
          status: orderStatus,
          billing_status: orderStatus === 'pending' ? 'frozen' : 'settled',
          is_overdue: false,
          first_delivered_at: orderStatus === 'pending' ? null : '2026-11-04T00:00:00+08:00',
          delivered_material_id: orderStatus === 'delivered' ? 42 : null,
          can_rework: orderStatus === 'delivered',
          rework_status: orderStatus === 'reworking' ? 'requested' : null,
          promised_date: '2026-11-10',
          created_at: '2026-11-05T07:30:00Z',
        },
        materials: [],
      }
    else return route.fallback()
    await route.fulfill({ json: { code: 0, data } })
  })
  await page.route('https://bucket.aliyuncs.com/upload', async (route) => {
    await uploadGate
    uploaded = true
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.goto('/promo')
  await expect(page.getByRole('button', { name: '提交需求，进入制作排期' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('promo-intro.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: '提交需求，进入制作排期' }).click()
  await expectFullWidthSteps(page)
  await expect(page.getByRole('button', { name: '下一步：上传素材 →' })).toBeDisabled()
  await page.getByLabel('单位 / 公司名称').fill('测试公司')
  await page.getByLabel('联系人', { exact: true }).fill('李先生')
  await page.getByLabel('联系电话').fill('13800000000')
  await page.getByLabel('制作需求', { exact: true }).fill('介绍产品')
  await page.screenshot({ path: testInfo.outputPath('promo-form.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
  await page.getByLabel('上传实拍素材').evaluate((input) => {
    const data = new DataTransfer()
    data.items.add(new File(['abc'], '素材.png', { type: 'image/png' }))
    input.parentElement?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
  })
  await expect(page.getByRole('status').filter({ hasText: '正在处理素材：素材.png' })).toBeVisible()
  await expect(page.getByText(/素材.png · 上传中/)).toBeVisible()
  releaseUpload()
  await expect(page.getByText(/素材.png · 已就绪/)).toBeVisible()
  await page.getByLabel('素材授权声明').check()
  await page.getByLabel('制作须知').check()
  await page.screenshot({ path: testInfo.outputPath('promo-materials.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: '下一步：确认并提交' }).click()
  await expectFullWidthSteps(page)
  await expect(page.getByText('150 积分', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('promo-quote.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('list').filter({ hasText: '确认并提交' }).getByText('需求与素材').click()
  await expect(page.getByRole('heading', { name: '定制宣传片 · 需求填写' })).toBeVisible()
  await expect(page.getByLabel('制作需求', { exact: true })).toHaveValue('介绍产品')
  await page.getByLabel('制作需求', { exact: true }).fill('介绍更新后的产品')
  await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
  await expect(page.getByText(/素材.png · 已就绪/)).toBeVisible()
  await page.getByRole('button', { name: '下一步：确认并提交' }).click()
  await expect(page.getByText('介绍更新后的产品')).toBeVisible()
  await page.getByRole('button', { name: '上一步' }).click()
  await expect(page.getByRole('heading', { name: '上传素材' })).toBeVisible()
  await page.getByRole('button', { name: '上一步' }).click()
  await expect(page.getByLabel('制作需求', { exact: true })).toHaveValue('介绍更新后的产品')
  await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
  await page.getByRole('button', { name: '下一步：确认并提交' }).click()
  await page.getByRole('button', { name: '提交宣传片任务（T+5）' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认提交' }).click()
  await expect(page.getByRole('alert')).toContainText('余额不足')
  await expect(page.getByRole('button', { name: '重试原请求' })).toHaveCount(0)
  await page.getByRole('button', { name: '提交宣传片任务（T+5）' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认提交' }).click()
  await expect(page.getByRole('button', { name: '重试原请求' })).toBeVisible()
  await page.getByRole('button', { name: '重试原请求' }).click()
  await expect(page.getByRole('heading', { name: '宣传片订单 #31' })).toBeVisible()
  await expectFullWidthSteps(page)
  await expect(page.getByRole('timer')).toContainText('成片将于05天00之内完成交付')
  expect(bodies).toHaveLength(3)
  expect(bodies[1]).toBe(bodies[2])
  expect(JSON.parse(bodies[0]).idempotency_key).not.toBe(JSON.parse(bodies[1]).idempotency_key)
  expect(JSON.parse(bodies[1])).toMatchObject({
    intake_token: 'intake-1',
    brief: '介绍更新后的产品',
    config_hash: 'hash1',
    authorized: true,
    acknowledged: true,
    authorization_version: 'v1',
  })
  await expect(page.getByText('等待制作', { exact: true })).toBeVisible()
  orderStatus = 'delivered'
  await page.getByRole('button', { name: '刷新状态' }).click()
  await expect(page.getByLabel('宣传片成片')).toBeVisible()
  await expect(page.getByRole('link', { name: '下载视频' })).toBeVisible()
  await page.getByLabel('宣传片成片').evaluate((element) => (element as HTMLVideoElement).play())
  await expect
    .poll(() => page.getByLabel('宣传片成片').evaluate((element) => (element as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0)
  await page.screenshot({ path: testInfo.outputPath('promo-delivered.png'), fullPage: true, animations: 'disabled' })
  await page.getByLabel('修改意见').fill('调整片尾')
  await page.getByRole('button', { name: '申请免费修改' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确\s*认/ })
    .click()
  await expect(page.getByText('返工中', { exact: true })).toBeVisible()
  expect(reworkRequests).toBe(1)
})

test('服务关闭时仍可查看历史订单', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/promo/config', (route) =>
    route.fulfill({ json: { code: 0, data: { ...config, enabled: false } } }),
  )
  await page.route('**/api/v1/promo/orders**', (route) =>
    route.fulfill({ json: { code: 0, data: { items: [], total: 0, limit: 20, offset: 0, has_unfinished: false } } }),
  )
  await page.goto('/promo')
  await expect(page.getByText('新建服务暂未开放，已有订单仍可查看。')).toBeVisible()
  await expect(page.getByRole('button', { name: '提交需求，进入制作排期' })).toHaveCount(0)
  await page.getByRole('button', { name: '查看我的订单' }).click()
  await expect(page.getByText('暂无宣传片订单。')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('窄屏可填写宣传片需求并进入素材步骤', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/promo/config', (route) => route.fulfill({ json: { code: 0, data: config } }))
  await page.route('**/api/v1/promo/intakes', (route) =>
    route.fulfill({ json: { code: 0, data: { token: 'mobile-intake' } } }),
  )
  await page.goto('/promo')
  await page.getByRole('button', { name: '提交需求，进入制作排期' }).click()
  await expectFullWidthSteps(page)
  await page.getByLabel('单位 / 公司名称').fill('公司')
  await page.getByLabel('联系人', { exact: true }).fill('联系人')
  await page.getByLabel('联系电话').fill('13800000000')
  await page.getByLabel('制作需求', { exact: true }).fill('制作需求')
  await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
  await expect(page.getByRole('heading', { name: '上传素材' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('promo-materials-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })
})

test('刷新后恢复宣传片需求及素材，授权需要重新确认', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.route('**/api/v1/promo/config', (route) => route.fulfill({ json: { code: 0, data: config } }))
  await page.route('**/api/v1/promo/intakes**', (route) => {
    const data =
      route.request().method() === 'POST'
        ? { token: 'draft-intake' }
        : { materials: [{ id: 5, role: 'footage', status: 'active', name: '素材.png' }] }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/promo')
  await page.getByRole('button', { name: '提交需求，进入制作排期' }).click()
  await page.getByLabel('单位 / 公司名称').fill('恢复测试公司')
  await page.getByLabel('联系人', { exact: true }).fill('张先生')
  await page.getByLabel('联系电话').fill('13800000000')
  await page.getByLabel('制作需求', { exact: true }).fill('恢复制作需求')
  await page.reload()
  await expect(page.getByLabel('单位 / 公司名称')).toHaveValue('恢复测试公司')
  await expect(page.getByRole('textbox', { name: '制作需求' })).toHaveValue('恢复制作需求')
  await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
  await expect(page.getByText(/素材.png · 已就绪/)).toBeVisible()
  await expect(page.getByLabel('素材授权声明')).not.toBeChecked()
  await page.screenshot({
    path: testInfo.outputPath('promo-draft-restored.png'),
    fullPage: true,
    animations: 'disabled',
  })
})

for (const enabled of [true, false]) {
  test(`上传会话恢复失败可重试并保留草稿，服务${enabled ? '开放' : '关闭'}`, async ({ page }, testInfo) => {
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => {
      localStorage.setItem('zzh.promo.intake.7.21', 'saved-intake')
      localStorage.setItem('zzh.promo.draft.7.21', JSON.stringify({ company: '草稿公司', brief: '草稿需求' }))
    })
    await page.route('**/api/v1/promo/config', (route) =>
      route.fulfill({ json: { code: 0, data: { ...config, enabled } } }),
    )
    let attempts = 0
    await page.route('**/api/v1/promo/intakes/saved-intake', (route) => {
      attempts += 1
      if (attempts === 1) return route.fulfill({ status: 500, json: { code: 500, message: '暂时无法恢复' } })
      return route.fulfill({ json: { code: 0, data: { intake: {}, materials: [] } } })
    })
    await page.goto('/promo')
    await expect(page.getByRole('alert')).toContainText('上次上传会话恢复失败')
    if (enabled) await expect(page.getByRole('button', { name: '下一步：上传素材 →' })).toHaveCount(0)
    else await expect(page.getByText('新建服务暂未开放，已有订单仍可查看。')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`restore-error-${enabled}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '重试恢复' }).click()
    await expect(page.getByText('上次上传会话恢复失败', { exact: false })).toHaveCount(0)
    expect(attempts).toBe(2)
    expect(await page.evaluate(() => localStorage.getItem('zzh.promo.intake.7.21'))).toBe('saved-intake')
    if (enabled) await expect(page.getByLabel('单位 / 公司名称')).toHaveValue('草稿公司')
    else await expect(page.getByText('新建服务暂未开放，已有订单仍可查看。')).toBeVisible()
  })
}

test('素材上传失败后登记线下交接可继续并保留未上传提示', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  let quotes = 0
  await page.route('**/api/v1/promo/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = {}
    if (path.endsWith('/config')) data = config
    else if (path.endsWith('/intakes')) data = { token: 'offline-intake' }
    else if (path.endsWith('/uploads'))
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
        expires_at: '2027-01-01',
      }
    else if (path.endsWith('/offline')) data = {}
    else if (path.endsWith('/quote')) {
      quotes++
      data = { base_cost: 100, service_cost: 50, total_cost: 150, config_hash: 'hash1', promised_date: '2026-11-16' }
    } else return route.fallback()
    await route.fulfill({ json: { code: 0, data } })
  })
  await page.route('https://bucket.aliyuncs.com/upload', (route) =>
    route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' } }),
  )
  await page.goto('/promo')
  await page.getByRole('button', { name: '提交需求，进入制作排期' }).click()
  await page.getByLabel('单位 / 公司名称').fill('测试公司')
  await page.getByLabel('联系人', { exact: true }).fill('测试')
  await page.getByLabel('联系电话').fill('13800000000')
  await page.getByLabel('制作需求', { exact: true }).fill('介绍产品')
  await page.getByRole('button', { name: '下一步：上传素材 →' }).click()
  await page
    .getByLabel('上传实拍素材')
    .setInputFiles({ name: '素材.png', mimeType: 'image/png', buffer: Buffer.from('abc') })
  await expect(page.getByText(/素材.png · 上传失败/)).toBeVisible()
  await page.getByLabel('素材授权声明').check()
  await page.getByLabel('制作须知').check()
  await expect(page.getByRole('button', { name: '下一步：确认并提交' })).toBeDisabled()
  expect(quotes).toBe(0)
  await page.getByRole('button', { name: '素材我线下交给顾问' }).click()
  await expect(page.getByText('已登记线下交接，具体交付日期以报价为准。')).toBeVisible()
  await page.getByRole('button', { name: '下一步：确认并提交' }).click()
  await expect(page.getByRole('heading', { name: '需求已填写，素材线下交接' })).toBeVisible()
  await expect(page.getByText('未上传，将线下交接')).toBeVisible()
  expect(quotes).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('offline-failed-material.png') })
})
