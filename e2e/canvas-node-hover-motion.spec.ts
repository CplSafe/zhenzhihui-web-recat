import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('节点悬停时轻微上浮并过渡阴影', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/222**', (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({
      json:
        route.request().method() === 'PATCH'
          ? { sync_revision: 2 }
          : url.pathname.endsWith('/elements')
            ? {
                elements: [
                  {
                    element_id: 'hover-image',
                    kind: 'node',
                    op: 'upsert',
                    payload: {
                      id: 'hover-image',
                      type: 'image',
                      position: { x: 200, y: 140 },
                      style: { width: 280, height: 220 },
                      data: { kind: 'image' },
                    },
                  },
                ],
                sync_revision: 1,
                history_floor_revision: 0,
                has_more: false,
              }
            : { id: 222, title: '节点悬停动效', status: 'active', revision: 1 },
    })
  })

  await page.goto('/canvas/222')
  const node = page.locator('.react-flow__node[data-id="hover-image"] .canvas-default-node')
  await expect(node).toBeVisible()
  await node.hover()
  await expect
    .poll(() => node.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m42))
    .toBeCloseTo(-0.5, 1)
  await page.screenshot({ path: testInfo.outputPath('canvas-node-hover-motion.png') })
  expectNoUnexpectedApi(api)
})
