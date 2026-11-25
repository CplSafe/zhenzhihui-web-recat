import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const source of ['cloud', 'draft']) {
  for (const status of ['processing', 'failed', 'missing', 'unavailable']) {
    test(`reopening a canvas verifies ${source} failure before displaying ${status}`, async ({ page }) => {
      const api = await installStrictAuthenticatedApp(page, { preserveStorage: source === 'draft' })
      await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { code: 0, data: [] } }))
      const cachedError = 'read google image response: context canceled'
      const latestError = 'Latest confirmed provider error'
      let taskQueries = 0
      let terminalWalletReads = 0
      let taskFinished = false
      await page.route('**/api/v1/billing/wallet?**', (route) => {
        if (taskFinished) terminalWalletReads++
        return route.fulfill({ json: { available: terminalWalletReads > 1 ? 329 : 335 } })
      })
      let paidSubmissions = 0
      let release: (() => void) | undefined
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      const node = {
        element_id: 'restored-image',
        kind: 'node',
        op: 'upsert',
        payload: {
          id: 'restored-image',
          type: 'image',
          position: { x: 200, y: 100 },
          style: { width: 250, height: 250 },
          data: {
            kind: 'image',
            prompt: 'Restored image',
            taskId: 15318,
            taskRunId: 'previous-run',
            taskStatus: 'failed',
            taskError: cachedError,
          },
        },
      }
      if (source === 'draft') {
        await page.addInitScript((savedNode) => {
          localStorage.setItem(
            'zzh_canvas_draft_u7_w21_p110',
            JSON.stringify({
              nodes: [savedNode],
              edges: [],
              textContents: {},
              boundCanvasId: 110,
              pendingSync: true,
              syncBaseline: { nodes: [], edges: [] },
              updatedAt: Date.now(),
            }),
          )
        }, node.payload)
      }
      await page.route('**/api/v1/canvases/110**', async (route) => {
        const url = new URL(route.request().url())
        expect(url.searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
        if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
        await route.fulfill({
          json: url.pathname.endsWith('/elements')
            ? {
                elements: source === 'draft' || Number(url.searchParams.get('after_revision')) > 0 ? [] : [node],
                sync_revision: 1,
                history_floor_revision: 0,
                has_more: false,
              }
            : { id: 110, title: 'Task restoration', status: 'active', revision: 1 },
        })
      })
      await page.route('**/api/v1/ai/tasks/15318?**', async (route) => {
        taskQueries += 1
        await pending
        if (status === 'missing') return route.fulfill({ status: 404, json: { message: 'Task not found' } })
        if (status === 'unavailable' && taskQueries === 1)
          return route.fulfill({ status: 503, json: { message: 'Task status endpoint unavailable' } })
        await route.fulfill({
          json: {
            id: 15318,
            status: status === 'unavailable' ? 'processing' : status,
            error_message: status === 'failed' ? latestError : '',
            outputs: [],
          },
        })
      })
      await page.route('**/api/v1/ai/tasks', async (route) => {
        paidSubmissions += 1
        await route.fulfill({ status: 500, json: { message: 'Restoration must never create a task' } })
      })
      await page.goto('/canvas/110')
      await expect(page.getByRole('button', { name: '图片 · Restored image' })).toBeVisible()
      await page.getByRole('button', { name: '画布操作', exact: true }).click()
      await expect(page.getByRole('button', { name: '剩余积分：335' })).toBeVisible()
      try {
        await expect(page.getByText(cachedError, { exact: false })).toHaveCount(0)
        await expect(page.getByRole('status', { name: '正在恢复任务' })).toBeVisible()
        await expect.poll(() => taskQueries).toBe(1)
      } finally {
        taskFinished = status === 'failed'
        release?.()
      }
      if (status === 'missing') {
        await expect(page.getByRole('status', { name: '任务状态查询异常' })).toBeVisible()
        await expect(page.getByText(/任务编号 15318/)).toBeVisible()
        await expect.poll(() => taskQueries).toBeGreaterThan(1)
        await expect(page.getByRole('status', { name: '正在恢复任务' })).toHaveCount(0)
      } else if (status === 'failed') {
        await expect(page.getByRole('alert', { name: `生成失败：${latestError}` })).toBeVisible()
        await expect(page.getByRole('button', { name: '剩余积分：329' })).toBeVisible()
        expect(terminalWalletReads).toBeGreaterThanOrEqual(2)
      } else {
        if (status === 'unavailable') {
          await expect(page.getByRole('status', { name: '任务状态查询异常' })).toBeVisible()
          await expect(page.getByText(/任务编号 15318/)).toBeVisible()
        }
        await expect(page.getByRole('status', { name: '生成中' })).toBeVisible()
        await expect(page.getByText(latestError, { exact: false })).toHaveCount(0)
      }
      await expect(page.getByText(cachedError, { exact: false })).toHaveCount(0)
      expect(paidSubmissions).toBe(0)
      expectNoUnexpectedApi(api)
    })
  }
}

test('打开没有任务编号的旧节点，保留原提交和提示词且不自动提交', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 27,
            enabled: true,
            capability: 'image',
            display_name: 'Test image model',
            operation_codes: ['image.text_to_image'],
          },
        ],
      },
    }),
  )
  const prompt = '需要保留的原图提示词'
  await page.route('**/api/v1/canvases/111**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    const data = {
      kind: 'image',
      title: '旧图片任务',
      prompt,
      modelVersionId: 27,
      operationCode: 'image.text_to_image',
      taskStatus: 'reconnecting',
      taskStartedAt: '2026-11-01T00:00:00Z',
      taskIdempotencyKey: 'old-image-submission',
    }
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements:
              Number(url.searchParams.get('after_revision')) > 0
                ? []
                : [
                    {
                      element_id: 'old-image',
                      kind: 'node',
                      op: 'upsert',
                      payload: {
                        id: 'old-image',
                        type: 'image',
                        position: { x: 250, y: 150 },
                        style: { width: 250, height: 250 },
                        data,
                      },
                    },
                  ],
            sync_revision: 1,
            has_more: false,
          }
        : { id: 111, title: '旧任务恢复', status: 'active', revision: 1 },
    })
  })

  await page.goto('/canvas/111')
  const node = page.locator('.react-flow__node[data-id="old-image"]')
  await expect(node.getByRole('status', { name: '提交待确认', exact: true })).toBeVisible()
  await expect(node.getByRole('status', { name: '正在恢复任务' })).toHaveCount(0)
  await page.getByRole('button', { name: /当前缩放.*点击回到 100%/ }).click()
  await node.locator('.canvas-node-header').click()
  const editor = page.locator('[data-canvas-node-panel]')
  await expect(editor.getByRole('textbox')).toHaveText(prompt)
  const generate = editor.getByRole('button', { name: '提交待确认', exact: true })
  await expect(generate).toBeDisabled()
  await node.getByRole('button', { name: '查看详情' }).click()
  const details = page.getByRole('dialog', { name: '提交状态详情' })
  await expect(details.getByRole('definition').filter({ hasText: 'old-image-submission' })).toBeVisible()
  await expect(details.getByText('未取得任务编号', { exact: true })).toBeVisible()
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
