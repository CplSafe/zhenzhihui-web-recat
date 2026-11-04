import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`画布制作费用确认使用深色主题 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: 42,
              display_name: '测试视频模型',
              capability: 'video',
              operation_codes: ['video.generate'],
              params_schema: { fields: [{ name: 'ratio', options: ['16:9'], default: '16:9' }] },
            },
          ],
        },
      }),
    )
    await page.route('**/api/v1/canvases/125**', (route) =>
      route.fulfill({
        json:
          route.request().method() === 'PATCH'
            ? { revision: 2, sync_revision: 2 }
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
                          title: '视频节点',
                          modelVersionId: 42,
                          operationCode: 'video.generate',
                          prompt: '一只小猫走过花园',
                        },
                      },
                    },
                  ],
                  sync_revision: 1,
                  history_floor_revision: 0,
                  has_more: false,
                }
              : { id: 125, title: '费用确认验收', revision: 1 },
      }),
    )
    await page.route('**/api/v1/ai/tasks/estimate-cost', (route) =>
      route.fulfill({ json: { estimated_cost: 10, balance: 9000, can_afford: true } }),
    )
    const submissions: unknown[] = []
    await page.route('**/api/v1/ai/tasks', (route) => {
      submissions.push(route.request().postDataJSON())
      return route.fulfill({ status: 400, json: { message: '模拟提交失败' } })
    })
    await page.goto('/canvas/125')
    await page.locator('.react-flow__node[data-id="video"]').click()
    const send = page.locator('[data-canvas-node-panel] [data-canvas-generate]')
    await expect(send).toBeEnabled()
    await expect(page.getByText('预计消耗：10 积分', { exact: true })).toBeVisible()
    await send.click()
    const dialog = page.getByRole('alertdialog', { name: '确认制作费用' })
    await expect(dialog).toBeVisible()
    await page.setViewportSize({ width, height: 900 })
    await expect(dialog).toContainText('预计消耗 10 积分')
    await expect(dialog.locator('.confirm-dialog')).toHaveCSS('background-color', 'rgb(38, 38, 38)')
    await expect(dialog.getByRole('button', { name: '再想想' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '继续制作' })).toBeVisible()
    expect(submissions).toHaveLength(0)
    await page.screenshot({ path: testInfo.outputPath('canvas-cost-confirm.png') })
    await dialog.getByRole('button', { name: '再想想' }).click()
    await expect(dialog).toBeHidden()
    expect(submissions).toHaveLength(0)
    await page.setViewportSize({ width: 1440, height: 900 })
    await send.click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '继续制作' }).click()
    await expect.poll(() => submissions.length).toBe(1)
    expect(submissions[0]).toMatchObject({ workspace_id: WORKSPACE_ID, operation_code: 'video.generate' })
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
