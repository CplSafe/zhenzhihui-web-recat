import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { expect, test as base, type Locator, type Page, type TestInfo } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

const VIDEO = readFileSync('e2e/fixtures/canvas-subject-12s.mp4')

type MediaMode = 'online' | 'reject-ranges' | 'offline'

type MediaRequest = {
  mode: MediaMode
  transport: 'fetch' | 'native'
  range: boolean
  status: number
}

type MediaTransport = {
  url: string
  mode: MediaMode
  requests: MediaRequest[]
}

// Windows WebKit 的原生媒体引擎会直接走 HTTP，需要真正的 206/416 响应才能覆盖切换路径。
const test = base.extend<{ media: MediaTransport }>({
  media: async ({ baseURL }, run) => {
    const appOrigin = new URL(baseURL!).origin
    const media: MediaTransport = { url: '', mode: 'online', requests: [] }
    const server = createServer((request, response) => {
      if (request.url !== '/preview.mp4') {
        response.writeHead(404).end()
        return
      }
      const mode = media.mode
      response.setHeader('Access-Control-Allow-Origin', appOrigin)
      response.setHeader('Access-Control-Allow-Credentials', 'true')
      response.setHeader('Cache-Control', 'no-store')
      const rangeHeader = request.headers.range
      const range = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader || '')
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), VIDEO.length - 1) : VIDEO.length - 1
      let status: number
      if (mode === 'offline') {
        status = 503
      } else if (rangeHeader && (mode === 'reject-ranges' || !range || start > end)) {
        status = 416
        response.setHeader('Content-Range', `bytes */${VIDEO.length}`)
      } else {
        status = range ? 206 : 200
        response.setHeader('Content-Type', 'video/mp4')
        response.setHeader('Accept-Ranges', 'bytes')
        response.setHeader('Content-Length', String(end - start + 1))
        if (range) response.setHeader('Content-Range', `bytes ${start}-${end}/${VIDEO.length}`)
      }
      // 跨源 fetch 会发 Origin；原生播放器可能在 416 后自行改用无 Range 请求。
      const transport = request.headers.origin === appOrigin && !rangeHeader ? 'fetch' : 'native'
      media.requests.push({ mode, transport, range: Boolean(rangeHeader), status })
      response.writeHead(status)
      response.end(status < 300 && request.method !== 'HEAD' ? VIDEO.subarray(start, end + 1) : undefined)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('未能启动测试媒体服务')
      media.url = `http://127.0.0.1:${address.port}/preview.mp4`
      await run(media)
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    }
  },
})

async function canvasVideoPreview(page: Page, source: string, browserName: string) {
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  const nativeControlsErrors: string[] = []
  let stage = '打开画布'
  page.on('pageerror', (error) => {
    const diagnostic = `${stage}\n${error.stack || error.message}`
    // WebKit 的原生时间标签由浏览器注入，能在成功起播时抛出此 RangeError。
    if (
      browserName === 'webkit' &&
      error.name === 'RangeError' &&
      error.message === 'Temporal.Duration properties must be finite and of consistent sign' &&
      /at format \(undefined:\d+:\d+\)/.test(diagnostic) &&
      /at commitProperty \(:\d+:\d+\)/.test(diagnostic) &&
      /at performScheduledLayout \(:\d+:\d+\)/.test(diagnostic)
    ) {
      nativeControlsErrors.push(diagnostic)
    } else {
      errors.push(diagnostic)
    }
  })
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/assets', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    expect(route.request().postDataJSON()).toMatchObject({ source: 'canvas-poster' })
    return route.fulfill({ status: 503, json: { message: '测试不保存视频封面' } })
  })
  await page.route('**/api/v1/canvases/970**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/node-locks')) {
      expect(route.request().method()).toBe('POST')
      return route.fulfill({ json: { granted: true, nodes: {} } })
    }
    if (path.endsWith('/events')) return route.fallback()
    expect(route.request().method()).toBe('GET')
    return route.fulfill({
      json: path.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'video',
                kind: 'node',
                op: 'upsert',
                payload: {
                  id: 'video',
                  type: 'video',
                  position: { x: 200, y: 120 },
                  style: { width: 320, height: 180 },
                  data: { kind: 'video', title: '12 秒测试视频', resultUrl: source },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 970, title: '视频预览回归', revision: 1 },
    })
  })
  await page.goto('/canvas/970')
  const node = page.locator('.react-flow__node[data-id="video"]')
  await expect(node).toBeVisible()
  const dialog = page.getByRole('dialog', { name: '视频预览', exact: true })
  const alert = dialog.getByRole('alert')
  return {
    dialog,
    alert,
    video: dialog.locator('video'),
    open: () => {
      stage = '打开预览'
      return node.getByRole('button', { name: '放大视频', exact: true }).click()
    },
    retry: () => {
      stage = '重试播放'
      return dialog.getByRole('button', { name: '重试播放', exact: true }).click()
    },
    verifyRequests: async (testInfo: TestInfo) => {
      if (nativeControlsErrors.length) {
        await testInfo.attach('WebKit 原生播放器诊断', {
          body: nativeControlsErrors.join('\n\n'),
          contentType: 'text/plain',
        })
      }
      expect(errors).toEqual([])
      expectNoUnexpectedApi(api)
    },
  }
}

