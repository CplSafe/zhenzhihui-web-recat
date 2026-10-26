import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const mode of ['generate', 'edit'] as const) {
  test(`参考视频按${mode}提交，编辑时移除固定比例与时长`, async ({ page }, testInfo) => {
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
                  { name: 'ratio', display_name: '比例', options: ['16:9', '21:9'], default: '21:9' },
                  { name: 'generate_audio', display_name: '自动生成背景音', type: 'bool', default: false },
                ],
              },
            },
          ],
        },
      }),
    )
    let canvasRevision = 1
    await page.route('**/api/v1/canvases/125**', (route) =>
      route.fulfill({
        json:
          route.request().method() === 'PATCH'
            ? { revision: ++canvasRevision, sync_revision: canvasRevision }
            : new URL(route.request().url()).pathname.endsWith('/elements')
              ? {
                  elements:
                    Number(new URL(route.request().url()).searchParams.get('after_revision') || 0) > 0
                      ? []
                      : [
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
                                params: { mode: 'generate', duration: 5, generate_audio: false },
                                prompt: '将音频全量合成进视频里，替换掉原视频的音频',
                              },
                            },
                          },
                        ],
                  sync_revision: canvasRevision,
                  history_floor_revision: 0,
                  has_more: false,
                }
              : { id: 125, title: '视频任务类型验证', revision: 1 },
      }),
    )
    const submissions: Record<string, any>[] = []
    await page.route('**/api/v1/ai/tasks/estimate-cost', (route) =>
      route.fulfill({ json: { estimated_cost: 10, balance: 9000, can_afford: true } }),
    )
    await page.route('**/api/v1/ai/tasks', async (route) => {
      submissions.push(route.request().postDataJSON())
      // 明确的业务拒绝；503 属于结果不确定的提交，不能用它断言立即恢复重试按钮。
      await route.fulfill({ status: 400, json: { message: '模拟提交失败，保留输入以便重试' } })
    })
    await page.goto('/canvas/125')
    await expect(page.locator('.react-flow__node[data-id="video"]')).toBeVisible()
    await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('100')
    await expect
      .poll(() =>
        page.locator('.react-flow__viewport').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a),
      )
      .toBe(1)
    await page.locator('.react-flow__node[data-id="video"]').click()
    const panel = page.locator('[data-canvas-node-panel]')
    const send = panel.locator('[data-canvas-generate]')
    await expect(send).toBeEnabled()
    await expect(page.getByText('当前描述是在修改原视频', { exact: false })).toHaveCount(0)
    await panel.getByRole('button', { name: /全能参考|自由生成/ }).click()
    const menu = page.getByRole('region', { name: '生成参数' })
    await expect(page.getByText(/自动生成背景音|有背景音|无背景音/)).toHaveCount(0)
    await expect(menu.getByText('生成声音', { exact: true })).toBeVisible()
    await expect(menu.getByRole('button', { name: '无声音', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(menu.getByText('任务类型', { exact: true })).toBeVisible()
    await menu.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(panel.getByRole('button', { name: /比例时长跟随原视频/ })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('edit-option-retained.png') })
    if (mode === 'generate') await menu.getByRole('button', { name: '生成', exact: true }).click()
    await menu.getByRole('button', { name: '关闭生成参数' }).click()
    await expect(send).toBeEnabled()
    await expect(panel.getByText('预计消耗：约0.2元', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('keyword-generation-enabled.png') })
    await send.click()
    const costDialog = page.getByRole('alertdialog', { name: '确认生成费用' })
    await expect(costDialog).toContainText('预计消耗 约0.2元')
    expect(submissions).toHaveLength(0)
    await page.screenshot({ path: testInfo.outputPath('yuan-cost-confirmation.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(costDialog.getByRole('button', { name: '继续生成' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('yuan-cost-confirmation-narrow.png') })
    await costDialog.getByRole('button', { name: '继续生成' }).click()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect.poll(() => submissions.length).toBe(1)
    expect(submissions[0]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      operation_code: 'video.generate',
      params: { mode, generate_audio: false },
    })
    if (mode === 'edit') {
      expect(submissions[0].params).not.toHaveProperty('ratio')
      expect(submissions[0].params).not.toHaveProperty('duration')
    } else {
      expect(submissions[0].params).toMatchObject({ ratio: '21:9', duration: 5 })
    }
    expect(submissions[0].prompt).toContain('替换掉原视频的音频')
    expect(submissions[0].input_assets).toContainEqual({ asset_id: 601, role: 'video' })
    await expect(page.getByText('模拟提交失败，保留输入以便重试', { exact: false }).first()).toBeVisible()
    await expect(send).toBeEnabled()
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
