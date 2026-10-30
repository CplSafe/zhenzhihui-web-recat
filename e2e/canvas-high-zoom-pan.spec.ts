import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('高倍率拖动画布时图片节点保持挂载且视口可平移', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/canvases/952**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'high-zoom-image',
                kind: 'node',
                payload: {
                  id: 'high-zoom-image',
                  type: 'image',
                  position: { x: 0, y: 0 },
                  style: { width: 320, height: 240 },
                  data: {
                    kind: 'image',
                    title: '高倍率拖动图像',
                    resultUrl:
                      'data:image/svg+xml,' +
                      encodeURIComponent(
                        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#b8c2cc"/><circle cx="160" cy="120" r="90" fill="#65758b"/></svg>',
                      ),
                  },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 952, title: '高倍率拖动闪烁验收', revision: 1 },
    }),
  )
  await page.goto('/canvas/952')

  const image = page.locator('.react-flow__node[data-id="high-zoom-image"] img')
  await expect(image).toBeVisible()
  await expect(image).toHaveJSProperty('complete', true)
  await page.getByRole('combobox', { name: '画布缩放' }).selectOption('1600')
  await expect(page.locator('.react-flow__viewport')).toHaveCSS('transform', /matrix\(16,/)
  await page.getByRole('button', { name: '拖动', exact: true }).click({ force: true })

  const viewport = page.locator('.react-flow__viewport')
  const before = await viewport.evaluate((element) => getComputedStyle(element).transform)
  const imageElement = await image.elementHandle()
  await page.evaluate((element) => {
    ;(window as any).__canvasPanImage = element
  }, imageElement)
  const bounds = await page.locator('.react-flow__pane').boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2 + 80, { steps: 6 })
  await page.mouse.up()

  await expect.poll(() => viewport.evaluate((element) => getComputedStyle(element).transform)).not.toBe(before)
  expect(
    await page.evaluate(
      () =>
        (window as any).__canvasPanImage === document.querySelector('.react-flow__node[data-id="high-zoom-image"] img'),
    ),
  ).toBe(true)

  await page.getByRole('button', { name: '拖动', exact: true }).click({ force: true })
  await page.getByRole('combobox', { name: '画布缩放' }).selectOption('100')
  await expect(page.locator('.react-flow__viewport')).toHaveCSS('transform', /matrix\(1,/)
  const zoomControl = page.getByRole('combobox', { name: '画布缩放' })
  await page.locator('.react-flow__pane').dispatchEvent('wheel', {
    deltaY: -1200,
    deltaMode: 0,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })
  await expect(zoomControl).toHaveValue('112')

  await zoomControl.selectOption('100')
  await expect(page.locator('.react-flow__viewport')).toHaveCSS('transform', /matrix\(1,/)
  const node = page.locator('.react-flow__node[data-id="high-zoom-image"]')
  const beforeNodePosition = await node.getAttribute('style')
  const imageBounds = await image.boundingBox()
  expect(imageBounds).not.toBeNull()
  await page.mouse.move(imageBounds!.x + imageBounds!.width / 2, imageBounds!.y + imageBounds!.height / 2)
  await page.mouse.down()
  await page.mouse.move(imageBounds!.x + imageBounds!.width / 2, imageBounds!.y + imageBounds!.height / 2 - 80, {
    steps: 6,
  })
  await page.mouse.up()
  await expect.poll(() => node.getAttribute('style')).not.toBe(beforeNodePosition)
  await page.screenshot({ path: test.info().outputPath('canvas-high-zoom-pan.png') })
  expectNoUnexpectedApi(api)
})
