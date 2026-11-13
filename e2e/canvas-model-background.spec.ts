import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const kind of ['image', 'video'] as const) {
  for (const width of [1440, 390]) {
    test(`${kind} 模型列表保持紧凑并兼容深色图标 ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await installStrictAuthenticatedApp(page)
      await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
      await page.route('**/api/v1/ai/models**', (route) =>
        route.fulfill({
          json: {
            data: Array.from({ length: 12 }, (_, index) => ({
              id: 42 + index,
              display_name: index === 0 ? '深色图标模型' : `模型 ${index}`,
              capability: kind,
              operation_codes: [kind === 'image' ? 'image.text_to_image' : 'video.generate'],
              ...(index < 2 ? { logo_url: '/test-model-logo.svg' } : {}),
              description: index === 1 ? '目录中的模型说明' : '',
            })),
          },
        }),
      )
      await page.route('**/test-model-logo.svg', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="9" fill="black"/></svg>',
        }),
      )
      await page.route('**/api/v1/canvases/119**', (route) =>
        route.fulfill({
          json:
            route.request().method() === 'PATCH'
              ? { revision: 2 }
              : new URL(route.request().url()).pathname.endsWith('/elements')
                ? {
                    elements: [
                      {
                        element_id: 'source',
                        kind: 'node',
                        op: 'upsert',
                        payload: {
                          id: 'source',
                          type: kind,
                          position: { x: 300, y: 150 },
                          style: { width: 250, height: 250 },
                          data: { kind, modelVersionId: 42, prompt: '模型测试' },
                        },
                      },
                    ],
                    sync_revision: 1,
                    history_floor_revision: 0,
                    has_more: false,
                  }
                : { id: 119, title: '模型测试', revision: 1 },
        }),
      )
      await page.goto('/canvas/119')
      await page.locator('.react-flow__node[data-id="source"]').click()
      const trigger = page
        .locator('[data-canvas-node-panel]')
        .getByRole('button', { name: '深色图标模型', exact: true })
      await trigger.click()
      const menu = page.getByRole('listbox', { name: '生成模型列表' })
      const option = menu.getByRole('option', { name: '深色图标模型' })
      await expect(menu).toBeVisible()
      await expect(option.locator('img')).toHaveCSS('background-color', 'rgb(245, 246, 246)')
      await expect(option).toHaveCSS('height', '52px')
      await expect(menu).toHaveCSS('color-scheme', 'dark')
      expect(await menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${kind}-models-${width}.png`) })
      await menu.getByRole('option', { name: '模型 1', exact: true }).click()
      await expect(
        page.locator('[data-canvas-node-panel]').getByRole('button', { name: '模型 1', exact: true }),
      ).toBeVisible()
    })
  }
}
