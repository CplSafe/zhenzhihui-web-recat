import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 760, height: 640 },
]) {
  test(`真人素材提示不被滚动面板裁切 ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const state = await installStrictAuthenticatedApp(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: 42,
              display_name: 'Seedance 2.0',
              capability: 'video',
              operation_codes: ['video.generate'],
            },
          ],
        },
      }),
    )
    await page.route('**/api/v1/real-people?**', (route) => route.fulfill({ json: { data: [] } }))
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
                        type: 'video',
                        position: { x: 300, y: 150 },
                        style: { width: 320, height: 240 },
                        data: { kind: 'video', modelVersionId: 42, prompt: '参考人物生成视频' },
                      },
                    },
                  ],
                  sync_revision: 1,
                  history_floor_revision: 0,
                  has_more: false,
                }
              : { id: 119, title: '真人引导布局检查', revision: 1 },
      }),
    )
    await page.goto('/canvas/119')
    // Apply the clipping layout before the hint mounts, so its anchor is measured
    // in the same layout that will be shown to the user.
    await page.addStyleTag({
      content: `
      [data-canvas-node-panel] {
        overflow: auto !important;
        max-height: 320px !important;
      }
    `,
    })
    await page.locator('.react-flow__node[data-id="source"]').click()
    const editor = page.locator('[data-canvas-node-panel]')
    await expect(editor).toBeVisible()
    const hint = page.getByRole('button', { name: '使用已认证真人素材', exact: true })
    await expect(hint).toBeVisible()
    expect(await hint.evaluate((element) => element.closest('[data-canvas-node-panel]') === null)).toBe(true)
    await expect(async () => {
      const box = (await hint.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
      const anchor = (await editor.getByRole('button', { name: '添加参考', exact: true }).boundingBox())!
      expect(Math.abs(box.x - anchor.x)).toBeLessThanOrEqual(24)
      expect(Math.abs(box.y + box.height - anchor.y)).toBeLessThanOrEqual(24)
      expect(
        await hint.evaluate((element) => {
          const box = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        }),
      ).toBe(true)
    }).toPass()
    await page.screenshot({ path: testInfo.outputPath('real-person-hint.png') })
    await hint.click()
    await expect(page.getByText('真人素材库', { exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '搜索素材名称' })).toBeVisible()
    await expect(hint).toBeHidden()
    expect(errors).toEqual([])
    expect(state.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(state)
  })
}