async function expectPlaying(video: Locator) {
  await expect(video).toHaveJSProperty('duration', 12)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
  if (await video.evaluate((element: HTMLVideoElement) => element.paused)) await video.press('Space')
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.1)
}

test('原始媒体无法加载时显示重试入口，服务恢复后继续播放', async ({ page, media, browserName }, testInfo) => {
  test.setTimeout(75_000)
  await page.setViewportSize({ width: 390, height: 844 })
  media.mode = 'offline'
  const preview = await canvasVideoPreview(page, media.url, browserName)
  await preview.open()
  await expect(preview.alert).toHaveText('暂时无法播放这段视频')
  expect(media.requests).toContainEqual(expect.objectContaining({ mode: 'offline', status: 503 }))
  await page.screenshot({ path: testInfo.outputPath('video-preview-retry.png') })

  media.mode = 'online'
  await preview.retry()
  await expect(preview.alert).toHaveCount(0)
  await expect(preview.video).toHaveAttribute('src', media.url)
  await expectPlaying(preview.video)
  expect(media.requests).toContainEqual({ mode: 'online', transport: 'native', range: true, status: 206 })
  expect(media.requests).not.toContainEqual(expect.objectContaining({ mode: 'online', transport: 'fetch' }))
  await preview.verifyRequests(testInfo)
})

test('分段请求被拒绝后使用完整视频，浏览器无法解码时可下载原片并重试', async ({
  page,
  media,
  browserName,
}, testInfo) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 900, height: 844 })
  media.mode = 'reject-ranges'
  const preview = await canvasVideoPreview(page, media.url, browserName)
  await preview.open()
  await expect
    .poll(() => media.requests)
    .toContainEqual({ mode: 'reject-ranges', transport: 'native', range: true, status: 416 })
  await expect(preview.video).toHaveAttribute('src', /^blob:/)
  const completeDownloads = () =>
    media.requests.filter(
      ({ mode, transport, status }) => mode === 'reject-ranges' && transport === 'fetch' && status === 200,
    )
  expect(completeDownloads()).toHaveLength(1)

  const { alert } = preview
  await expect
    .poll(async () => {
      if (await alert.isVisible()) return true
      return preview.video.evaluate((element: HTMLVideoElement) => element.readyState >= 2)
    })
    .toBe(true)

  if (await alert.isVisible()) {
    await expect(alert).toHaveText('暂时无法播放这段视频')
    await page.screenshot({ path: testInfo.outputPath('video-preview-download-fallback.png') })
    const downloadStarted = page.waitForEvent('download')
    await preview.dialog.getByRole('link', { name: '下载原视频', exact: true }).click()
    const download = await downloadStarted
    expect(readFileSync(await download.path())).toEqual(VIDEO)
    expect(completeDownloads()).toHaveLength(1)

    media.mode = 'online'
    await preview.retry()
    await expect(preview.video).toHaveAttribute('src', media.url)
    await expect(alert).toHaveCount(0)
  }

  await expectPlaying(preview.video)
  await expect(preview.video).toHaveJSProperty('muted', false)
  await page.screenshot({ path: testInfo.outputPath('video-preview-recovered.png') })
  await preview.verifyRequests(testInfo)
})
