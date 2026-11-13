import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`T+1 交付、复制与下载 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => {
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
      localStorage.setItem('zzh.manual.tasks.7.21', JSON.stringify([91]))
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text: string) => {
            ;(window as any).copiedPhone = text
          },
        },
      })
    })
    await page.route('**/api/v1/ai/tasks/91**', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            id: 91,
            status: 'succeeded',
            estimated_cost: 123,
            delivered_at: '2026-11-12T10:00:00Z',
            outputs: [{ type: 'video', url: '/tutorials/smart-create.mp4' }],
          },
        },
      }),
    )
    await page.goto('/smart?manualTask=91')
    await expect(page.getByLabel('精制视频成片')).toBeVisible()
    await expect(page.getByRole('heading', { name: '精修成片' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '刷新视频地址' })).toHaveCount(0)
    await expect(page.getByText('2026/11/12 18:00:00')).toBeVisible()
    await page.getByRole('button', { name: '联系客服' }).click()
    await page.getByRole('button', { name: '复制', exact: true }).click()
    await expect(page.getByText('复制成功')).toBeVisible()
    expect(await page.evaluate(() => (window as any).copiedPhone)).toBe('13681065734')
    await page.screenshot({ path: testInfo.outputPath('t1-delivery.png'), fullPage: true, animations: 'disabled' })
    const url = page.url()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /下载视频/ }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/精制成片_91/)
    expect(page.url()).toBe(url)
    await expect(page.getByLabel('精制视频成片')).toBeVisible()
  })
  test(`T+5 交付、复制与下载 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text: string) => {
            ;(window as any).copiedPhone = text
          },
        },
      }),
    )
    await page.route('**/api/v1/promo/config', (route) =>
      route.fulfill({ json: { code: 0, data: { enabled: false, entry_name: '定制宣传片', service_tel: '10000' } } }),
    )
    await page.route('**/api/v1/promo/orders/31', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            order: {
              id: 31,
              workspace_id: 21,
              status: 'delivered',
              billing_status: 'settled',
              delivered_material_id: 42,
              can_rework: false,
            },
            materials: [],
          },
        },
      }),
    )
    await page.route('**/api/v1/promo/materials/42/download', (route) =>
      route.fulfill({ json: { code: 0, data: { download_url: '/tutorials/smart-create.mp4' } } }),
    )
    await page.goto('/promo?order=31')
    await expect(page.getByLabel('宣传片成片')).toBeVisible()
    await expect(page.getByRole('button', { name: '返回订单列表' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '刷新视频地址' })).toHaveCount(0)
    await page.getByRole('button', { name: '复制', exact: true }).click()
    await expect(page.getByText('复制成功')).toBeVisible()
    expect(await page.evaluate(() => (window as any).copiedPhone)).toBe('10000')
    await page.screenshot({ path: testInfo.outputPath('t5-delivery.png'), fullPage: true, animations: 'disabled' })
    const url = page.url()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载视频' }).click()
    expect((await downloadPromise).suggestedFilename()).toMatch(/宣传片_31/)
    expect(page.url()).toBe(url)
  })
}

test('T+1 等待页去除多余控件并支持复制电话', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => {
    localStorage.setItem('zzh_guide_seen_smart_u7', '1')
    localStorage.setItem('zzh.manual.tasks.7.21', JSON.stringify([91]))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} } })
  })
  await page.route('**/api/v1/ai/tasks/91**', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: { id: 91, status: 'awaiting_manual', created_at: new Date().toISOString(), poll_after_ms: 15000 },
      },
    }),
  )
  await page.goto('/smart?manualTask=91')
  await expect(page.getByRole('heading', { name: '任务已提交，等待精制成片' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '制作进度' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '刷新状态' })).toHaveCount(0)
  await page.getByRole('button', { name: '复制', exact: true }).click()
  await expect(page.getByText('复制成功')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('t1-wait.png'), fullPage: true, animations: 'disabled' })
})
