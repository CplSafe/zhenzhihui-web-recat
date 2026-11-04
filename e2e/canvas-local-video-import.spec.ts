import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const CANVAS_ID = 961
const VIDEO_BYTES = readFileSync('public/tutorials/hot-copy.mp4')

async function installCanvasAndUploadMocks(page: Page) {
  const api = await installStrictAuthenticatedApp(page)
  let uploadCompleted = false
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/v1/canvases/${CANVAS_ID}**`, async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: CANVAS_ID, title: 'Video import', status: 'active', revision: 1 },
    })
  })
  await page.route('**/api/v1/assets', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = route.request().postDataJSON()
    if (body.source === 'canvas-poster') return route.fulfill({ status: 503, json: { message: '封面服务不可用' } })
    expect(body.mime_type).toBe('video/mp4')
    await route.fulfill({ json: { asset: { id: 7961 }, upload: { url: '/mock-object-storage', form_fields: {} } } })
  })
  await page.route('**/mock-object-storage', (route) => route.fulfill({ status: 204 }))
  await page.route(`**/api/v1/assets/7961/complete?workspace_id=${WORKSPACE_ID}`, async (route) => {
    uploadCompleted = true
    await route.fulfill({ json: { id: 7961 } })
  })
  await page.route(`**/api/v1/assets/7961/download?workspace_id=${WORKSPACE_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'video/mp4', body: VIDEO_BYTES }),
  )
  return { api, uploadCompleted: () => uploadCompleted }
}

test('Windows 拖入 MIME 为空的 MP4 时按扩展名识别并添加视频节点', async ({ page }) => {
  const { api, uploadCompleted } = await installCanvasAndUploadMocks(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.addInitScript(() => {
    const original = DataTransferItem.prototype.getAsFile
    DataTransferItem.prototype.getAsFile = function () {
      ;(window as any).__nativeItemReads = ((window as any).__nativeItemReads || 0) + 1
      return original.call(this)
    }
  })
  await page.goto(`/canvas/${CANVAS_ID}`)
  await expect(page.locator('.react-flow__pane')).toBeVisible()

  await page.locator('.canvas-view').evaluate(async (root) => {
    const blob = await (await fetch('/tutorials/hot-copy.mp4')).blob()
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'source.MP4'))
    root.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  })

  const node = page.locator('.react-flow__node-video')
  await expect(node).toHaveCount(1)
  await expect(node).toContainText('source')
  await expect.poll(uploadCompleted).toBe(true)
  expect(await page.evaluate(() => (window as any).__nativeItemReads || 0)).toBe(0)
  await expect.poll(() => node.locator('video').getAttribute('src')).toContain('/api/v1/assets/7961/download')
  await expect(page.getByText('上传素材失败，请稍后重试')).toHaveCount(0)
  expectNoUnexpectedApi(api)
})

test('不支持的本地视频扩展名会说明支持格式且不会创建空节点', async ({ page }) => {
  const { api } = await installCanvasAndUploadMocks(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/canvas/${CANVAS_ID}`)
  await expect(page.locator('.react-flow__pane')).toBeVisible()

  await page.locator('.canvas-view').evaluate((root) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['unsupported'], 'source.wmv', { type: 'application/octet-stream' }))
    root.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  })

  await expect(page.getByText(/文件格式不受支持.*MP4、MOV/)).toBeVisible()
  await expect(page.locator('.react-flow__node')).toHaveCount(0)
  expectNoUnexpectedApi(api)
})

test('本地视频上传完成后可连续拖动节点并撤销', async ({ page }, testInfo) => {
  const { api, uploadCompleted } = await installCanvasAndUploadMocks(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    const original = Document.prototype.querySelectorAll
    ;(Document.prototype as any).querySelectorAll = function (selectors: string) {
      if (selectors === '[aria-modal="true"]')
        (window as any).__canvasModalScans = ((window as any).__canvasModalScans || 0) + 1
      return original.call(this, selectors)
    }
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/canvas/${CANVAS_ID}`)
  await expect(page.locator('.react-flow__pane')).toBeVisible()
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'source.mp4',
    mimeType: 'video/mp4',
    buffer: VIDEO_BYTES,
  })
  const node = page.locator('.react-flow__node-video')
  await expect(node).toHaveCount(1)
  await expect.poll(uploadCompleted).toBe(true)
  await expect
    .poll(() => node.locator('video').evaluate((element: HTMLVideoElement) => element.videoWidth))
    .toBeGreaterThan(0)
  const prompt = page.getByPlaceholder(/描述你想要生成的视频内容/)
  await prompt.fill('拖动前填写的内容')
  const before = await node.evaluate((element: HTMLElement) => element.style.transform)
  const box = await node.locator('.canvas-node-body').boundingBox()
  if (!box) throw new Error('视频节点不可见')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 3
  await page.evaluate(() => ((window as any).__canvasModalScans = 0))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 180, y + 100, { steps: 80 })
  await page.mouse.up()
  const modalScans = await page.evaluate(() => (window as any).__canvasModalScans || 0)
  expect(modalScans).toBeLessThan(15)
  await expect.poll(() => node.evaluate((element: HTMLElement) => element.style.transform)).not.toBe(before)
  await expect(prompt).toHaveText('拖动前填写的内容')
  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Control+z')
  await expect.poll(() => node.evaluate((element: HTMLElement) => element.style.transform)).toBe(before)
  await page.screenshot({ path: testInfo.outputPath('video-drag-undo.png') })
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})

