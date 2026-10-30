import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('画布底部工具栏按指针距离抬升图标且保留按钮交互', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/canvases/126**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 126, title: '工具栏动效验收', revision: 1 },
    }),
  )
  await page.goto('/canvas/126')

  const toolbar = page.locator('.canvas-view').getByRole('button', { name: /拖动/ })
  await expect(toolbar).toBeVisible()
  const glyph = toolbar.locator('[class*="toolGlyph"]')
  await toolbar.hover()
  await expect(glyph).not.toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  await expect(toolbar).toHaveCSS('transform', 'none')
  await expect(toolbar.locator('[class*="toolLabel"]')).toHaveCSS('opacity', '1')
  const addButton = page.getByRole('button', { name: '添加节点' })
  const keyboardButton = page.getByRole('button', { name: '打开快捷键说明' })
  await expect(keyboardButton.locator('[class*="keyboardGlyph"]')).toHaveCSS('font-size', '20px')
  await expect(page.locator('.canvas-view').locator('[class*="toolbar"]').first()).toHaveCSS('position', 'absolute')
  await expect(addButton.locator('xpath=..')).toHaveCSS('position', 'relative')
  await addButton.hover()
  for (const toolGlyph of await page.locator('.canvas-view [class*="toolGlyph"]').all()) {
    await expect(toolGlyph).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  }
  const keyboardGlyph = keyboardButton.locator('[class*="toolGlyph"]')
  await keyboardButton.hover()
  await expect(keyboardGlyph).not.toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  await toolbar.hover()
  await expect(glyph).not.toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  await expect(addButton).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('canvas-floating-toolbar-dock-hover.png') })
  await toolbar.click()
  await expect(toolbar).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: test.info().outputPath('canvas-floating-toolbar-dock.png') })
  expectNoUnexpectedApi(api)
})
