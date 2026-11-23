import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 640 },
  { width: 390, height: 640 },
]) {
  test(`选中靠近屏幕下沿的图片时保持画布位置 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/canvases/119**', (route) =>
      route.fulfill({
        json:
          route.request().method() === 'PATCH'
            ? { sync_revision: 2 }
            : new URL(route.request().url()).pathname.endsWith('/elements')
              ? {
                  elements: [
                    {
                      element_id: 'source',
                      kind: 'node',
                      payload: {
                        id: 'source',
                        type: 'image',
                        position: { x: 300, y: 250 },
                        style: { width: 200, height: 160 },
                        data: { kind: 'image', title: '画布位置检查', prompt: '布局检查' },
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
    await page.route('**/api/v1/canvases/119/node-locks**', (route) =>
      route.fulfill({ json: { granted: true, nodes: {} } }),
    )
    await page.goto('/canvas/119')
    const node = page.locator('.react-flow__node[data-id="source"]')
    const canvasViewport = page.locator('.react-flow__viewport')
    await expect(node).toBeInViewport()
    const original = (await node.boundingBox())!
    const delta = viewport.height - 65 - original.y - original.height
    const dragY = delta > 0 ? 105 : viewport.height - 105
    await page.mouse.move(20, dragY)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(20, dragY + delta, { steps: 8 })
    await page.mouse.up({ button: 'middle' })
    await expect
      .poll(async () => {
        const box = (await node.boundingBox())!
        return Math.abs(box.y + box.height - (viewport.height - 65))
      })
      .toBeLessThan(4)

    const transform = await canvasViewport.evaluate((element) => {
      const before = element.getAttribute('style')
      const changes: Array<string | null> = []
      const observer = new MutationObserver(() => changes.push(element.getAttribute('style')))
      observer.observe(element, { attributes: true, attributeFilter: ['style'] })
      ;(element as HTMLElement & { viewportChanges?: Array<string | null> }).viewportChanges = changes
      return before
    })
    await node.click()
    const editor = page.locator('[data-canvas-node-panel]')
    await expect(editor.getByRole('textbox')).toHaveText('布局检查')
    const nodeBox = (await node.boundingBox())!
    const panelBox = (await editor.boundingBox())!
    expect(panelBox.y - (nodeBox.y + nodeBox.height)).toBeGreaterThanOrEqual(15)
    await page.screenshot({ path: testInfo.outputPath('node-panel-no-pan.png') })
    expect(await canvasViewport.getAttribute('style')).toBe(transform)
    const changes = await canvasViewport.evaluate(
      (element) => (element as HTMLElement & { viewportChanges?: Array<string | null> }).viewportChanges,
    )
    expect(changes?.every((value) => value === transform)).toBe(true)
    expectNoUnexpectedApi(api)
  })
}
