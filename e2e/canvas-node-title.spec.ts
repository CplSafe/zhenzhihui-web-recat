import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 760]) {
  test(`生成结果节点标题不显示绿对钩 ${width}`, async ({ page }, testInfo) => {
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
    await page.locator('.react-flow__node').first().click()
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
    const toolbar = page.getByRole('toolbar', { name: '节点操作', exact: true })
    const panel = page.locator('.canvas-panel-area')
    await expect(toolbar).toBeVisible()
    await expect(panel).toHaveCSS('visibility', 'visible')

    // 平移画布，使选中节点完全离开可视区；关联工具栏和面板应随之隐藏。
    const paneBounds = await page.locator('.react-flow').boundingBox()
    if (!paneBounds) throw new Error('画布缺少可视区域')
    const dragY = paneBounds.y + paneBounds.height * 0.75
    await page.mouse.move(paneBounds.x + paneBounds.width - 24, dragY)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(paneBounds.x + 8, dragY, { steps: 10 })
    await page.mouse.up({ button: 'middle' })
    await expect(toolbar).toHaveCount(0)
    await expect(panel).toHaveCSS('visibility', 'hidden')
    await page.screenshot({ path: testInfo.outputPath('selected-node-offscreen-controls-hidden.png') })

    // 把视口平移回来，确认两组控件可以恢复。
    await page.mouse.move(paneBounds.x + 8, dragY)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(paneBounds.x + paneBounds.width - 24, dragY, { steps: 10 })
    await page.mouse.up({ button: 'middle' })
    await expect(toolbar).toBeVisible()
    await expect(panel).toHaveCSS('visibility', 'visible')
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
