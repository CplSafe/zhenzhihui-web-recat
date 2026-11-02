import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('素材库弹窗中的卡片边框在深色底上清楚可见', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/assets?**', (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    return route.fulfill({
      json: {
        items: [
          { id: 751, name: '春日素材', type: 'image', source: 'upload', mime_type: 'image/webp', size_bytes: 19456 },
          { id: 752, name: '产品特写', type: 'image', source: 'generated', mime_type: 'image/webp', size_bytes: 30208 },
          { id: 753, name: '场景参考', type: 'image', source: 'upload', mime_type: 'image/webp', size_bytes: 26624 },
        ],
        total: 3,
      },
    })
  })
  await page.route('**/api/v1/assets/*/download?**', (route) =>
    route.fulfill({ path: 'src/assets/login-hero.webp', contentType: 'image/webp' }),
  )

  await page.goto('/canvas/222')
  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 420, y: 360 } })
  await page.locator('.canvas-context-menu').getByRole('button', { name: '素材库', exact: true }).click()
  const cards = page.locator('.canvas-material-picker-grid [class*="modalCard"]')
  await expect(cards).toHaveCount(3)
  await expect(cards.first()).toHaveCSS('border-top-width', '2px')
  await expect(cards.first()).toHaveCSS('border-top-color', 'rgba(229, 231, 235, 0.34)')
  await page.screenshot({ path: testInfo.outputPath('canvas-material-picker-border.png'), fullPage: true })
  expectNoUnexpectedApi(api)
})
