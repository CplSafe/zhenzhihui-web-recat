import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`画布右键菜单深灰背景与关闭操作 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/canvases/112**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
          : { id: 112, title: '菜单验收', status: 'active', revision: 1 },
      }),
    )
    await page.goto('/canvas/112')
    const pane = page.locator('.react-flow__pane')
    await expect(pane).toBeVisible()
    await pane.click({ button: 'right', position: { x: width < 760 ? 5 : width / 2, y: 500 } })
    const menu = page.locator('.canvas-context-menu')
    await expect(menu).toBeVisible()
    await expect(menu).toHaveCSS('background-color', 'rgb(38, 38, 38)')
    await expect(menu).toHaveCSS('opacity', '1')
    await expect(menu.getByRole('button', { name: '文本节点' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('context-menu.png') })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    expectNoUnexpectedApi(api)
  })
}
