import { expect, test } from '@playwright/test'
import {
  expectNoUnexpectedApi,
  installStrictAuthenticatedApp,
  WORKSPACE_ID,
  waitForScopedApiResponse,
} from './fixtures/strict-authenticated-app'

test('画布超分按报价创建新产物，保留源节点、选中新产物并连线', async ({ page }, testInfo) => {
  // 保留完整提交和落盘断言，允许 WebKit 冷加载画布及媒体分片。
  if (testInfo.project.name === 'webkit') test.slow()
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const source = { node_id: 'video-source', asset_id: 12391, kind: 'video' as const, name: '开场镜头.mp4' }
  const estimates: Array<Record<string, unknown>> = []
  let submissions = 0
  const saved: Array<Record<string, unknown>> = []
  // 视频卡片会尝试上传首帧封面；该测试验证封面服务失败也不影响高清产物。
  await page.route('**/api/v1/assets', async (route) => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toMatchObject({ workspace_id: WORKSPACE_ID, source: 'canvas-poster' })
    await route.fulfill({ status: 503, json: { message: '封面上传服务暂不可用' } })
  })
  await page.route('**/api/v1/canvases/120**', async (route) => {
    if (route.request().method() === 'PATCH') {
      saved.push(route.request().postDataJSON())
      await route.fulfill({ json: { revision: 2 } })
      return
    }
    await route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: source.node_id,
                kind: 'node',
                payload: {
                  id: source.node_id,
                  type: 'video',
                  position: { x: 300, y: 200 },
                  style: { width: 320, height: 240 },
                  data: { kind: 'video', assetId: source.asset_id, assetWorkspaceId: WORKSPACE_ID, title: source.name },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 120, title: '超分验证', revision: 1 },
    })
  })
  await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: [
        {
          id: 98,
          enabled: true,
          display_name: '视频超分测试模型',
          operation_codes: ['video.upscale'],
          params_schema: { fields: [{ name: 'scale', type: 'integer', default: 2 }] },
        },
      ],
    }),
  )
  await page.route('**/api/v1/ai/tasks/estimate-cost', (route) => {
    const body = route.request().postDataJSON()
    expect(body).toMatchObject({
      workspace_id: WORKSPACE_ID,
      model_version_id: 98,
      operation_code: 'video.upscale',
      params: { scale: 2 },
      input_assets: [{ asset_id: source.asset_id, role: 'video' }],
    })
    estimates.push(body)
    return route.fulfill({ json: { estimated_cost: 12, balance: 100, can_afford: true } })
  })
  await page.route('**/api/v1/ai/tasks', (route) => {
    const body = route.request().postDataJSON()
    expect(body).toMatchObject({
      workspace_id: WORKSPACE_ID,
      model_version_id: 98,
      operation_code: 'video.upscale',
      params: { scale: 2 },
      input_assets: [{ asset_id: source.asset_id, role: 'video' }],
    })
    expect(body.idempotency_key).toBeTruthy()
    submissions++
    return route.fulfill({ json: { id: 98, status: 'pending' } })
  })
  await page.route('**/api/v1/ai/tasks/98?**', (route) =>
    route.fulfill({
      json: {
        id: 98,
        status: 'succeeded',
        outputs: [
          { asset_id: 12392, type: 'video', url: `/api/v1/assets/12392/download?workspace_id=${WORKSPACE_ID}` },
        ],
      },
    }),
  )
  await page.route('**/api/v1/assets?**', (route) =>
    route.fulfill({
      json: {
        items: [
          { id: source.asset_id, type: 'video', status: 'active', workspace_id: WORKSPACE_ID },
          { id: 12392, type: 'video', status: 'active', workspace_id: WORKSPACE_ID },
        ],
        total: 2,
      },
    }),
  )
  const ready = waitForScopedApiResponse(page, {
    method: 'GET',
    path: '/api/v1/canvases/120/elements',
    workspaceId: WORKSPACE_ID,
  })
  await page.goto('/canvas/120')
  await ready
  const sourceNode = page.locator(`[data-id="${source.node_id}"]`).first()
  await expect(sourceNode).toBeVisible({ timeout: 30_000 })
  await sourceNode.locator('.canvas-node-header').click()
  await expect(sourceNode).toHaveClass(/selected/)
  await page.getByRole('button', { name: '超分', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '超分', exact: true })
  await expect(modal).toContainText('预计 12 积分')
  await expect(modal.getByRole('button', { name: '确认超分' })).toBeEnabled()
  expect(submissions).toBe(0)
  expect(estimates.length).toBeGreaterThan(0)
  await page.screenshot({ path: testInfo.outputPath('canvas-hd-confirm.png') })
  await modal.getByRole('button', { name: '确认超分' }).click()
  await expect(modal).toBeHidden()
  await expect.poll(() => submissions).toBe(1)
  const result = page.locator('.react-flow__node-video').filter({ hasText: `${source.name}超分结果` })
  await expect(result).toBeVisible()
  await expect(result).toHaveClass(/selected/)
  await expect(sourceNode).toContainText(source.name)
  await expect(sourceNode).not.toHaveClass(/selected/)
  await expect.poll(() => JSON.stringify(saved)).toContain('12392')
  const resultId = await result.getAttribute('data-id')
  await expect.poll(() => JSON.stringify(saved)).toContain(`"target":"${resultId}"`)
  expect(JSON.stringify(saved)).toContain('"source":"video-source"')
  expect(JSON.stringify(saved)).toContain('"role":"source_video"')
  expect(submissions).toBe(1)
  await page.getByRole('button', { name: '复位视图', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('canvas-hd-result.png') })
  expectNoUnexpectedApi(api)
})
