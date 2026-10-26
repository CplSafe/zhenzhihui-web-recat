import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 768, 390]) {
  test(`画布列表与新建弹窗在 ${width}px 可操作`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/canvases?**', (route) =>
      route.fulfill({
        json: {
          items: [
            { id: 701, title: '春日新品 · 视觉探索', updated_at: '2026-10-22T08:30:00Z' },
            { id: 702, title: '产品故事分镜', updated_at: '2026-10-21T09:00:00Z' },
            { id: 703, title: '品牌短片素材', status: 'archived' },
          ],
          total: 3,
        },
      }),
    )
    await page.goto('/canvas')
    await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '打开画布 春日新品 · 视觉探索', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByText('共 3 个画布', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('canvas-list.png'), fullPage: true })
    await page.getByRole('button', { name: '更多操作' }).first().focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/canvas$/)
    await page.getByRole('button', { name: '重命名', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '重命名画布' })).toBeVisible()
    await page.getByRole('dialog', { name: '重命名画布' }).getByRole('button', { name: '取消' }).click()
    await page.getByRole('button', { name: /新建画布/ }).click()
    const dialog = page.getByRole('dialog', { name: '创建新画布' })
    await expect(dialog).toBeVisible()
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await expect(dialog.getByRole('button', { name: '创建画布', exact: true })).toBeDisabled()
    await dialog.getByPlaceholder('请输入画布名称').fill('新的创意')
    await expect(dialog.getByRole('button', { name: '创建画布', exact: true })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('canvas-create.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: /新建画布/ }).click()
    await expect(dialog.getByPlaceholder('请输入画布名称')).toHaveValue('')
    await dialog.getByRole('button', { name: '取消' }).click()
    expectNoUnexpectedApi(api)
  })
}

test('空画布列表显示创建引导', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.goto('/canvas')
  await expect(page.getByText(/还没有画布/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('canvas-empty.png'), fullPage: true })
  expectNoUnexpectedApi(api)
})

test('宽屏两张有封面的画布保持缩略卡片尺寸', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 2160, height: 1200 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases?**', (route) =>
    route.fulfill({
      json: {
        items: [
          { id: 701, title: '空间光影' },
          { id: 702, title: '人物视觉' },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/*/elements?**', (route) =>
    route.fulfill({
      json: {
        elements: [
          {
            element_id: 'cover',
            kind: 'node',
            op: 'upsert',
            payload: { type: 'image', data: { kind: 'image', assetId: 981 } },
          },
        ],
        has_more: false,
        sync_revision: 1,
      },
    }),
  )
  await page.route('**/api/v1/assets/981/download?**', (route) =>
    route.fulfill({ path: 'src/assets/login-hero.webp', contentType: 'image/webp' }),
  )
  await page.goto('/canvas')
  const cards = page.locator('[data-canvas-id]')
  await expect(cards).toHaveCount(2)
  await expect(page.locator('.cl-cover-media')).toHaveCount(2)
  for (const image of await page.locator('.cl-cover-media').all()) {
    await expect(image).toHaveJSProperty('complete', true)
    expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  }
  for (const card of await cards.all()) {
    const bounds = await card.boundingBox()
    expect(bounds!.width).toBeLessThanOrEqual(380)
    expect(bounds!.height).toBeLessThan(310)
  }
  await page.screenshot({ path: testInfo.outputPath('canvas-two-covers.png'), fullPage: true })
  expectNoUnexpectedApi(api)
})
