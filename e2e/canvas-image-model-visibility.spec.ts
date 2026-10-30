import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  for (const hasAlternative of [true, false]) {
    test(`普通图片节点排除 Qwen Edit 2.0 ${width} 替代模型=${hasAlternative}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 })
      const api = await installStrictAuthenticatedApp(page)
      const errors: string[] = []
      const quotes: Record<string, any>[] = []
      const submissions: Record<string, any>[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.addInitScript(() => {
        localStorage.setItem('zzh_canvas_last_models', JSON.stringify({ image: 42, 'image:image.image_to_image': 42 }))
      })
      await page.route('**/api/v1/ai/tools?**', (route) =>
        route.fulfill({
          json: {
            data: [
              {
                code: 'image.multi_angle',
                display_name: '多角度',
                version: 2,
                execution: 'prompt_workflow',
                operation_code: 'image.multi_angle',
                model_version_ids: [42],
                min_input_images: 1,
                max_input_images: 1,
                params_schema: { fields: [] },
              },
            ],
          },
        }),
      )
      await page.route('**/api/v1/ai/models**', (route) => {
        const operation = new URL(route.request().url()).searchParams.get('operation_code')
        const imageOperation = operation === 'image.image_to_image' || operation === 'image.text_to_image'
        return route.fulfill({
          json: {
            data: imageOperation
              ? [
                  {
                    id: 42,
                    display_name: 'Qwen edit 2.0',
                    model_code: 'qwen-image-edit-2.0',
                    operation_codes: ['image.image_to_image'],
                  },
                  ...(hasAlternative
                    ? [
                        {
                          id: 43,
                          display_name: '可用图片模型',
                          operation_codes: ['image.text_to_image', 'image.image_to_image'],
                          params_schema: {
                            fields: [{ name: 'guidance_scale', type: 'integer', default: 7, min: 0, max: 999 }],
                          },
                        },
                      ]
                    : []),
                ]
              : operation === 'image.multi_angle'
                ? [{ id: 42, display_name: 'Qwen edit 2.0', operation_codes: ['image.multi_angle'] }]
                : [],
          },
        })
      })
      await page.route('**/api/v1/ai/tasks/estimate-cost', (route) => {
        quotes.push(route.request().postDataJSON())
        return route.fulfill({ json: { estimated_cost: 100, balance: 9000, can_afford: true } })
      })
      await page.route('**/api/v1/ai/tasks', (route) => {
        submissions.push(route.request().postDataJSON())
        return route.fulfill({ status: 400, json: { message: '模拟生成失败，保留输入' } })
      })
      await page.route('**/api/v1/assets?**', (route) =>
        route.fulfill({
          json: { items: [{ id: 701, type: 'image', workspace_id: WORKSPACE_ID, status: 'active' }], total: 1 },
        }),
      )
      await page.route('**/api/v1/assets/*/download?**', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#a5b6b0"/></svg>',
        }),
      )
      const node = (id: string, x: number, data: Record<string, unknown>) => ({
        element_id: id,
        kind: 'node',
        payload: {
          id,
          type: 'image',
          position: { x, y: 100 },
          style: { width: 240, height: 200 },
          data: { kind: 'image', ...data },
        },
      })
      await page.route('**/api/v1/canvases/126**', (route) =>
        route.fulfill({
          json:
            route.request().method() === 'PATCH'
              ? { revision: 2 }
              : new URL(route.request().url()).pathname.endsWith('/elements')
                ? {
                    elements: [
                      node('source', 50, { assetId: 701, assetWorkspaceId: WORKSPACE_ID, title: '参考图片' }),
                      node('old', 400, {
                        title: '旧图生图节点',
                        modelVersionId: 42,
                        params: { guidance_scale: 888 },
                        prompt: '保留参考人物',
                      }),
                      node('fresh', 750, { title: '新图片节点', prompt: '保留参考人物' }),
                      {
                        element_id: 'fresh-ref',
                        kind: 'edge',
                        payload: {
                          id: 'fresh-ref',
                          source: 'source',
                          target: 'fresh',
                          sourceHandle: 'source-right-source',
                          targetHandle: 'fresh-left-target',
                        },
                      },
                      {
                        element_id: 'ref',
                        kind: 'edge',
                        payload: {
                          id: 'ref',
                          source: 'source',
                          target: 'old',
                          sourceHandle: 'source-right-source',
                          targetHandle: 'old-left-target',
                        },
                      },
                    ],
                    sync_revision: 1,
                    history_floor_revision: 0,
                    has_more: false,
                  }
                : { id: 126, title: '图片模型可见性验证', revision: 1 },
        }),
      )
      await page.goto('/canvas/126')
      const panel = page.locator('[data-canvas-node-panel]')
      const generate = panel.locator('[data-canvas-generate]')
      // 无参考图时仍走文生图，接图的新节点也不会采用记忆的 Qwen。
      await page.locator('.react-flow__node[data-id="source"] .canvas-node-header').click()
      const nodeToolbar = page.getByRole('toolbar', { name: '节点操作', exact: true })
      await expect(nodeToolbar).toBeVisible()
      await expect.poll(() => nodeToolbar.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
      for (const label of ['重命名节点', '下载素材', '多角度', '删除节点']) {
        await expect(nodeToolbar.getByRole('button', { name: label })).toBeVisible()
      }
      if (width === 390) await page.screenshot({ path: testInfo.outputPath('image-node-toolbar-no-scroll-mobile.png') })
      await expect(
        panel.getByRole('button', {
          name: hasAlternative ? '可用图片模型' : '暂无可用的文生图模型',
          exact: true,
        }),
      ).toBeVisible()
      await page.locator('.react-flow__node[data-id="fresh"] .canvas-node-header').click()
      await expect(
        panel.getByRole('button', {
          name: hasAlternative ? '可用图片模型' : '暂无可用的图生图模型',
          exact: true,
        }),
      ).toBeVisible()
      if (hasAlternative) await expect(generate).toBeEnabled()
      else await expect(generate).toBeDisabled()
      await page.locator('.react-flow__node[data-id="old"] .canvas-node-header').click()
      await expect(generate).toBeDisabled()
      await expect(panel.getByText('Qwen edit 2.0', { exact: true })).toHaveCount(0)
      if (hasAlternative) {
        await panel.getByRole('button', { name: '原模型已不支持普通图片节点，请重新选择', exact: true }).click()
        await expect(page.getByText('Qwen edit 2.0', { exact: true })).toHaveCount(0)
        await page.screenshot({ path: testInfo.outputPath('reselect-model.png') })
        await page.getByRole('option', { name: /可用图片模型/ }).click()
        await expect(generate).toBeEnabled()
        await generate.click()
        const confirmation = page.getByRole('alertdialog', { name: '确认生成费用' })
        await expect.poll(async () => submissions.length > 0 || (await confirmation.isVisible())).toBe(true)
        if (await confirmation.isVisible()) await confirmation.getByRole('button', { name: '继续生成' }).click()
        await expect.poll(() => submissions.length).toBe(1)
        expect(submissions[0]).toMatchObject({
          model_version_id: 43,
          operation_code: 'image.image_to_image',
          params: { guidance_scale: 7 },
        })
        expect(submissions[0].input_assets).toContainEqual({ asset_id: 701, role: 'reference_image' })
      } else {
        await expect(panel.getByRole('button', { name: '暂无可用的图生图模型', exact: true })).toBeVisible()
        expect(submissions).toHaveLength(0)
      }
      expect(quotes.every((quote) => quote.model_version_id !== 42)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath('ordinary-image-models.png') })
      if (hasAlternative && width === 1440) {
        await page.locator('.react-flow__node[data-id="source"] .canvas-node-header').click()
        await page.getByRole('button', { name: '多角度', exact: true }).click()
        const tool = page.getByRole('dialog')
        await expect(tool.getByRole('button', { name: '生成新图片' })).toBeEnabled()
        await expect
          .poll(() =>
            quotes.some((quote) => quote.model_version_id === 42 && quote.operation_code === 'image.multi_angle'),
          )
          .toBe(true)
        await page.screenshot({ path: testInfo.outputPath('qwen-tool-preserved.png') })
        await tool.getByRole('button', { name: '生成新图片' }).click()
        await expect.poll(() => submissions.length).toBe(2)
        expect(submissions[1]).toMatchObject({ model_version_id: 42, operation_code: 'image.multi_angle' })
      }
      expect(errors).toEqual([])
      expectNoUnexpectedApi(api)
    })
  }
}
