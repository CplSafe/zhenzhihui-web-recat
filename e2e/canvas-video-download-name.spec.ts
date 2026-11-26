import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  expectNoUnexpectedApi,
  fulfillFixtureVideo,
  installStrictAuthenticatedApp,
  WORKSPACE_ID,
} from './fixtures/strict-authenticated-app'

for (const width of [1440, 760]) {
  test(`画布视频按节点当前名称下载 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    const bytes = await readFile('e2e/fixtures/canvas-video-trim-12s.mp4')
    const errors: string[] = []
    let failDownloads = true
    let downloadRequests = 0
    const browserDownloads: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('download', (download) => browserDownloads.push(download.suggestedFilename()))
    await page.addInitScript(() => {
      const existing = { value: '用户已有文件' }
      Object.defineProperty(window, 'downloadSafetyFixture', { value: existing })
      Object.defineProperty(window, 'showSaveFilePicker', {
        value: async () => {
          existing.value = ''
          return {
            remove: async () => {
              existing.value = '已删除'
            },
          }
        },
      })
    })
    await page.route('**/api/v1/assets', (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      expect(route.request().postDataJSON().source).toBe('canvas-poster')
      return route.fulfill({ status: 503, json: { message: '封面服务不可用' } })
    })
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { code: 0, data: [] } }))
    await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/assets/601/download?**', (route) => {
      if (new URL(route.request().url()).searchParams.has('attachment')) {
        downloadRequests++
        if (failDownloads) return route.fulfill({ status: 404 })
        return route.fulfill({ contentType: 'video/mp4', body: bytes })
      }
      return fulfillFixtureVideo(route, bytes)
    })
    const lockGrant = { granted: true, nodes: {} }
    await page.routeWebSocket('**/api/v1/canvases/172/node-locks/socket?**', (socket) => {
      socket.onMessage(() => socket.send(JSON.stringify({ type: 'state', data: lockGrant })))
    })
    let revision = 1
    await page.route('**/api/v1/canvases/172**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/events')) return route.fulfill({ status: 204 })
      if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: lockGrant })
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: ++revision } })
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements:
                Number(url.searchParams.get('after_revision')) > 0
                  ? []
                  : [
                      {
                        element_id: 'video-name',
                        kind: 'node',
                        op: 'upsert',
                        payload: {
                          id: 'video-name',
                          type: 'video',
                          position: { x: 200, y: 180 },
                          style: { width: 320, height: 240 },
                          data: {
                            kind: 'video',
                            title: '原视频名称',
                            assetId: 601,
                            assetWorkspaceId: WORKSPACE_ID,
                            resultUrl: `/api/v1/assets/601/download?workspace_id=${WORKSPACE_ID}`,
                          },
                        },
                      },
                    ],
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 172, title: '视频下载', status: 'active', revision },
      })
    })
    await page.goto('/canvas/172', { waitUntil: 'domcontentloaded' })
    const node = page.locator('.react-flow__node[data-id="video-name"]')
    await node.locator('.canvas-node-header').click()
    const toolbar = page.getByRole('toolbar', { name: '节点操作' })
    const downloadButton = toolbar.getByRole('button', { name: '下载素材', exact: true })
    await expect(downloadButton).toBeEnabled()
    await downloadButton.click()
    await expect(page.getByText('视频下载失败，请稍后重试', { exact: true })).toBeVisible()
    expect(downloadRequests).toBe(1)
    expect(browserDownloads).toEqual([])
    const existingFile = () => page.evaluate(() => Reflect.get(window, 'downloadSafetyFixture').value)
    expect(await existingFile()).toBe('用户已有文件')

    failDownloads = false
    const first = page.waitForEvent('download')
    await downloadButton.click()
    expect((await first).suggestedFilename()).toBe('原视频名称.mp4')
    await toolbar.getByRole('button', { name: '重命名节点' }).click()
    const edit = node.locator('input.ie-input')
    await edit.fill('新名称:作品.mp4')
    await edit.press('Enter')
    await expect(node.locator('.canvas-node-header__label')).toHaveText('新名称:作品.mp4')
    const second = page.waitForEvent('download')
    await downloadButton.click()
    const download = await second
    expect(download.suggestedFilename()).toBe('新名称_作品.mp4')
    const saved = testInfo.outputPath('node-video.mp4')
    await download.saveAs(saved)
    expect(await readFile(saved)).toEqual(bytes)
    expect(await existingFile()).toBe('用户已有文件')
    await page.screenshot({ path: testInfo.outputPath(`video-download-${width}.png`) })
    expect(errors).toEqual([])
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
