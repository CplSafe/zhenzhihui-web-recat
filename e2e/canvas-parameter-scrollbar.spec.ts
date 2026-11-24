import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

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
    await page.route('**/api/v1/canvases/119**', (route) => {
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
      return route.fulfill({
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
      })
    })
    await page.route('**/api/v1/canvases/119/node-locks**', (route) =>
      route.fulfill({ json: { granted: true, nodes: {} } }),
    )
    await page.goto('/canvas/119')
    await page.locator('.react-flow__node[data-id="source"]').click()
    const editor = page.locator('[data-canvas-node-panel]')
    await editor.locator('button[aria-expanded]').last().click()
    const menu = page.getByRole('region', { name: '生成参数', exact: true })
    await expect(menu).toBeVisible()
    const surface = menu.locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-popover-inner ")]',
    )
    await expect(surface).toHaveCSS('background-color', 'rgb(38, 38, 38)')
    await expect(menu.getByRole('button', { name: 'A', exact: true }).first()).toHaveCSS(
      'background-color',
      'rgb(38, 38, 38)',
    )
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

for (const width of [1440, 390]) {
  test(`图片生成底栏的模型、参数、风格库同排且完整可点 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    const modelName = 'GPT Image 2.5 Flare 高保真图片生成测试模型'
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: 42,
              display_name: modelName,
              capability: 'image',
              operation_codes: ['image.text_to_image'],
              params_schema: {
                fields: [
                  { name: 'ratio', display_name: '比例', default: '1:1', options: ['1:1', '4:3'] },
                  { name: 'quality', display_name: '画质', default: 'medium', options: ['medium', 'high'] },
                  { name: 'count', display_name: '数量', type: 'integer', default: 1, options: [1, 2] },
                ],
              },
            },
          ],
        },
      }),
    )
    await page.route('**/api/v1/ai/tasks/estimate-cost', (route) =>
      route.fulfill({ json: { estimated_cost: 10, balance: 1000, can_afford: true } }),
    )
    await page.route(/\/api\/v1\/canvases\/243(?:\/(?:elements|node-locks|members))?(?:\?.*)?$/, (route) => {
      const { pathname, searchParams } = new URL(route.request().url())
      if (pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
      if (pathname.endsWith('/members')) {
        return route.fulfill({
          json: { creator_id: 7, can_manage: true, member_user_ids: [], members_restricted: false },
        })
      }
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
      if (pathname.endsWith('/elements')) {
        return route.fulfill({
          json: {
            elements:
              Number(searchParams.get('after_revision')) > 0
                ? []
                : [
                    {
                      element_id: 'image',
                      kind: 'node',
                      payload: {
                        id: 'image',
                        type: 'image',
                        position: { x: 300, y: 150 },
                        style: { width: 220, height: 220 },
                        data: {
                          kind: 'image',
                          title: '已生成的图片',
                          prompt: '一张明亮的电影场景概念图',
                          modelVersionId: 42,
                          ratio: '1:1',
                          params: { ratio: '1:1', quality: 'medium', count: 1 },
                          assetId: 501,
                          assetWorkspaceId: WORKSPACE_ID,
                          resultUrl: '/t1test.png',
                          resultHistory: [{ assetId: 501, kind: 'image', resultUrl: '/t1test.png' }],
                        },
                      },
                    },
                  ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          },
        })
      }
      return route.fulfill({ json: { id: 243, title: '图片底栏排版检查', revision: 1 } })
    })
    await page.route('**/api/v1/assets/501/download**', (route) =>
      route.fulfill({ path: 'public/t1test.png', contentType: 'image/png' }),
    )

    await page.goto('/canvas/243')
    await page.locator('.react-flow__node[data-id="image"] .canvas-node-header').click()
    const panel = page.locator('[data-canvas-node-panel]')
    const footer = panel.locator('[data-canvas-node-panel-actions]')
    const model = footer.getByRole('button', { name: modelName, exact: true })
    const parameters = footer.getByRole('button', { name: '1:1 · 标准画质 · 1张', exact: true })
    const style = footer.getByRole('button', { name: '风格库', exact: true })
    const moderation = footer.getByRole('button', { name: 'Seedance 图片审核' })
    const regenerate = footer.getByRole('button', { name: '重新制作', exact: true })
    await expect(footer.getByText('预计消耗：10 积分')).toBeVisible()
    await expect(regenerate).toBeEnabled()
    await footer.scrollIntoViewIfNeeded()

    const panelBounds = (await panel.boundingBox())!
    expect(panelBounds.x).toBeGreaterThanOrEqual(0)
    expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(width)
    const controls = [model, parameters, style, moderation, regenerate]
    for (const control of controls) {
      await expect(control).toBeInViewport({ ratio: 0.99 })
      expect(
        await control.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
        }),
      ).toBe(true)
    }
    const [modelBounds, parameterBounds, styleBounds] = await Promise.all(
      [model, parameters, style].map(async (control) => (await control.boundingBox())!),
    )
    const middleY = (bounds: { y: number; height: number }) => bounds.y + bounds.height / 2
    expect(Math.abs(middleY(modelBounds) - middleY(parameterBounds))).toBeLessThan(2)
    expect(Math.abs(middleY(modelBounds) - middleY(styleBounds))).toBeLessThan(2)
    expect(modelBounds.x + modelBounds.width).toBeLessThanOrEqual(parameterBounds.x)
    expect(parameterBounds.x + parameterBounds.width).toBeLessThanOrEqual(styleBounds.x)
    await page.screenshot({ path: testInfo.outputPath('image-action-footer.png') })
    await page.mouse.click(parameterBounds.x + parameterBounds.width / 2, middleY(parameterBounds))
    await expect(page.getByRole('region', { name: '生成参数' })).toBeVisible()
    expectNoUnexpectedApi(api)
  })
}
