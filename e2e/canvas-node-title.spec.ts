import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 760]) {
  test(`生成结果节点标题不显示绿对钩 ${width}`, async ({ page }) => {
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
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
