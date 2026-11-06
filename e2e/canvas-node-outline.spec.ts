import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('选中节点的边框与内容对齐', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: [] }))
  // 测试视频会尝试上传首帧封面；本场景不保存素材。
  await page.route('**/api/v1/assets', (route) => route.fulfill({ status: 503, json: { message: '测试不保存封面' } }))
  await page.route('**/api/v1/canvases/222**', (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({
      json:
        route.request().method() === 'PATCH'
          ? { sync_revision: 2 }
          : url.pathname.endsWith('/elements')
            ? {
                elements: [
                  {
                    id: 'video',
                    type: 'video',
                    x: 80,
                    width: 320,
                    height: 180,
                    data: { kind: 'video', resultUrl: '/tutorials/canvas.mp4' },
                  },
                  {
                    id: 'image',
                    type: 'image',
                    x: 480,
                    width: 180,
                    height: 260,
                    data: {
                      kind: 'image',
                      resultUrl:
                        'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22260%22%3E%3Crect width=%22180%22 height=%22260%22 fill=%22%234c8172%22/%3E%3C/svg%3E',
                    },
                  },
                  { id: 'empty', type: 'image', x: 740, width: 200, height: 200, data: { kind: 'image' } },
                  {
                    id: 'text',
                    type: 'text',
                    x: 1020,
                    width: 220,
                    height: 180,
                    data: { kind: 'text', text: '节点文本' },
                  },
                ].map(({ id, type, x, width, height, data }) => ({
                  element_id: id,
                  kind: 'node',
                  op: 'upsert',
                  payload: { id, type, position: { x, y: 140 }, style: { width, height }, data },
                })),
                sync_revision: 1,
                history_floor_revision: 0,
                has_more: false,
              }
            : { id: 222, title: '节点悬停动效', status: 'active', revision: 1 },
    })
  })

  await page.goto('/canvas/222')
  for (const [id, radius] of [
    ['video', '10px'],
    ['image', '10px'],
    ['empty', '10px'],
    ['text', '14px'],
  ] as const) {
    const node = page.locator(`.react-flow__node[data-id="${id}"]`)
    await node.locator('.canvas-node-header').click()
    await expect(node).toHaveClass(/selected/)
    const card = node.locator('.canvas-default-node')
    await card.hover()
    await expect(card).toHaveCSS('transform', 'none')
    await expect(node).toHaveCSS('border-radius', radius)
    await expect(card).toHaveCSS('border-radius', radius)
    await expect(node.locator('.canvas-node-body')).toHaveCSS('border-radius', radius)
    const bounds = await node.evaluate((element) => {
      const outer = element.getBoundingClientRect()
      const inner = element.querySelector('.canvas-default-node')!.getBoundingClientRect()
      return Math.max(
        Math.abs(outer.left - inner.left),
        Math.abs(outer.top - inner.top),
        Math.abs(outer.right - inner.right),
        Math.abs(outer.bottom - inner.bottom),
      )
    })
    expect(bounds).toBeLessThan(0.2)
    await page.screenshot({ path: testInfo.outputPath(`${id}-selected.png`) })
  }
  expectNoUnexpectedApi(api)
})
