import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 760]) {
  test(`生成参数滚动区域使用深色滚动条 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 640 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: 42,
              display_name: '参数测试模型',
              capability: 'image',
              operation_codes: ['image.text_to_image'],
              params_schema: {
                fields: Array.from({ length: 4 }, (_, i) => ({
                  name: `setting_${i}`,
                  display_name: `测试参数${i}`,
                  type: 'string',
                  default: 'A',
                  options: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
                })),
              },
            },
          ],
        },
      }),
    )
    await page.route('**/api/v1/canvases/119**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? {
              elements: [
                {
                  element_id: 'source',
                  kind: 'node',
                  payload: {
                    id: 'source',
                    type: 'image',
                    position: { x: 300, y: 150 },
                    style: { width: 320, height: 240 },
                    data: { kind: 'image', modelVersionId: 42, prompt: '参数检查' },
                  },
                },
              ],
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 119, title: '参数检查', revision: 1 },
      }),
    )
    await page.goto('/canvas/119')
    await page.locator('.react-flow__node[data-id="source"]').click()
    const editor = page.locator('[data-canvas-node-panel]')
    await editor.locator('button[aria-expanded]').last().click()
    const menu = page.getByRole('region', { name: '生成参数', exact: true })
    await expect(menu).toBeVisible()
    const grid = menu.locator('[class*="schemaMenuGrid"]')
    await expect(grid).toHaveCSS('scrollbar-width', 'thin')
    expect(await grid.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('parameter-scrollbar.png') })
    await grid.hover()
    await page.mouse.wheel(0, 500)
    await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await menu.getByRole('button', { name: 'F', exact: true }).last().click()
    await menu.getByRole('button', { name: '关闭生成参数' }).click()
    await expect(menu).toBeHidden()
  })
}
