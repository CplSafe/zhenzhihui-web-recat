import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('画布超分按报价创建新产物，保留源节点、选区与谱系', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const source = { node_id: 'video-source', asset_id: 12391, kind: 'video' as const, name: '开场镜头.mp4' }
  let tasks: Array<Record<string, unknown>> = []
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
  await page.route('**/api/v1/ai/hd/**', async (route) => {
    const url = new URL(route.request().url())
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null
    expect(Number(body?.workspace_id || url.searchParams.get('workspace_id'))).toBe(WORKSPACE_ID)
    if (url.pathname.endsWith('/preflight')) {
      expect(body.sources).toEqual([source])
      await route.fulfill({
        json: {
          items: [
            {
              ...source,
              eligible: true,
              source_spec: '480P · 5s · 24fps',
              resolutions: ['720P', '1080P'],
              frame_rates: [60],
            },
          ],
        },
      })
    } else if (url.pathname.endsWith('/quotes')) {
      await route.fulfill({
        json: {
          quote_id: 'quote-hd-1',
          expires_at: '2099-01-01',
          items: [{ node_id: source.node_id, asset_id: source.asset_id, credits: 12 }],
          total_credits: 12,
          balance: 100,
          can_afford: true,
          estimated_time: '1～3 分钟',
        },
      })
    } else if (url.pathname.endsWith('/batches')) {
      submissions += 1
      expect(body.quote_id).toBe('quote-hd-1')
      expect(body.idempotency_key).toBeTruthy()
      tasks = [
        {
          id: 'HD-e2e-1',
          workspace_id: WORKSPACE_ID,
          canvas_id: 120,
          canvas_name: '超分验证',
          source,
          source_spec: '480P · 24fps',
          target: { resolution: '1080P', fps: 60 },
          status: 'completed',
          submitted_at: new Date().toISOString(),
          credits: 12,
          refund_status: 'none',
          refunded_credits: 0,
          result: {
            asset_id: 12392,
            name: '开场镜头-HD.mp4',
            spec: '1080P · 60fps',
            width: 1920,
            height: 1080,
            review_policy: 'reuse_source',
            canvas_delivery: 'pending',
          },
        },
      ]
      await route.fulfill({ json: { tasks } })
    } else if (url.pathname.endsWith('/tasks')) {
      await route.fulfill({
        json: {
          items: tasks,
          total: tasks.length,
          stats: { total: tasks.length, active: 0, completed: tasks.length, failed: 0, refunded_credits: 0 },
          canvases: [{ id: 120, name: '超分验证' }],
        },
      })
    } else await route.fulfill({ status: 404, json: { message: 'Not found' } })
  })
  await page.goto('/canvas/120')
  const sourceNode = page.locator(`[data-id="${source.node_id}"]`).first()
  await expect(sourceNode).toBeVisible()
  await sourceNode.locator('.canvas-node-header').click()
  await expect(sourceNode).toHaveClass(/selected/)
  await page.getByRole('button', { name: '超分', exact: true }).click()
  const modal = page.getByRole('dialog', { name: /高清处理确认/ })
  await modal.getByText('逐条明细与跳过原因').click()
  await expect(modal.getByText('480P · 5s · 24fps')).toBeVisible()
  await modal.getByText('1080P', { exact: true }).click()
  await modal.getByText('60fps', { exact: true }).click()
  await expect(modal.getByRole('button', { name: '确认并开始（扣积分）' })).toBeEnabled()
  await page.screenshot({ path: 'artifacts/canvas-hd-confirm.png' })
  await modal.getByRole('button', { name: '确认并开始（扣积分）' }).click()
  await expect(page.getByRole('dialog', { name: '高清任务', exact: true })).toBeVisible()
  await page
    .getByRole('dialog', { name: '高清任务', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  const result = page.locator('[data-id="hd-result-HD-e2e-1"]').first()
  await expect(result).toBeVisible()
  await expect(sourceNode).toContainText(source.name)
  await expect(result).toContainText('高清产物 · 新文件')
  await expect(sourceNode).toHaveClass(/selected/)
  expect(submissions).toBe(1)
  await expect.poll(() => JSON.stringify(saved)).toContain('hd-result-HD-e2e-1')
  await expect.poll(() => JSON.stringify(saved)).toContain('"provenance":true')
  await page.getByRole('button', { name: '复位视图', exact: true }).click()
  await page.locator('.react-flow__pane').click({ position: { x: 1100, y: 80 } })
  await page.screenshot({ path: 'artifacts/canvas-hd-result.png' })
  expectNoUnexpectedApi(api)
})
