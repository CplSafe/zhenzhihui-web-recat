import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('Seedance 费用确认后才自动审核素材', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        items: [{ id: 42, display_name: 'Seedance 2.5', capability: 'video', operation_codes: ['video.generate'] }],
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
                    element_id: 'image',
                    kind: 'node',
                    payload: {
                      id: 'image',
                      type: 'image',
                      position: { x: 100, y: 100 },
                      data: { kind: 'image', assetId: 501, assetWorkspaceId: WORKSPACE_ID },
                    },
                  },
                  {
                    element_id: 'video',
                    kind: 'node',
                    payload: {
                      id: 'video',
                      type: 'video',
                      position: { x: 600, y: 100 },
                      data: {
                        kind: 'video',
                        modelVersionId: 42,
                        operationCode: 'video.generate',
                        prompt: '一只小猫走过花园',
                      },
                    },
                  },
                  {
                    element_id: 'edge',
                    kind: 'edge',
                    payload: { id: 'edge', source: 'image', target: 'video', data: { slotIndex: 0 } },
                  },
                ],
                sync_revision: 1,
                history_floor_revision: 0,
                has_more: false,
              }
            : { id: 125, title: '审核顺序', revision: 1 },
    }),
  )
  await page.route('**/api/v1/assets/501/download**', (route) => route.fulfill({ status: 404, body: '' }))
  let releaseEstimate!: () => void
  const estimateWait = new Promise<void>((resolve) => {
    releaseEstimate = resolve
  })
  let estimates = 0
  await page.route('**/api/v1/ai/tasks/estimate-cost', async (route) => {
    estimates++
    await estimateWait
    await route.fulfill({ json: { estimated_cost: 10, balance: 9000, can_afford: true } })
  })
  let reviews = 0
  await page.route('**/api/v1/assets/501/seedance-moderation**', (route) => {
    reviews++
    return route.fulfill({ json: { data: { status: 'rejected', reason: '测试拒绝' } } })
  })
  await page.goto('/canvas/125')
  await page.locator('.react-flow__node[data-id="video"]').click()
  const send = page.locator('[data-canvas-node-panel] [data-canvas-generate]')
  await expect.poll(() => estimates).toBeGreaterThan(0)
  await expect(send).toBeDisabled()
  expect(reviews).toBe(0)
  releaseEstimate()
  await expect(page.getByText('预计消耗：10 积分', { exact: true })).toBeVisible()
  await send.click()
  const dialog = page.getByRole('alertdialog', { name: '确认制作费用' })
  await expect(dialog).toBeVisible()
  expect(reviews).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('cost-before-moderation.png') })
  await dialog.getByRole('button', { name: '再想想' }).click()
  expect(reviews).toBe(0)
  await send.click()
  await dialog.getByRole('button', { name: '继续制作' }).click()
  await expect.poll(() => reviews).toBe(1)
  await expect(page.getByText(/审核未通过/)).toBeVisible()
  expect(api.paidTaskSubmissions).toBe(0)
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})
