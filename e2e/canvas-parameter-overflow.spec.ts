import { expect, test } from '@playwright/test'
import { waitForCanvasViewportToSettle } from './fixtures/canvas-viewport'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const kind of ['image', 'video']) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 760, height: 640 },
  ]) {
    test(`${kind} parameters escape editor clipping at ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await installStrictAuthenticatedApp(page)
      await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/api/v1/ai/models**', (route) =>
        route.fulfill({
          json: {
            data: [
              {
                id: 42,
                display_name: '布局测试模型',
                capability: kind,
                operation_codes: [
                  kind === 'image'
                    ? 'image.text_to_image'
                    : kind === 'text'
                      ? 'responses.multimodal'
                      : 'video.generate',
                ],
                params_schema: {
                  fields: [
                    {
                      name: 'aspect_ratio',
                      display_name: '画面比例',
                      type: 'string',
                      default: '1:1',
                      options: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
                    },
                    ...Array.from({ length: kind === 'image' ? 0 : 7 }, (_, i) => ({
                      name: `setting_${i}`,
                      display_name: `测试参数${i}`,
                      type: 'string',
                      default: 'A',
                      options: ['A', 'B'],
                    })),
                  ],
                },
              },
              ...Array.from({ length: 14 }, (_, i) => ({
                id: 100 + i,
                display_name: `备选模型${i}，用于验证长名称与列表滚动`,
                operation_codes: [
                  kind === 'image'
                    ? 'image.text_to_image'
                    : kind === 'text'
                      ? 'responses.multimodal'
                      : 'video.generate',
                ],
              })),
            ],
          },
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
                        payload: {
                          id: 'source',
                          type: kind,
                          position: { x: 300, y: 150 },
                          style: { width: 320, height: 240 },
                          data: { kind, modelVersionId: 42, prompt: '布局检查', params: { aspect_ratio: '1:1' } },
                        },
                      },
                    ],
                    sync_revision: 1,
                    history_floor_revision: 0,
                    has_more: false,
                  }
                : { id: 119, title: '参数布局检查', revision: 1 },
        }),
      )
      await page.route('**/api/v1/canvases/119/node-locks**', (route) =>
        route.fulfill({ json: { granted: true, nodes: {} } }),
      )
      await page.goto('/canvas/119')
      const node = page.locator('.react-flow__node[data-id="source"]')
      if (viewport.width === 760) {
        // Move the node up so its anchored editor keeps the trigger buttons within reach.
        await expect(node).toBeInViewport()
        await waitForCanvasViewportToSettle(page.locator('.react-flow__viewport'))
        const bounds = (await node.boundingBox())!
        const targetBottom = 230
        const deltaY = Math.round(targetBottom - bounds.y - bounds.height)
        const dragX = viewport.width - 24
        const dragY = deltaY < 0 ? viewport.height - 90 : 90
        await page.mouse.move(dragX, dragY)
        await page.mouse.down({ button: 'middle' })
        await page.mouse.move(dragX, dragY + deltaY, { steps: 8 })
        await page.mouse.up({ button: 'middle' })
        await expect
          .poll(async () => {
            const current = (await node.boundingBox())!
            return Math.abs(current.y + current.height - targetBottom)
          })
          .toBeLessThan(4)
      }
      await node.click()
      const editor = page.locator('[data-canvas-node-panel]')
      await expect(editor).toBeVisible()
      // Clip overflowing children while keeping the editor in its normal canvas layout.
      await editor.evaluate((element) => {
        element.style.overflow = 'auto'
        element.style.maxHeight = '320px'
      })
      const trigger = editor.locator('button[aria-expanded]').last()
      const modelTrigger = editor.getByRole('button', { name: '布局测试模型', exact: true })
      await modelTrigger.hover()
      const models = page.getByRole('listbox', { name: '生成模型列表' })
      await expect(models).toBeHidden()
      await modelTrigger.click()
      await expect(models).toBeVisible()
      await expect(async () => {
        const box = (await models.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(12)
        expect(box.y).toBeGreaterThanOrEqual(12)
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 12)
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 12)
      }).toPass()
      expect(await models.evaluate((el) => el.closest('[data-canvas-node-panel]') === null)).toBe(true)
      await models.getByRole('option').last().hover()
      await page.screenshot({ path: `test-results/models-${kind}-${viewport.width}.png` })
      await models.getByRole('option').last().click()
      await expect(editor.getByRole('button', { name: /备选模型13/ })).toBeVisible()
      await editor.getByRole('button', { name: /备选模型13/ }).click()
      await page.keyboard.press('Escape')
      await expect(models).toBeHidden()
      await editor.getByRole('button', { name: /备选模型13/ }).click()
      await models.getByRole('option', { name: /布局测试模型/ }).click()
      await trigger.click()
      const menu = page.getByRole('region', { name: '生成参数', exact: true })
      await expect(menu).toBeVisible()
      expect(await menu.evaluate((element) => element.closest('[data-canvas-node-panel]') === null)).toBe(true)
      // Wait for the popover's enter animation and automatic edge alignment.
      await expect(async () => {
        const bounds = (await menu.boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.y).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
      }).toPass()
      await menu.getByRole('button', { name: '16:9', exact: true }).click()
      await expect(trigger).toContainText('16:9')
      await page.screenshot({ path: `test-results/parameters-${kind}-${viewport.width}.png` })
      await menu.getByRole('button', { name: '关闭生成参数' }).click()
      await expect(menu).toBeHidden()
      await trigger.click()
      await expect(menu).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      if (kind !== 'text') {
        const prompt = editor.getByRole('textbox')
        await prompt.fill('')
        await prompt.pressSequentially('@')
        const references = page.getByRole('listbox', { name: '选择要 @ 的参考素材' })
        await expect(references).toBeVisible()
        expect(await references.evaluate((el) => el.closest('[data-canvas-node-panel]') === null)).toBe(true)
        await page.screenshot({ path: `test-results/references-${kind}-${viewport.width}.png` })
        await references.getByRole('button', { name: '从画布选择' }).click()
        await expect(references).toBeHidden()
        await page.keyboard.press('Escape')
      }
      expect(errors).toEqual([])
    })
  }
}
