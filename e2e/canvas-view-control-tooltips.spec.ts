import { expect, test, type Locator } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

async function expectUnobstructed(tooltip: Locator) {
  await expect(tooltip).toBeVisible()
  await expect
    .poll(() =>
      tooltip.evaluate((element) => {
        const { x, y, width, height } = element.getBoundingClientRect()
        return [0.2, 0.8].every((vertical) =>
          [0.2, 0.5, 0.8].every((horizontal) =>
            element.contains(document.elementFromPoint(x + width * horizontal, y + height * vertical)),
          ),
        )
      }),
    )
    .toBe(true)
}

for (const width of [1440, 390]) {
  test(`小地图打开时缩放复位提示完整可见 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(
      (uiSize) => {
        localStorage.setItem('zzh_canvas_minimap_visible', '1')
        localStorage.setItem('zzh_canvas_preferences', JSON.stringify({ uiSize, wheelMode: 'zoom' }))
      },
      width === 1440 ? 'extra-large' : 'standard',
    )
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/canvases/142**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? {
              elements: [
                {
                  element_id: 'note',
                  kind: 'node',
                  payload: {
                    id: 'note',
                    type: 'text',
                    position: { x: 160, y: 150 },
                    style: { width: 240, height: 160 },
                    data: { kind: 'text', title: '提示层级检查', text: '测试节点' },
                  },
                },
              ],
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 142, title: '视图控制验收', revision: 1, status: 'active' },
      }),
    )
    await page.goto('/canvas/142')
    const toolbar = page.getByRole('toolbar', { name: '画布视图控制' })
    const zoom = toolbar.getByRole('button', { name: /当前缩放.*点击回到 100%/ })
    await expect(page.getByRole('img', { name: '画布缩略图' })).toBeVisible()

    await zoom.click()
    await expect(zoom).toHaveText('100%')
    await zoom.blur()
    await page.mouse.move(width / 2, 450)
    await page.mouse.wheel(0, 250)
    await expect(zoom).not.toHaveText('100%')

    await zoom.hover()
    const zoomHint = page.getByRole('tooltip').filter({ hasText: '回到 100%' })
    await expect(page.locator('.ant-tooltip').filter({ has: zoomHint })).toHaveCSS('opacity', '1')
    await expectUnobstructed(zoomHint)
    const mapBox = await page.locator('.canvas-minimap').boundingBox()
    const hintBox = await zoomHint.boundingBox()
    const zoomBox = await zoom.boundingBox()
    if (!mapBox || !hintBox || !zoomBox) throw new Error('小地图、缩放按钮或提示未显示')
    expect(hintBox.x).toBeGreaterThanOrEqual(zoomBox.x + zoomBox.width)
    expect(hintBox.x >= mapBox.x + mapBox.width || hintBox.y >= mapBox.y + mapBox.height).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('zoom-tooltip.png') })

    await page.mouse.move(width / 2, 450)
    await expect(zoomHint).not.toBeVisible()
    await zoom.focus()
    await expectUnobstructed(zoomHint)
    await page.keyboard.press('Enter')
    await expect(zoom).toHaveText('100%')
    await zoom.blur()

    const mapToggle = toolbar.getByRole('button', { name: '小地图' })
    await mapToggle.hover()
    await expectUnobstructed(page.getByRole('tooltip').filter({ hasText: '隐藏小地图' }))
    await mapToggle.click()
    await expect(page.getByRole('img', { name: '画布缩略图' })).toHaveCount(0)
    expectNoUnexpectedApi(api)
  })
}
