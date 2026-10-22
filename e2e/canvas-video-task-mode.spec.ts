import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('替换音频提示词可以按生成提交，同时保留编辑任务类型', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/assets', (route) => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toMatchObject({ workspace_id: WORKSPACE_ID, source: 'canvas-poster' })
    return route.fulfill({ status: 503, json: { message: '测试环境不保存封面' } })
  })
  await page.route('**/api/v1/assets?**', (route) =>
    route.fulfill({
      json: { items: [{ id: 601, workspace_id: WORKSPACE_ID, type: 'video', status: 'active' }], total: 1 },
    }),
  )
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 42,
            display_name: 'Seedance 2.0',
            capability: 'video',
            operation_codes: ['video.generate'],
            params_schema: {
              fields: [
                {
                  name: 'mode',
                  display_name: '任务类型',
                  options: ['generate', 'edit', 'extend'],
                  default: 'generate',
                },
                { name: 'duration', display_name: '时长', options: [5, 10], default: 5 },
              ],
            },
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/125**', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'PATCH'
          ? { revision: 2 }
          : new URL(route.request().url()).pathname.endsWith('/elements')
            ? {
                elements: [
                  {
                    element_id: 'video',
                    kind: 'node',
                    payload: {
                      id: 'video',
                      type: 'video',
                      position: { x: 300, y: 100 },
                      style: { width: 320, height: 240 },
                      data: {
                        kind: 'video',
                        title: '替换音频验证',
                        assetId: 601,
                        workspaceId: WORKSPACE_ID,
                        resultUrl: `/api/v1/assets/601/download?workspace_id=${WORKSPACE_ID}`,
                        modelVersionId: 42,
                        operationCode: 'video.generate',
                        params: { mode: 'generate', duration: 5 },
                        prompt: '将音频全量合成进视频里，替换掉原视频的音频',
                      },
                    },
                  },
                ],
                sync_revision: 1,
                history_floor_revision: 0,
                has_more: false,
              }
            : { id: 125, title: '视频任务类型验证', revision: 1 },
    }),
  )
  const submissions: Record<string, any>[] = []
  await page.route('**/api/v1/ai/tasks', async (route) => {
    submissions.push(route.request().postDataJSON())
    await route.fulfill({ status: 503, json: { message: '模拟提交失败，保留输入以便重试' } })
  })
  await page.goto('/canvas/125')
  await page.locator('.react-flow__node[data-id="video"]').click()
  const panel = page.locator('[data-canvas-node-panel]')
  const send = panel.locator('[data-canvas-generate]')
  await expect(send).toBeEnabled()
  await expect(page.getByText('当前描述是在修改原视频', { exact: false })).toHaveCount(0)
  await panel.getByRole('button', { name: /全能参考|自由生成/ }).click()
  const menu = page.getByRole('region', { name: '生成参数' })
  await expect(menu.getByText('任务类型', { exact: true })).toBeVisible()
  await menu.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(panel.getByRole('button', { name: /比例时长跟随原视频/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('edit-option-retained.png') })
  await menu.getByRole('button', { name: '生成', exact: true }).click()
  await menu.getByRole('button', { name: '关闭生成参数' }).click()
  await expect(send).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('keyword-generation-enabled.png') })
  await send.click()
  const costDialog = page.getByRole('alertdialog', { name: '确认生成费用' })
  // 费用预估尚未返回时直接提交；已有报价时先确认，再检查相同的提交断言。
  await expect.poll(async () => submissions.length > 0 || (await costDialog.isVisible())).toBe(true)
  if (await costDialog.isVisible()) await costDialog.getByRole('button', { name: '继续生成' }).click()
  await expect.poll(() => submissions.length).toBe(1)
  expect(submissions[0]).toMatchObject({
    workspace_id: WORKSPACE_ID,
    operation_code: 'video.generate',
    params: { mode: 'generate' },
  })
  expect(submissions[0].prompt).toContain('替换掉原视频的音频')
  expect(submissions[0].input_assets).toContainEqual({ asset_id: 601, role: 'video' })
  await expect(page.getByText('模拟提交失败，保留输入以便重试', { exact: false }).first()).toBeVisible()
  await expect(send).toBeEnabled()
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})
