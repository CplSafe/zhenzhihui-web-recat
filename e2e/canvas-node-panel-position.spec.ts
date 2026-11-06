import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 760, height: 640 },
  { width: 390, height: 640 },
]) {
  test(`节点编辑面板位于节点下方且保持在视口内 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/canvases/119**', (route) =>
      route.fulfill({
        json:
          route.request().method() === 'PATCH'
            ? { revision: 2 }
            : new URL(route.request().url()).pathname.endsWith('/elements')
              ? {
                  elements: [
                    {
                      element_id: 'source',
                      kind: 'node',
                      payload: {
                        id: 'source',
                        type: 'video',
                        position: { x: 300, y: 250 },
                        style: { width: 320, height: 240 },
                        data: { kind: 'video', prompt: '布局检查' },
                      },
                    },
                  ],
                  sync_revision: 1,
                  history_floor_revision: 0,
                  has_more: false,
                }
              : { id: 119, title: '面板位置检查', revision: 1 },
      }),
    )
    await page.goto('/canvas/119')
    const node = page.locator('.react-flow__node[data-id="source"]')
    await node.click()
    const editor = page.locator('[data-canvas-node-panel]')
    await expect(editor).toBeVisible()
    await expect
      .poll(async () => {
        const nodeBox = await node.boundingBox()
        const panelBox = await editor.boundingBox()
        return panelBox!.y - (nodeBox!.y + nodeBox!.height)
      })
      .toBeGreaterThanOrEqual(15)
    await expect
      .poll(async () => {
        const box = await editor.boundingBox()
        return box!.y + box!.height
      })
      .toBeLessThanOrEqual(viewport.height)
    await expect(editor).toHaveCSS('scrollbar-width', viewport.width <= 600 ? 'thin' : 'none')
    await expect(editor).toHaveCSS('overflow-x', 'hidden')
    await editor.getByRole('textbox').fill('面板输入检查')
    await expect(editor.getByRole('textbox')).toHaveText('面板输入检查')
    await page.screenshot({ path: testInfo.outputPath('node-panel.png') })
  })
}
