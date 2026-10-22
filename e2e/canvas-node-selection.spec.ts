import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('普通点击切换单选，组合键和框选仍可多选', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases/112**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    const elements = ['A', 'B'].map((id, index) => ({
      element_id: id,
      kind: 'node',
      op: 'upsert',
      payload: {
        id,
        type: 'text',
        position: { x: 100 + index * 400, y: 100 },
        style: { width: 250, height: 200 },
        data: { kind: 'text', title: id },
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
        : { id: 112, title: '选择行为验收', status: 'active', revision: 1 },
    })
  })
  await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: [] }))
  await page.goto('/canvas/112')
  const a = page.locator('.react-flow__node[data-id="A"]')
  const b = page.locator('.react-flow__node[data-id="B"]')
  const selected = page.locator('.react-flow__node.selected')
  await a.locator('.canvas-node-header').click()
  await b.locator('.canvas-node-header').click()
  await expect(selected).toHaveCount(1)
  await expect(b).toHaveClass(/selected/)
  for (const modifier of ['Control', 'Meta'] as const) {
    await a.locator('.canvas-node-header').click({ modifiers: [modifier] })
    await expect(selected).toHaveCount(2)
    await a.locator('.canvas-node-header').click({ modifiers: [modifier] })
    await expect(selected).toHaveCount(1)
    await a.locator('.canvas-node-header').click({ modifiers: [modifier] })
    await expect(selected).toHaveCount(2)
    await b.locator('.canvas-node-header').click()
    await expect(selected).toHaveCount(1)
    await expect(b).toHaveClass(/selected/)
  }
  const ab = await a.boundingBox()
  const bb = await b.boundingBox()
  if (!ab || !bb) throw new Error('节点缺少位置')
  await page.mouse.move(ab.x - 20, ab.y - 35)
  await page.mouse.down()
  await page.mouse.move(bb.x + bb.width + 15, ab.y + 60, { steps: 15 })
  await page.mouse.up()
  await expect(selected).toHaveCount(2)
  await a.locator('.canvas-node-header').click()
  await expect(selected).toHaveCount(1)
  expectNoUnexpectedApi(api)
})