test('批量导入图片与视频时界面保持可交互并合并初始草稿保存', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  const video = readFileSync('public/tutorials/hot-copy.mp4')
  let image = Buffer.alloc(0)
  const assetTypes = new Map<number, string>()
  let nextAssetId = 8000
  let completed = 0
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/real-people?**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route(`**/api/v1/canvases/${CANVAS_ID}**`, (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: CANVAS_ID, title: 'Media import', status: 'active', revision: 1 },
    })
  })
  await page.route('**/api/v1/assets', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const id = nextAssetId++
    assetTypes.set(id, String(route.request().postDataJSON().mime_type))
    return route.fulfill({ json: { asset: { id }, upload: { url: '/mock-object-storage', form_fields: {} } } })
  })
  await page.route('**/mock-object-storage', (route) => route.fulfill({ status: 204 }))
  await page.route('**/api/v1/assets/*/complete?*', (route) => {
    completed++
    return route.fulfill({
      json: {
        id: Number(
          route
            .request()
            .url()
            .match(/assets\/(\d+)/)?.[1],
        ),
      },
    })
  })
  await page.route('**/api/v1/assets/*/download?*', (route) => {
    const id = Number(
      route
        .request()
        .url()
        .match(/assets\/(\d+)/)?.[1],
    )
    const isVideo = assetTypes.get(id)?.startsWith('video/')
    return route.fulfill({
      status: 200,
      contentType: isVideo ? 'video/mp4' : 'image/png',
      body: isVideo ? video : image,
    })
  })
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('zzh_canvas_draft')) (window as any).__draftWrites = ((window as any).__draftWrites || 0) + 1
      return original.call(this, key, value)
    }
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/canvas/${CANVAS_ID}`)
  await expect(page.locator('.react-flow__pane')).toBeVisible()
  await page.evaluate(() => ((window as any).__draftWrites = 0))
  const imageBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 300
    canvas.height = 300
    const context = canvas.getContext('2d')!
    context.fillStyle = '#84a8a1'
    context.fillRect(0, 0, 300, 300)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  image = Buffer.from(imageBase64, 'base64')
  await page.locator('input[type=file][multiple]').setInputFiles([
    ...Array.from({ length: 8 }, (_, index) => ({
      name: `image-${index}.png`,
      mimeType: 'image/png',
      buffer: image,
    })),
    { name: 'source.mp4', mimeType: 'video/mp4', buffer: video },
  ])
  await expect(page.locator('.react-flow__node-image')).toHaveCount(8)
  await expect(page.locator('.react-flow__node-video')).toHaveCount(1)
  await expect.poll(() => completed).toBeGreaterThanOrEqual(9)
  await expect(page.locator('.react-flow__node-image img').first()).toHaveJSProperty('naturalWidth', 300)
  await expect(page.locator('.react-flow__pane')).toBeVisible()
  const draftWrites = await page.evaluate(() => (window as any).__draftWrites || 0)
  expect(draftWrites).toBeLessThan(9)
  await page.screenshot({ path: testInfo.outputPath('mixed-import.png') })
  expectNoUnexpectedApi(api)
})

test('已有节点的画布拖入 MP4 且上传缓慢时仍可操作', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  const video = readFileSync('public/tutorials/hot-copy.mp4')
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/real-people?**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route(`**/api/v1/canvases/${CANVAS_ID}**`, (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    const elements = Array.from({ length: 100 }, (_, index) => ({
      element_id: `node-${index}`,
      kind: 'node',
      payload: {
        type: 'text',
        position: { x: (index % 10) * 350, y: Math.floor(index / 10) * 260 },
        style: { width: 250, height: 160 },
        data: { kind: 'text', title: `节点 ${index + 1}`, text: '画布内容' },
      },
    }))
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? { elements, sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: CANVAS_ID, title: 'Slow upload', status: 'active', revision: 1 },
    })
  })
  let releaseUpload: () => void = () => {}
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve
  })
  await page.route('**/api/v1/assets', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await uploadGate
    return route.fulfill({ json: { asset: { id: 7961 }, upload: { url: '/mock-object-storage', form_fields: {} } } })
  })
  await page.route('**/mock-object-storage', (route) => route.fulfill({ status: 204 }))
  await page.route('**/api/v1/assets/7961/complete?*', (route) => route.fulfill({ json: { id: 7961 } }))
  await page.route('**/api/v1/assets/7961/download?*', (route) =>
    route.fulfill({ status: 200, contentType: 'video/mp4', body: video }),
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/canvas/${CANVAS_ID}`)
  await expect(page.locator('.react-flow__node-text')).toHaveCount(100)
  await page.locator('.canvas-view').evaluate(async (root) => {
    const blob = await (await fetch('/tutorials/hot-copy.mp4')).blob()
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'source.mp4', { type: 'video/mp4' }))
    root.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.react-flow__node-video')).toHaveCount(1)
  const zoom = page.getByRole('combobox', { name: '画布缩放', exact: true })
  await zoom.selectOption('50')
  await expect(zoom).toHaveValue('50')
  releaseUpload()
  await expect
    .poll(() => page.locator('.react-flow__node-video video').getAttribute('src'))
    .toContain('/api/v1/assets/7961/download')
  await page.screenshot({ path: testInfo.outputPath('slow-video-upload.png') })
  expectNoUnexpectedApi(api)
})

