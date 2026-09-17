import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const source of ['cloud', 'draft']) {
  for (const status of ['processing', 'failed', 'missing']) {
    test(`reopening a canvas verifies ${source} failure before displaying ${status}`, async ({ page }) => {
      const api = await installStrictAuthenticatedApp(page)
      const cachedError = 'read google image response: context canceled'
      const latestError = 'Latest confirmed provider error'
      let taskQueries = 0
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
            'zzh_canvas_draft_p110',
            JSON.stringify({
              nodes: [savedNode],
              edges: [],
              textContents: {},
              boundCanvasId: 110,
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
        await route.fulfill({
          json: { id: 15318, status, error_message: status === 'failed' ? latestError : '', outputs: [] },
        })
      })
      await page.route('**/api/v1/ai/tasks', async (route) => {
        paidSubmissions += 1
        await route.fulfill({ status: 500, json: { message: 'Restoration must never create a task' } })
      })
      await page.goto('/canvas/110')
      await expect(page.getByRole('button', { name: '图片 · Restored image' })).toBeVisible()
      try {
        await expect(page.getByText(cachedError, { exact: false })).toHaveCount(0)
        await expect(page.getByText('正在核对任务状态', { exact: true })).toBeVisible()
        await expect.poll(() => taskQueries).toBe(1)
      } finally {
        release?.()
      }
      if (status === 'missing') {
        await expect(page.getByText('上次生成失败：任务记录已不存在，请重新生成', { exact: true })).toBeVisible()
        await expect(page.getByText('正在核对任务状态', { exact: true })).toHaveCount(0)
      } else if (status === 'failed') {
        await expect(page.getByText(`上次生成失败：${latestError}`, { exact: true })).toBeVisible()
      } else {
        await expect(page.getByText('正在生成内容', { exact: true })).toBeVisible()
        await expect(page.getByText(latestError, { exact: false })).toHaveCount(0)
      }
      await expect(page.getByText(cachedError, { exact: false })).toHaveCount(0)
      expect(paidSubmissions).toBe(0)
      expectNoUnexpectedApi(api)
    })
  }
}
