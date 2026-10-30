import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('触控板滚动停在文本节点上时仍可平移画布', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: [] }))
  await page.addInitScript(() => localStorage.setItem('zzh_canvas_preferences', JSON.stringify({ wheelMode: 'pan' })))
  await page.route('**/api/v1/canvases/953**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'pan-text',
                kind: 'node',
                payload: {
                  id: 'pan-text',
                  type: 'text',
                  position: { x: 200, y: 160 },
                  style: { width: 300, height: 220 },
                  data: { kind: 'text', title: '文本节点', text: '在文本节点上滚动触控板，画布应继续平移。' },
                },
              },
              {
                element_id: 'pan-audio',
                kind: 'node',
                payload: {
                  id: 'pan-audio',
                  type: 'audio',
                  position: { x: 650, y: 160 },
                  style: { width: 320, height: 220 },
                  data: { kind: 'audio', title: '音频节点' },
                },
              },
              {
                element_id: 'pan-failure-id',
                kind: 'node',
                payload: {
                  id: 'pan-failure-id',
                  type: 'image',
                  position: { x: 200, y: 520 },
                  style: { width: 300, height: 220 },
                  data: {
                    kind: 'image',
                    title: '失败的图片节点',
                    taskStatus: 'failed',
                    taskError: '模拟失败',
                    taskFailure: { requestId: 'request-pan-test' },
                  },
                },
              },
              {
                element_id: 'pan-failure-retry',
                kind: 'node',
                payload: {
                  id: 'pan-failure-retry',
                  type: 'video',
                  position: { x: 650, y: 520 },
                  style: { width: 320, height: 220 },
                  data: {
                    kind: 'video',
                    title: '配音失败的视频节点',
                    taskStatus: 'failed',
                    taskError: '模拟失败',
                    videoAudioComposition: { failed: true },
                  },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 953, title: '文本节点滚轮平移', revision: 1 },
    }),
  )

  await page.goto('/canvas/953')
  const node = page.locator('.react-flow__node[data-id="pan-text"]')
  await expect(node).toBeVisible()
  const viewport = page.locator('.react-flow__viewport')
  const panAt = async (target: import('@playwright/test').Locator) => {
    const before = await viewport.evaluate((element) => getComputedStyle(element).transform)
    const bounds = await target.boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await page.mouse.wheel(0, 120)
    await expect.poll(() => viewport.evaluate((element) => getComputedStyle(element).transform)).not.toBe(before)
  }
  await panAt(node.locator('.canvas-node-prompt'))

  const audioNode = page.locator('.react-flow__node[data-id="pan-audio"]')
  await audioNode.locator('.canvas-node-header').click()
  const audioPanel = audioNode.locator('.canvas-audio-panel')
  await expect(audioPanel).toBeVisible()
  await panAt(audioPanel)

  const requestId = page.getByRole('button', { name: '复制 RequestID：request-pan-test' })
  await expect(requestId).toBeVisible()
  await panAt(requestId)

  const retry = page.getByRole('button', { name: '重试配音合成' })
  await expect(retry).toBeVisible()
  await panAt(retry)
  await page.screenshot({ path: test.info().outputPath('canvas-text-wheel-pan.png') })
  expectNoUnexpectedApi(api)
})
