import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('拖出新连线时，生成中的已连接节点只置灰并保留生成状态', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/954**', (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'source',
                kind: 'node',
                payload: {
                  id: 'source',
                  type: 'image',
                  position: { x: 100, y: 200 },
                  style: { width: 240, height: 180 },
                  data: { kind: 'image', title: '来源图片' },
                },
              },
              {
                element_id: 'target',
                kind: 'node',
                payload: {
                  id: 'target',
                  type: 'video',
                  position: { x: 650, y: 100 },
                  style: { width: 300, height: 200 },
                  data: { kind: 'video', title: '生成中的视频', taskStatus: 'processing', taskProgress: 25 },
                },
              },
              {
                element_id: 'edge',
                kind: 'edge',
                payload: {
                  id: 'edge',
                  source: 'source',
                  target: 'target',
                  sourceHandle: 'source-right-source',
                  targetHandle: 'target-left-target',
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 954, title: '生成时拖线', revision: 1 },
    })
  })
  await page.goto('/canvas/954')
  const source = page.locator('.react-flow__node[data-id="source"]')
  const target = page.locator('.react-flow__node[data-id="target"]')
  await expect(target.getByText('生成中', { exact: true })).toBeVisible()
  await source.hover()
  const handle = source.locator('.react-flow__handle-right')
  const box = await handle.boundingBox()
  if (!box) throw new Error('来源连接点不可见')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 150, box.y + 120, { steps: 10 })
  await expect(target).toHaveClass(/is-connect-disabled/)
  await expect(target.getByText('生成中', { exact: true })).toBeVisible()
  await expect(target.getByText('连接异常')).toHaveCount(0)
  await expect(target.getByRole('button', { name: '查看详情' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('generating-during-drag.png') })
  await page.mouse.up()
  await expect(target).not.toHaveClass(/is-connect-disabled/)
  await expect(target.getByText('生成中', { exact: true })).toBeVisible()
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
