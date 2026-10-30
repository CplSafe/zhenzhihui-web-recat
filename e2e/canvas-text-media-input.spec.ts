import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('文本节点连接视频时提示当前不支持，并阻止分镜请求', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 21,
            display_name: 'E2E 多模态分镜模型',
            capability: 'text',
            operation_codes: ['responses.multimodal'],
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/assets/**', (route) => route.fulfill({ status: 404, body: '' }))
  await page.route('**/api/v1/ai/tasks/estimate-cost', (route) =>
    route.fulfill({ json: { estimated_cost: 8, balance: 9000, can_afford: true } }),
  )

  let responseSubmissions = 0
  await page.route('**/api/v1/ai/responses**', async (route) => {
    if (route.request().method() === 'POST') responseSubmissions += 1
    await route.fulfill({ status: 400, json: { message: '本用例不应提交分镜任务' } })
  })
  await page.route('**/api/v1/canvases/178**', (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements:
              Number(url.searchParams.get('after_revision') || 0) > 0
                ? []
                : [
                    {
                      element_id: 'text-target',
                      kind: 'node',
                      payload: {
                        id: 'text-target',
                        type: 'text',
                        position: { x: 620, y: 220 },
                        data: { kind: 'text', text: '根据参考素材生成商品分镜' },
                      },
                    },
                    {
                      element_id: 'video-source',
                      kind: 'node',
                      payload: {
                        id: 'video-source',
                        type: 'video',
                        position: { x: 180, y: 220 },
                        data: {
                          kind: 'video',
                          title: '参考视频',
                          assetId: 701,
                          assetWorkspaceId: WORKSPACE_ID,
                          resultUrl: `/api/v1/assets/701/download?workspace_id=${WORKSPACE_ID}`,
                        },
                      },
                    },
                    {
                      element_id: 'video-to-text',
                      kind: 'edge',
                      payload: {
                        id: 'video-to-text',
                        source: 'video-source',
                        target: 'text-target',
                        data: { slotIndex: 0 },
                      },
                    },
                  ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 178, title: '文本节点不支持视频输入', status: 'active', revision: 1 },
    })
  })

  await page.goto('/canvas/178')
  await page.locator('.react-flow__node[data-id="text-target"]').click()
  const panel = page.locator('[data-canvas-node-panel]')
  await expect(panel.getByRole('alert')).toContainText('文本/分镜节点暂不支持视频输入')
  await expect(panel.locator('[data-canvas-generate]')).toBeDisabled()
  expect(responseSubmissions).toBe(0)
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
