import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('视频元数据加载较慢时不重复下载整片', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page)
  const bytes = readFileSync('public/tutorials/hot-copy.mp4')
  let mediaRequests = 0
  let fullDownloads = 0
  let release!: () => void
  const responseReady = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/154**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'video-source',
                kind: 'node',
                op: 'upsert',
                payload: {
                  id: 'video-source',
                  type: 'video',
                  position: { x: 300, y: 150 },
                  style: { width: 320, height: 240 },
                  data: { kind: 'video', assetId: 7961, assetWorkspaceId: WORKSPACE_ID, title: '弱网视频' },
                },
              },
            ],
            sync_revision: 1,
            has_more: false,
          }
        : { id: 154, title: '弱网视频', revision: 1 },
    }),
  )
  await page.route('**/api/v1/assets/7961/download?*', async (route) => {
    if (route.request().resourceType() !== 'media') {
      fullDownloads++
      return route.fulfill({ status: 200, contentType: 'video/mp4', body: bytes })
    }
    mediaRequests++
    await responseReady
    return route.fulfill({ status: 200, contentType: 'video/mp4', body: bytes })
  })
  try {
    await page.goto('/canvas/154')
    const node = page.locator('.react-flow__node-video')
    await expect.poll(() => mediaRequests).toBeGreaterThan(0)
    await node.getByRole('button', { name: '播放视频' }).click()
    await expect(node.getByText('视频加载中')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('video-stream-waiting.png') })
    expect(fullDownloads).toBe(0)
    release()
    await expect.poll(() => node.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0)
    expect(fullDownloads).toBe(0)
  } finally {
    release()
  }
})

for (const width of [1440, 390]) {
  test(`慢速视频不会在十秒时反复中断下载 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    const bytes = readFileSync('public/tutorials/hot-copy.mp4')
    let downloads = 0
    let release!: () => void
    const responseReady = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/assets', (route) => route.fulfill({ status: 503, json: { message: '测试不上传封面' } }))
    await page.route('**/api/v1/canvases/154**', (route) =>
      route.fulfill({
        json:
          route.request().method() === 'PATCH'
            ? { sync_revision: 2 }
            : new URL(route.request().url()).pathname.endsWith('/elements')
              ? {
                  elements: [
                    {
                      element_id: 'video-source',
                      kind: 'node',
                      op: 'upsert',
                      payload: {
                        id: 'video-source',
                        type: 'video',
                        position: { x: 300, y: 150 },
                        style: { width: 320, height: 240 },
                        data: { kind: 'video', assetId: 7961, assetWorkspaceId: WORKSPACE_ID, title: '弱网视频' },
                      },
                    },
                  ],
                  sync_revision: 1,
                  has_more: false,
                }
              : { id: 154, title: '弱网视频', revision: 1 },
      }),
    )
    await page.route('**/api/v1/assets/7961/download?*', async (route) => {
      if (route.request().headers().range)
        return route.fulfill({ status: 416, headers: { 'content-range': `bytes */${bytes.length}` } })
      downloads++
      await responseReady
      return route.fulfill({ status: 200, contentType: 'video/mp4', body: bytes })
    })
    await page.clock.install()
    await page.goto('/canvas/154')
    const node = page.locator('.react-flow__node-video')
    await node.getByRole('button', { name: '播放视频' }).click()
    await expect.poll(() => downloads).toBe(1)
    await expect(node.getByText('视频缓冲中')).toBeVisible()
    await page.clock.runFor(11000)
    await expect(node.getByText('视频缓冲中')).toBeVisible()
    expect(downloads).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('video-buffering.png') })
    await node.getByRole('button', { name: '取消', exact: true }).click()
    await node.getByRole('button', { name: '已取消缓冲，重试' }).click()
    await expect.poll(() => downloads).toBe(2)
    release()
    await expect(node.locator('video')).toHaveAttribute('src', /^blob:/, { timeout: 15000 })
  })
}
