import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('图片节点可从面板底部送审并回显审核通过状态', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  let submitted = false
  const calls: string[] = []
  await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/assets/501/seedance-moderation**', async (route) => {
    calls.push(
      `${route.request().method()} ${new URL(route.request().url()).pathname}${new URL(route.request().url()).search}`,
    )
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ workspace_id: WORKSPACE_ID })
      submitted = true
      await route.fulfill({ json: { data: { status: 'pending' } } })
      return
    }
    if (!submitted) {
      await route.fulfill({ status: 404, json: { message: '尚未提交审核' } })
      return
    }
    await route.fulfill({ json: { data: { status: 'approved' } } })
  })
  await page.route('**/api/v1/canvases/126**', (route) =>
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
                    op: 'upsert',
                    payload: {
                      id: 'image',
                      type: 'image',
                      position: { x: 240, y: 150 },
                      style: { width: 320, height: 280 },
                      data: { kind: 'image', title: '审核图片', assetId: 501, assetWorkspaceId: WORKSPACE_ID },
                    },
                  },
                ],
                sync_revision: 1,
                history_floor_revision: 0,
                has_more: false,
              }
            : { id: 126, title: 'Seedance 图片审核', revision: 1 },
    }),
  )
  await page.route(`**/api/v1/assets/501/download?workspace_id=${WORKSPACE_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
    }),
  )

  await page.goto('/canvas/126')
  const node = page.locator('.react-flow__node[data-id="image"]')
  await expect(node).toBeVisible()
  await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('100')
  await node.click()
  const panel = page.locator('[data-canvas-node-panel]')
  const moderationButton = panel.getByRole('button', { name: 'Seedance 图片审核' })
  await expect(moderationButton).toBeVisible()
  await expect(
    page.getByRole('toolbar', { name: '节点操作' }).getByRole('button', { name: 'Seedance 图片审核' }),
  ).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('moderation-button-in-panel.png') })
  await moderationButton.click()
  const dialog = page.getByRole('dialog', { name: 'Seedance 图片审核' })
  await expect(dialog.getByText(/尚无审核结果/)).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('button', { name: '提交审核' }).click()
  await expect(dialog.getByText('审核通过', { exact: true })).toBeVisible({ timeout: 10_000 })
  expect(calls.some((call) => call === `POST /api/v1/assets/501/seedance-moderation`)).toBe(true)
  expect(calls.some((call) => call === `GET /api/v1/assets/501/seedance-moderation?workspace_id=${WORKSPACE_ID}`)).toBe(
    true,
  )
  expectNoUnexpectedApi(api)
})