test('服务端拒绝视频分段请求时回退完整素材并能播放', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  const videoBytes = readFileSync('public/tutorials/hot-copy.mp4')
  let rangeRequests = 0
  let fullDownloads = 0
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/assets', (route) => route.fulfill({ status: 503, json: { message: '封面服务不可用' } }))
  await page.route(`**/api/v1/canvases/${CANVAS_ID}**`, (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'video-source',
                kind: 'node',
                payload: {
                  type: 'video',
                  position: { x: 300, y: 150 },
                  style: { width: 320, height: 240 },
                  data: { kind: 'video', assetId: 7961, assetWorkspaceId: WORKSPACE_ID, title: '本地视频' },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: CANVAS_ID, title: '视频播放', status: 'active', revision: 1 },
    })
  })
  await page.route('**/api/v1/assets/7961/download?*', (route) => {
    if (route.request().headers().range) {
      rangeRequests++
      return route.fulfill({ status: 416, headers: { 'content-range': `bytes */${videoBytes.length}` } })
    }
    fullDownloads++
    return route.fulfill({ status: 200, contentType: 'video/mp4', body: videoBytes })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/canvas/${CANVAS_ID}`)
  const node = page.locator('.react-flow__node-video')
  const video = node.locator('video')
  await node.getByRole('button', { name: '播放视频' }).click()
  await expect(video).toHaveAttribute('src', /^blob:/, { timeout: 15000 })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.duration)).toBeGreaterThan(1)
  if (await video.evaluate((element: HTMLVideoElement) => element.paused)) {
    await node.getByRole('button', { name: '播放视频' }).click()
  }
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.2)
  expect(rangeRequests).toBeGreaterThan(0)
  expect(fullDownloads).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('video-fallback-playing.png') })
  expectNoUnexpectedApi(api)
})
