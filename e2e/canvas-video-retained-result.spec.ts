import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('保留的视频不被上次失败遮挡，失败详情和无结果的失败仍可查看', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/assets', (route) => route.fulfill({ status: 400, json: { message: 'fixture' } }))
  const makeNode = (id: string, x: number, withVideo: boolean) => ({
    element_id: id,
    kind: 'node',
    op: 'upsert',
    payload: {
      id,
      type: 'video',
      position: { x, y: 100 },
      style: { width: 260, height: 350 },
      data: {
        kind: 'video',
        prompt: id,
        ...(withVideo ? { assetId: 12391, workspaceId: WORKSPACE_ID } : {}),
        taskStatus: 'submit_failed',
        taskError: '请求失败，任务状态待确认',
        taskFailure: {
          message: '请求失败，任务状态待确认',
          stage: 'unknown',
          submissionId: 'saved-submission',
          failedAt: '2026-11-06T02:25:52.741Z',
        },
      },
    },
  })
  await page.route('**/api/v1/canvases/119**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { revision: 2 } })
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements:
              Number(url.searchParams.get('after_revision')) > 0
                ? []
                : [makeNode('retained', 80, true), makeNode('empty', 430, false)],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 119, title: '保留视频', status: 'active', revision: 1 },
    })
  })
  await page.goto('/canvas/119')
  await page.getByRole('combobox', { name: '画布缩放' }).selectOption('100')
  const retained = page.locator('.react-flow__node[data-id="retained"]')
  const empty = page.locator('.react-flow__node[data-id="empty"]')
  await expect(retained.locator('video')).toBeVisible()
  await expect(retained.getByText('上次任务失败，视频已保留')).toBeVisible()
  await expect(empty.getByRole('alert')).toBeVisible()
  await retained.getByRole('button', { name: '查看详情' }).click()
  const dialog = page.getByRole('dialog', { name: '生成失败详情' })
  await expect(dialog.getByText('saved-submission')).toBeVisible()
  await expect(dialog.getByText('请求失败，任务状态待确认')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('retained-video-details.png') })
  await dialog.getByRole('button', { name: 'Close' }).click()
  await retained.locator('.canvas-node-header').click()
  await page.getByRole('button', { name: '放大预览视频' }).click()
  const preview = page.getByRole('dialog', { name: '视频预览' })
  await expect(preview.locator('video')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await page.reload()
  await expect(retained.locator('video')).toBeVisible()
  await expect(retained.getByText('上次任务失败，视频已保留')).toBeVisible()
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
  await page.screenshot({ path: testInfo.outputPath('retained-video.png') })
})
