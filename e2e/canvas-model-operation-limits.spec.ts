import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('图生图按对应操作的模型限制拦截连线', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) => {
    const op = new URL(route.request().url()).searchParams.get('operation_code')
    const imageOp = op === 'image.text_to_image' || op === 'image.image_to_image'
    return route.fulfill({
      json: {
        items: imageOp
          ? [
              {
                id: 42,
                display_name: '图片模型',
                operation_codes: [op],
                input_constraints: {
                  [op!]: {
                    roles:
                      op === 'image.image_to_image' ? [{ role: 'reference_image', min_count: 1, max_count: 3 }] : [],
                  },
                },
              },
            ]
          : [],
      },
    })
  })
  const nodes = Array.from({ length: 4 }, (_, index) => ({
    element_id: `source-${index}`,
    kind: 'node',
    op: 'upsert',
    payload: {
      id: `source-${index}`,
      type: 'image',
      position: { x: 100, y: 100 + index * 100 },
      style: { width: 220, height: 200 },
      data: { kind: 'image', assetId: 701 + index },
    },
  }))
  const edges = nodes.slice(0, 3).map((node, index) => ({
    element_id: `edge-${index}`,
    kind: 'edge',
    op: 'upsert',
    payload: {
      id: `edge-${index}`,
      source: node.element_id,
      target: 'target',
      sourceHandle: `${node.element_id}-right-source`,
      targetHandle: 'target-left-target',
      data: { slotIndex: index },
    },
  }))
  await page.route('**/api/v1/canvases/198**', (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({
      json:
        route.request().method() === 'PATCH'
          ? { sync_revision: 2 }
          : url.pathname.endsWith('/elements')
            ? {
                elements: [
                  ...nodes,
                  ...edges,
                  {
                    element_id: 'target',
                    kind: 'node',
                    op: 'upsert',
                    payload: {
                      id: 'target',
                      type: 'image',
                      position: { x: 1000, y: 400 },
                      style: { width: 300, height: 200 },
                      data: { kind: 'image', modelVersionId: 42 },
                    },
                  },
                ],
                sync_revision: 1,
                history_floor_revision: 0,
                has_more: false,
              }
            : { id: 198, title: '模型连线上限', status: 'active', revision: 1 },
    })
  })
  await page.goto('/canvas/198')
  await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('50')
  await page.locator('.react-flow__node[data-id="target"]').click()
  const source = page.locator('.react-flow__node[data-id="source-3"]')
  await source.hover()
  await source.locator('.canvas-handle-icon--right').dragTo(page.locator('.react-flow__node[data-id="target"]'))
  await expect(page.getByText(/最多连接 3 条图片参考线/)).toBeVisible()
  await expect(page.locator('.react-flow__edge')).toHaveCount(3)
  await page.screenshot({ path: testInfo.outputPath('image-limit.png') })
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
