import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 760]) {
  test(`低倍率抓手可平移并访问远离原点的节点 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/canvases/126**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? {
              elements: [
                {
                  element_id: 'far-text',
                  kind: 'node',
                  op: 'upsert',
                  payload: {
                    id: 'far-text',
                    type: 'text',
                    position: { x: 4000, y: 3000 },
                    style: { width: 300, height: 220 },
                    data: { kind: 'text', title: '远处节点', text: '平移验收' },
                  },
                },
              ],
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 126, title: '低倍率平移验收', revision: 1 },
      }),
    )
    await page.goto('/canvas/126')
    const node = page.locator('.react-flow__node[data-id="far-text"]')
    const viewport = page.locator('.react-flow__viewport')
    const transform = () =>
      viewport.evaluate((element) => {
        const matrix = new DOMMatrix(getComputedStyle(element).transform)
        return { x: matrix.e, y: matrix.f, zoom: matrix.a }
      })
    await expect(node).toBeVisible()
    const initialNodePosition = await node.getAttribute('style')
    await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('25')
    await expect.poll(async () => (await transform()).zoom).toBeCloseTo(0.25, 2)
    await page.locator('button[title^="切到抓手模式"]').click()
    const before = await transform()
    await page.mouse.move(100, 650)
    await page.mouse.down()
    await page.mouse.move(220, 730, { steps: 10 })
    await page.mouse.up()
    await expect.poll(async () => (await transform()).x - before.x).toBeCloseTo(120, 0)
    await expect.poll(async () => (await transform()).y - before.y).toBeCloseTo(80, 0)
    expect(await node.getAttribute('style')).toBe(initialNodePosition)
    await page.screenshot({ path: testInfo.outputPath('low-zoom-panned.png') })
    await page.getByRole('button', { name: '复位视图', exact: true }).click()
    await expect
      .poll(async () => {
        const box = await node.boundingBox()
        return box ? Math.abs(box.x + box.width / 2 - width / 2) : Infinity
      })
      .toBeLessThan(5)
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
