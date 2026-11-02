import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('提示词中的 @图片和 @视频均显示引用缩略图并可预览原素材', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/231**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'ref-image',
                kind: 'node',
                payload: {
                  id: 'ref-image',
                  type: 'image',
                  position: { x: 80, y: 120 },
                  style: { width: 240, height: 180 },
                  data: {
                    kind: 'image',
                    title: '产品参考图',
                    assetId: 901,
                    assetWorkspaceId: 21,
                    resultUrl:
                      'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22600%22 height=%22400%22%3E%3Crect width=%22600%22 height=%22400%22 fill=%22%23087f68%22/%3E%3C/svg%3E',
                  },
                },
              },
              {
                element_id: 'ref-video',
                kind: 'node',
                payload: {
                  id: 'ref-video',
                  type: 'video',
                  position: { x: 80, y: 380 },
                  style: { width: 240, height: 180 },
                  data: {
                    kind: 'video',
                    title: '动作参考视频',
                    assetId: 902,
                    assetWorkspaceId: 21,
                    posterAssetId: 903,
                    resultUrl: '/tutorials/canvas.mp4',
                  },
                },
              },
              {
                element_id: 'prompt-image',
                kind: 'node',
                payload: {
                  id: 'prompt-image',
                  type: 'image',
                  position: { x: 440, y: 120 },
                  style: { width: 320, height: 220 },
                  data: {
                    kind: 'image',
                    prompt: '参考动作 @视频1，主视觉参考 @产品参考图，柔和自然光。',
                    sourceRefs: [
                      {
                        kind: 'image',
                        sourceId: 'ref-image',
                        edgeId: 'ref-edge',
                        slotIndex: 0,
                        title: '产品参考图',
                        assetId: 901,
                        workspaceId: 21,
                      },
                      {
                        kind: 'video',
                        sourceId: 'ref-video',
                        edgeId: 'video-edge',
                        slotIndex: 1,
                        title: '动作参考视频',
                        assetId: 902,
                        workspaceId: 21,
                        posterUrl: '/api/v1/assets/903/download?workspace_id=21',
                      },
                    ],
                  },
                },
              },
              {
                element_id: 'ref-edge',
                kind: 'edge',
                payload: {
                  id: 'ref-edge',
                  source: 'ref-image',
                  target: 'prompt-image',
                  sourceHandle: 'ref-image-right-source',
                  targetHandle: 'prompt-image-left-target',
                  data: { slotIndex: 0 },
                },
              },
              {
                element_id: 'video-edge',
                kind: 'edge',
                payload: {
                  id: 'video-edge',
                  source: 'ref-video',
                  target: 'prompt-image',
                  sourceHandle: 'ref-video-right-source',
                  targetHandle: 'prompt-image-left-target',
                  data: { slotIndex: 1 },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 231, title: '图片引用预览', status: 'active', revision: 1 },
    })
  })
  await page.route('**/api/v1/assets/901**', (route) => route.fulfill({ status: 404, json: {} }))
  await page.route('**/api/v1/assets/903**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#635bce"/><circle cx="300" cy="200" r="90" fill="#f6d8ba"/></svg>',
    }),
  )
  // 该视频节点会在加载后尝试补传首帧封面；此流程只验证预览展示，不保存测试素材。
  await page.route('**/api/v1/assets', (route) => route.fulfill({ status: 503, json: { message: '测试不保存封面' } }))
  await page.goto('/canvas/231')
  const imageNode = page.locator('.react-flow__node[data-id="prompt-image"]')
  await expect(imageNode).toBeVisible()
  await imageNode.click()
  const panel = page.locator('[data-canvas-node-panel]')
  await panel.getByTitle('放大输入框').click()
  await panel.getByPlaceholder(/描述你想要生成/).fill('参考动作 @视频1，主视觉参考 @图片1，柔和自然光。')
  const videoMention = panel.locator('button[aria-label="查看引用视频：视频1"]')
  await expect(videoMention).toBeVisible()
  await expect(videoMention.locator('img')).toBeVisible()
  await expect(videoMention).toContainText('视频1')
  await expect(videoMention.locator('img')).toHaveCSS('width', '30px')
  const mention = panel.locator('button[aria-label="查看引用图片：图片1"]')
  await expect(mention).toBeVisible()
  await expect(mention.locator('img')).toBeVisible()
  await expect(mention).toContainText('图片1')
  const mentionSize = await mention.evaluate((button) => {
    const rect = button.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  expect(mentionSize.height).toBeLessThanOrEqual(34)
  expect(mention.locator('img')).toHaveCSS('width', '30px')
  const imageBeforeLabel = await mention.evaluate((button) => {
    const image = button.querySelector('img')!
    const range = document.createRange()
    range.selectNodeContents(button.lastChild!)
    return image.getBoundingClientRect().right <= range.getBoundingClientRect().left
  })
  expect(imageBeforeLabel).toBe(true)
  await mention.click()
  const preview = page.getByRole('dialog', { name: '图片预览' })
  await expect(preview).toBeVisible()
  await expect(preview.getByText('产品参考图', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('canvas-mention-image-preview.png') })
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(panel.getByPlaceholder(/描述你想要生成/)).toHaveValue('参考动作 @视频1，主视觉参考 @图片1，柔和自然光。')
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
