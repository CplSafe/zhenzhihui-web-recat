import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 760]) {
  test(`选中节点显示灰白边框 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/assets/701/stream**', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250"><rect width="250" height="250" fill="#dbeafe"/></svg>',
      }),
    )
    await page.route('**/api/v1/canvases/112**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
      const elements = ['image', 'video'].map((kind, index) => ({
        element_id: kind,
        kind: 'node',
        op: 'upsert',
        payload: {
          id: kind,
          type: kind,
          position: { x: 100 + index * 360, y: 100 },
          style: { width: 250, height: 250 },
          data: {
            kind,
            title: `${kind}生成结果`,
            assetId: 701,
            taskStatus: 'succeeded',
            resultHistory: [{ assetId: 701 }],
          },
        },
      }))
      await route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : elements,
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 112, title: '节点标题验收', status: 'active', revision: 1 },
      })
    })
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { items: [] } }))
    await page.goto('/canvas/112')
    await expect(page.locator('.canvas-node-header')).toHaveCount(2)
    await expect(page.locator('.canvas-node-header__label').filter({ hasText: 'image生成结果' })).toBeVisible()
    await expect(page.locator('.canvas-node-header__label').filter({ hasText: 'video生成结果' })).toBeVisible()
    await expect(page.locator('.canvas-node-header__done')).toHaveCount(0)
    const zoomControl = page.getByRole('combobox', { name: '画布缩放' })
    await zoomControl.selectOption('25')
    await expect
      .poll(() =>
        page
          .locator('.react-flow__viewport')
          .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a),
      )
      .toBeCloseTo(0.25, 2)
    const titleFontSize = await page
      .locator('.canvas-node-header__label')
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    expect(titleFontSize * 0.25).toBeCloseTo(12, 1)
    await page.screenshot({ path: testInfo.outputPath('node-titles-readable-at-25-percent.png') })
    await page.locator('.react-flow__node').first().click()
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
    await expect(page.locator('.react-flow__node.selected')).toHaveCSS('outline-color', 'rgb(203, 213, 217)')
    await expect(page.getByRole('toolbar', { name: '节点操作', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('compact-node-toolbar.png') })
    await zoomControl.selectOption('100')
    await page.screenshot({ path: testInfo.outputPath('selected-node-border.png') })
    expectNoUnexpectedApi(api)
  })
}
