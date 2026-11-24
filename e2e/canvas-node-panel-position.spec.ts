import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 640 },
  { width: 390, height: 640 },
]
const scenarios = [
  { kind: 'image', name: '图片' },
  { kind: 'video', name: '视频' },
  { kind: 'audio', name: '音频' },
] as const
const prompt = '布局检查'

for (const { kind, name, viewport } of scenarios.flatMap((scenario) =>
  viewports.map((viewport) => ({ ...scenario, viewport })),
)) {
  test(`选中靠近屏幕下沿的${name}时保持画布位置 ${viewport.width}`, async ({ page }, testInfo) => {
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
                        type: kind,
                        position: { x: 300, y: 250 },
                        style: { width: 200, height: 160 },
                        data: { kind, title: '画布位置检查', prompt },
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
    await node.locator('.canvas-node-header').click()
    const editor = page.locator(kind === 'audio' ? '.canvas-audio-panel' : '[data-canvas-node-panel]')
    await expect(editor).toBeVisible()
    const field = editor.getByRole('textbox', kind === 'audio' ? { name: '配音文案或音乐描述' } : {})
    if (kind === 'audio') await expect(field).toHaveValue(prompt)
    else await expect(field).toHaveText(prompt)
    if (kind !== 'image') {
      await field.click()
      await field.fill('面板仍可编辑')
      if (kind === 'audio') await expect(field).toHaveValue('面板仍可编辑')
      else await expect(field).toHaveText('面板仍可编辑')
    }
    const nodeBox = (await node.boundingBox())!
    const panelBox = (await editor.boundingBox())!
    if (kind === 'image') {
      expect(panelBox.y - (nodeBox.y + nodeBox.height)).toBeGreaterThanOrEqual(15)
    }
    if (kind === 'audio') {
      expect(panelBox.y).toBeGreaterThanOrEqual(0)
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(nodeBox.y + 1)
      const toolbar = page.getByRole('toolbar', { name: '节点操作', exact: true })
      await expect(toolbar).toBeVisible()
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual((await toolbar.boundingBox())!.y)
    }
    if (kind === 'video') {
      expect(panelBox.x).toBeGreaterThanOrEqual(0)
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(viewport.width)
      if (viewport.width === 1440) await expect(editor).toHaveCSS('width', '680px')
    }
    await page.screenshot({ path: testInfo.outputPath('node-panel-no-pan.png') })
    expect(await canvasViewport.getAttribute('style')).toBe(transform)
    const changes = await canvasViewport.evaluate(
      (element) => (element as HTMLElement & { viewportChanges?: Array<string | null> }).viewportChanges,
    )
    expect(changes?.every((value) => value === transform)).toBe(true)

    if (kind === 'video' && viewport.width === 1440) {
      await test.step('从面板空白处开始平移', async () => {
        const passiveLabel = editor.getByText('请选择模型以查看素材限制')
        const hand = page.getByRole('button', { name: '拖动', exact: true })
        const canvasX = () =>
          canvasViewport.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41)

        for (const button of ['middle', 'left'] as const) {
          if (button === 'left') {
            await hand.click()
            await expect(hand).toHaveAttribute('aria-pressed', 'true')
          }
          await passiveLabel.hover()
          const bounds = (await passiveLabel.boundingBox())!
          const x = bounds.x + bounds.width / 2
          const y = bounds.y + bounds.height / 2
          const before = await canvasX()
          await page.mouse.move(x, y)
          await page.mouse.down({ button })
          await page.mouse.move(x + 60, y, { steps: 8 })
          await page.mouse.up({ button })
          await expect.poll(canvasX).toBeCloseTo(before + 60, 0)
          await page.mouse.move(x + 80, y)
          expect(await canvasX()).toBeCloseTo(before + 60, 0)
          await expect(editor).toBeVisible()
        }
        await page.screenshot({ path: testInfo.outputPath('panel-background-pan.png') })
      })
    }

    expectNoUnexpectedApi(api)
  })
}
