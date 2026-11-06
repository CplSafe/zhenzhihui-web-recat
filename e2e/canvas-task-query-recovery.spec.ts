import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('查询异常保留旧视频，恢复后只绑定当前任务返回的结果', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  let recovered = false
  let queries = 0
  let revision = 1
  let saved: any = {
    element_id: 'video',
    kind: 'node',
    op: 'upsert',
    payload: {
      id: 'video',
      type: 'video',
      position: { x: 250, y: 100 },
      style: { width: 320, height: 300 },
      data: {
        kind: 'video',
        title: '任务恢复',
        assetId: 601,
        taskId: 802,
        taskRunId: 'current-run',
        taskStatus: 'status_query_failed',
        taskError: '刷新任务状态失败，请稍后重试',
        resultHistory: [{ assetId: 601, taskId: 801, kind: 'video', createdAt: '2026-11-06T00:00:00Z' }],
      },
    },
  }
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/assets', (route) => route.fulfill({ status: 400, json: { message: 'fixture' } }))
  await page.route('**/api/v1/assets?**', (route) =>
    route.fulfill({ json: { items: [{ id: 602, type: 'video', status: 'active', task_id: 802 }], total: 1 } }),
  )
  await page.route('**/api/v1/ai/tasks/802?**', (route) => {
    queries++
    return recovered
      ? route.fulfill({ json: { id: 802, status: 'succeeded', outputs: [{ asset_id: 602, type: 'video' }] } })
      : route.fulfill({ status: 400, json: { message: '刷新任务状态失败，请稍后重试' } })
  })
  await page.route('**/api/v1/canvases/130**', (route) => {
    if (route.request().method() === 'PATCH') {
      for (const item of route.request().postDataJSON().mutations || [])
        if (item.element_id === 'video' && item.payload) saved = item
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    const url = new URL(route.request().url())
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [saved],
            sync_revision: revision,
            has_more: false,
          }
        : { id: 130, title: '任务查询恢复', status: 'active', revision },
    })
  })
  await page.goto('/canvas/130')
  const node = page.locator('.react-flow__node[data-id="video"]')
  await expect(node.locator('video')).toBeVisible()
  await expect(node.getByText('任务状态查询异常，继续自动重试；当前展示已有视频，本次结果待确认')).toBeVisible()
  await expect.poll(() => queries).toBeGreaterThan(0)
  await expect(node.locator('video')).toHaveAttribute('src', new RegExp('/assets/601/'))
  await page.screenshot({ path: testInfo.outputPath('retained-video-query-error.png') })
  recovered = true
  await expect.poll(() => saved.payload.data.assetId, { timeout: 30000 }).toBe(602)
  expect(saved.payload.data.taskId).toBe(802)
  expect(saved.payload.data.taskStatus).toBe('succeeded')
  expect(saved.payload.data.resultHistory).toMatchObject([
    { assetId: 601, taskId: 801 },
    { assetId: 602, taskId: 802 },
  ])
  await expect(node.locator('video')).toHaveAttribute('src', new RegExp('/assets/602/'))
  await expect(node.getByText('任务状态查询异常', { exact: false })).toHaveCount(0)
  await page.reload()
  await expect(node.locator('video')).toHaveAttribute('src', new RegExp('/assets/602/'))
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
  expect(WORKSPACE_ID).toBeGreaterThan(0)
})
