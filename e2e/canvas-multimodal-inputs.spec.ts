import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const node = (id: string, kind: string, x: number, y: number, data: Record<string, unknown>) => ({
  element_id: id,
  kind: 'node',
  payload: { id, type: kind, position: { x, y }, style: { width: 240, height: 180 }, data: { kind, ...data } },
})
const edge = (id: string, source: string, target: string, slotIndex: number) => ({
  element_id: id,
  kind: 'edge',
  payload: {
    id,
    source,
    target,
    sourceHandle: `${source}-right-source`,
    targetHandle: `${target}-left-target`,
    data: { slotIndex },
  },
})

test('文本视频与音频图片按模型限制连接，估价使用声明的角色', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) => {
    const query = new URL(route.request().url()).searchParams
    const model =
      query.get('capability') === 'audio'
        ? {
            id: 34,
            display_name: '音频模型',
            operation_codes: ['audio.generate'],
            result_schema: { output_types: ['audio'] },
            input_constraints: {
              'audio.generate': {
                roles: [
                  { role: 'image', max_count: 1 },
                  { role: 'audio', max_count: 1 },
                ],
              },
            },
          }
        : query.get('operation_code') === 'responses.multimodal'
          ? {
              id: 51,
              display_name: '文本模型',
              operation_codes: ['responses.multimodal'],
              input_constraints: {
                'responses.multimodal': {
                  roles: [
                    { role: 'video', max_count: 1 },
                    { role: 'image', max_count: 9 },
                  ],
                },
              },
            }
          : null
    return route.fulfill({ json: { items: model ? [model] : [] } })
  })
  await page.route('**/api/v1/assets?**', (route) =>
    route.fulfill({
      json: {
        items: [701, 702, 703, 704, 705].map((id) => ({ id, status: 'active', workspace_id: WORKSPACE_ID })),
        total: 5,
      },
    }),
  )
  const estimates: any[] = []
  await page.route('**/api/v1/ai/tasks/estimate-cost', (route) => {
    estimates.push(route.request().postDataJSON())
    return route.fulfill({ json: { estimated_cost: 10, balance: 1000, can_afford: true } })
  })
  const elements = [
    node('v1', 'video', 50, 80, { assetId: 701, assetWorkspaceId: WORKSPACE_ID }),
    node('v2', 'video', 50, 330, { assetId: 702, assetWorkspaceId: WORKSPACE_ID }),
    node('text', 'text', 650, 80, { modelVersionId: 51, prompt: '分析视频' }),
    node('i1', 'image', 50, 600, { assetId: 703, assetWorkspaceId: WORKSPACE_ID }),
    node('i2', 'image', 50, 850, { assetId: 704, assetWorkspaceId: WORKSPACE_ID }),
    node('audio', 'audio', 650, 650, {
      modelVersionId: 34,
      operationCode: 'audio.generate',
      prompt: '生成音乐',
      audioReferences: [{ assetId: 705, workspaceId: WORKSPACE_ID }],
    }),
    node('a2', 'audio', 50, 1100, { assetId: 701, assetWorkspaceId: WORKSPACE_ID }),
    edge('v1-text', 'v1', 'text', 0),
    edge('i1-audio', 'i1', 'audio', 0),
  ]
  await page.route('**/api/v1/canvases/199**', (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({
      json:
        route.request().method() === 'PATCH'
          ? { sync_revision: 2 }
          : url.pathname.endsWith('/elements')
            ? {
                elements,
                sync_revision: 1,
                history_floor_revision: 0,
                has_more: false,
              }
            : { id: 199, title: '多模态输入', revision: 1 },
    })
  })
  await page.goto('/canvas/199')
  await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('50')
  await page.locator('.react-flow__node[data-id="text"]').click()
  await expect
    .poll(() =>
      estimates.some(
        (item) =>
          item.operation_code === 'responses.multimodal' &&
          item.input_assets?.some((asset: any) => asset.asset_id === 701 && asset.role === 'video'),
      ),
    )
    .toBe(true)
  const v2 = page.locator('.react-flow__node[data-id="v2"]')
  await v2.hover()
  await v2.locator('.canvas-handle-icon--right').dragTo(page.locator('.react-flow__node[data-id="text"]'))
  await expect(page.getByText(/最多支持 1 条参考视频/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('text-video-limit.png') })
  await page.locator('.react-flow__node[data-id="audio"]').click()
  await expect
    .poll(() =>
      estimates.some(
        (item) =>
          item.operation_code === 'audio.generate' &&
          item.input_assets?.some((asset: any) => asset.asset_id === 703 && asset.role === 'image') &&
          item.input_assets?.some((asset: any) => asset.asset_id === 705 && asset.role === 'audio'),
      ),
    )
    .toBe(true)
  const i2 = page.locator('.react-flow__node[data-id="i2"]')
  await i2.hover()
  await i2.locator('.canvas-handle-icon--right').dragTo(page.locator('.react-flow__node[data-id="audio"]'))
  await expect(page.getByText(/最多支持 1 条参考图片/)).toBeVisible()
  const a2 = page.locator('.react-flow__node[data-id="a2"]')
  await a2.hover()
  await a2.locator('.canvas-handle-icon--right').dragTo(page.locator('.react-flow__node[data-id="audio"]'))
  await expect(page.getByText(/最多支持 1 条参考音频/)).toBeVisible()
  await expect(page.locator('.react-flow__edge')).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('audio-media-limit.png') })
  expect(api.paidTaskSubmissions).toBe(0)
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})
