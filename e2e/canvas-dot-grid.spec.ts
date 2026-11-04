import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`画布白点在 ${width}px 视口可见`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/canvases/142**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
          : { id: 142, title: '点阵验收', revision: 1, status: 'active' },
      }),
    )
    await page.goto('/canvas/142')
    await expect(page.locator('.canvas-navigation')).toHaveCSS('background-color', 'rgb(38, 38, 38)')
    await expect(page.locator('.canvas-global-actions')).toHaveCSS('background-color', 'rgb(38, 38, 38)')
    const dot = page.locator('.canvas-view .react-flow__background pattern circle')
    await expect(dot).toHaveCount(1)
    await expect(dot).toHaveCSS('fill', 'rgba(255, 255, 255, 0.18)')
    await expect(dot).toHaveAttribute('r', /^(?!0(?:\.0*)?$)/)
    await expect(page.locator('.canvas-view .react-flow__background')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('canvas-dots.png') })
    expectNoUnexpectedApi(api)
  })
}
