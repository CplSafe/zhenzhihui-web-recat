import { expect, test, type Page } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const CANVAS_ID = 964
const ORIGINAL_ASSET_ID = 1701
const CROP_ASSET_ID = 1702
const UPLOAD_URL = 'https://canvas-test.oss-cn-beijing.aliyuncs.com/crop'
const ORIGINAL_WIDTH = 320
const ORIGINAL_HEIGHT = 240

type CropRect = { x: number; y: number; width: number; height: number }
type ElementMutation = {
  element_id: string
  kind: 'node' | 'edge'
  op: 'upsert' | 'delete'
  payload?: Record<string, unknown>
}

async function installCropFixtures(page: Page, failFirstUpload = false) {
  const api = await installStrictAuthenticatedApp(page)
  const originalPosition = { x: 140, y: 150 }
  const originalNodes: ElementMutation[] = [
    {
      element_id: 'crop-source',
      kind: 'node',
      op: 'upsert',
      payload: {
        type: 'image',
        position: originalPosition,
        style: { width: 320, height: 240 },
        data: {
          kind: 'image',
          title: '原图色块',
          ratio: '4:3',
          assetId: ORIGINAL_ASSET_ID,
          assetWorkspaceId: WORKSPACE_ID,
          assetSource: 'upload',
        },
      },
    },
    {
      element_id: 'existing-text',
      kind: 'node',
      op: 'upsert',
      payload: {
        type: 'text',
        position: { x: 140, y: 535 },
        style: { width: 250, height: 150 },
        data: { kind: 'text', title: '已有文字', text: '保留原有连线' },
      },
    },
    {
      element_id: 'original-edge',
      kind: 'edge',
      op: 'upsert',
      payload: {
        source: 'crop-source',
        target: 'existing-text',
        sourceHandle: 'crop-source-right-source',
        targetHandle: 'existing-text-left-target',
      },
    },
  ]
  const elements = new Map(originalNodes.map((node) => [node.element_id, node]))
  const state = { assetCreates: 0, completed: 0, uploads: [] as Buffer[], revision: 1 }
  const originalPng = await page.evaluate(
    ({ width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')!
      const pixels = context.createImageData(width, height)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4
          pixels.data[offset] = (5 * x + 40) % 256
          pixels.data[offset + 1] = (3 * y + 100) % 256
          pixels.data[offset + 2] = (x + y + 80) % 256
          pixels.data[offset + 3] = 255
        }
      }
      context.putImageData(pixels, 0, 0)
      return canvas.toDataURL('image/png')
    },
    { width: ORIGINAL_WIDTH, height: ORIGINAL_HEIGHT },
  )
  await page.addInitScript((uploadUrl) => {
    const win = window as Window & { standaloneCropUploadFile?: number[] }
    const originalFetch = window.fetch
    window.fetch = async (input, init) => {
      if (String(input) === uploadUrl && init?.body instanceof FormData) {
        const file = init.body.get('file')
        if (file instanceof Blob) win.standaloneCropUploadFile = [...new Uint8Array(await file.arrayBuffer())]
      }
      return originalFetch(input, init)
    }
  }, UPLOAD_URL)
  const editLocks = (nodes: string[]) => ({
    granted: true,
    nodes: Object.fromEntries(nodes.map((id) => [id, [{ user_id: 7, name: 'E2E 用户', editing: true }]])),
  })
  await page.routeWebSocket(`**/api/v1/canvases/${CANVAS_ID}/node-locks/socket?**`, (socket) => {
    socket.onMessage((message) => {
      const { nodes } = JSON.parse(String(message)) as { nodes: string[] }
      socket.send(JSON.stringify({ type: 'state', data: editLocks(nodes) }))
    })
  })
  await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route(`**/api/v1/canvases/${CANVAS_ID}**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/node-locks') && request.method() === 'POST') {
      const { nodes } = request.postDataJSON() as { nodes: string[] }
      return route.fulfill({ json: editLocks(nodes) })
    }
    if (url.pathname.endsWith('/elements')) {
      if (request.method() === 'PATCH') {
        const { mutations } = request.postDataJSON() as { mutations?: ElementMutation[] }
        for (const mutation of mutations || []) {
          if (mutation.op === 'delete') elements.delete(mutation.element_id)
          else elements.set(mutation.element_id, mutation)
        }
        return route.fulfill({ json: { sync_revision: ++state.revision } })
      }
      return route.fulfill({
        json: {
          elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [...elements.values()],
          sync_revision: state.revision,
          history_floor_revision: 0,
          has_more: false,
        },
      })
    }
    return route.fulfill({ json: { id: CANVAS_ID, title: '图片裁剪验收', status: 'active', revision: state.revision } })
  })
  await page.route(`**/api/v1/assets/${ORIGINAL_ASSET_ID}/download?**`, (route) =>
    route.fulfill({ contentType: 'image/png', body: Buffer.from(originalPng.split(',')[1], 'base64') }),
  )
  await page.route(`**/api/v1/assets/${CROP_ASSET_ID}/download?**`, (route) =>
    route.fulfill({ contentType: 'image/png', body: state.uploads.at(-1) }),
  )
  await page.route('**/api/v1/assets', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    state.assetCreates++
    expect(route.request().postDataJSON()).toMatchObject({
      workspace_id: WORKSPACE_ID,
      type: 'image',
      mime_type: 'image/png',
    })
    return route.fulfill({
      json: { asset: { id: CROP_ASSET_ID }, upload: { url: UPLOAD_URL, form_fields: {} } },
    })
  })
  await page.route(UPLOAD_URL, async (route) => {
    // 部分 WebKit 版本不返回 multipart 请求体，从实际传给 fetch 的 File 取完整字节。
    const fileBytes = await page.evaluate(
      () => (window as Window & { standaloneCropUploadFile?: number[] }).standaloneCropUploadFile,
    )
    expect(fileBytes).toBeDefined()
    state.uploads.push(Buffer.from(fileBytes!))
    return route.fulfill({
      status: failFirstUpload && state.uploads.length === 1 ? 503 : 204,
      headers: { 'access-control-allow-origin': '*' },
    })
  })
  await page.route(`**/api/v1/assets/${CROP_ASSET_ID}/complete?**`, (route) => {
    state.completed++
    return route.fulfill({ json: { id: CROP_ASSET_ID, status: 'active' } })
  })
  return { api, elements, originalPosition, originalPng, state }
}

async function openCrop(page: Page) {
  await page.locator('.react-flow__node[data-id="crop-source"] .canvas-node-header').click()
  await page
    .getByRole('toolbar', { name: '节点操作', exact: true })
    .getByRole('button', { name: '裁剪', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: '裁剪图片', exact: true })
  await expect(dialog.getByRole('img', { name: '原图', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '裁剪并创建节点', exact: true })).toBeEnabled()
  return dialog
}

async function assertCroppedPixels(page: Page, originalPng: string, upload: Buffer, crop: CropRect) {
  const decoded = await page.evaluate(
    async ({ source, output, cropRect }) => {
      const read = async (dataUrl: string) => {
        const image = new Image()
        image.src = dataUrl
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
        }
      }
      const [before, after] = await Promise.all([read(source), read(output)])
      let differentPixels = 0
      for (let y = 0; y < after.height; y++) {
        for (let x = 0; x < after.width; x++) {
          const beforeIndex = ((y + cropRect.y) * before.width + x + cropRect.x) * 4
          const afterIndex = (y * after.width + x) * 4
          for (let channel = 0; channel < 4; channel++) {
            if (before.pixels[beforeIndex + channel] === after.pixels[afterIndex + channel]) continue
            differentPixels++
            break
          }
        }
      }
      return { width: after.width, height: after.height, differentPixels }
    },
    { source: originalPng, output: 'data:image/png;base64,' + upload.toString('base64'), cropRect: crop },
  )
  expect(decoded).toEqual({ width: crop.width, height: crop.height, differentPixels: 0 })
}

test('固定比例裁剪按原像素生成相邻独立节点，刷新后保留', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  const { api, elements, originalPosition, originalPng, state } = await installCropFixtures(page)
  await page.goto(`/canvas/${CANVAS_ID}`)
  const edges = page.locator('.react-flow__edge')
  await expect(edges).toHaveCount(1)
  await page.locator('.react-flow__node[data-id="existing-text"] .canvas-node-header').click()
  await expect(
    page.getByRole('toolbar', { name: '节点操作' }).getByRole('button', { name: '裁剪', exact: true }),
  ).toHaveCount(0)

  const dialog = await openCrop(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.react-flow__node-image')).toHaveCount(1)
  await expect(edges).toHaveCount(1)
  expect(state.assetCreates).toBe(0)
  expect(state.uploads).toHaveLength(0)

  await openCrop(page)
  await dialog.getByRole('button', { name: '16:9', exact: true }).click()
  await expect(dialog.getByRole('status', { name: '裁剪尺寸' })).toContainText('320 × 180')
  await page.screenshot({ path: testInfo.outputPath('fixed-ratio-crop.png') })
  await dialog.getByRole('button', { name: '裁剪并创建节点', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  const cropNode = page.locator('.react-flow__node-image').filter({ hasText: '原图色块 · 裁剪' })
  await expect(cropNode).toHaveCount(1)
  await expect(page.locator('.react-flow__node-image')).toHaveCount(2)
  await expect(edges).toHaveCount(1)
  await expect(edges.first()).toHaveAttribute('data-id', 'original-edge')
  expect(state.uploads).toHaveLength(1)
  expect(state.assetCreates).toBe(1)
  expect(state.completed).toBe(1)
  await assertCroppedPixels(page, originalPng, state.uploads[0], { x: 0, y: 30, width: 320, height: 180 })

  const cropId = (await cropNode.getAttribute('data-id'))!
  await page.keyboard.press('Control+z')
  await expect(cropNode).toHaveCount(0)
  await expect(page.locator('.react-flow__node[data-id="crop-source"]')).toHaveCount(1)
  await expect(edges.first()).toHaveAttribute('data-id', 'original-edge')
  await page.keyboard.press('Control+Shift+z')
  await expect(cropNode).toHaveAttribute('data-id', cropId)
  await expect(edges).toHaveCount(1)
  expect(state.uploads).toHaveLength(1)

  await expect.poll(() => elements.get(cropId)?.payload?.data).toMatchObject({ assetId: CROP_ASSET_ID })
  const savedPosition = elements.get(cropId)?.payload?.position as { x: number; y: number }
  expect(savedPosition.x).toBeGreaterThanOrEqual(originalPosition.x + 320)
  expect(savedPosition.x).toBeLessThan(originalPosition.x + 600)
  expect(savedPosition.y).toBe(originalPosition.y)
  expect(elements.get('crop-source')?.payload).toMatchObject({
    position: originalPosition,
    data: { assetId: ORIGINAL_ASSET_ID },
  })
  expect([...elements.values()].filter(({ kind }) => kind === 'edge').map(({ element_id }) => element_id)).toEqual([
    'original-edge',
  ])

  await page.reload()
  await expect(cropNode.locator('img').first()).toHaveAttribute('src', new RegExp(`/assets/${CROP_ASSET_ID}/download`))
  await expect(edges).toHaveCount(1)
  await expect(edges.first()).toHaveAttribute('data-id', 'original-edge')
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
  await page.screenshot({ path: testInfo.outputPath('independent-crop-node.png') })
})

test('自由裁剪上传失败时保留裁剪框并可重试', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { api, originalPng, state } = await installCropFixtures(page, true)
  await page.goto(`/canvas/${CANVAS_ID}`)
  const dialog = await openCrop(page)
  await dialog.getByRole('button', { name: '自由', exact: true }).click()
  const image = await dialog.getByRole('img', { name: '原图', exact: true }).boundingBox()
  const handle = await dialog.getByRole('button', { name: '调整裁剪范围（右下）', exact: true }).boundingBox()
  if (!image || !handle) throw new Error('裁剪图片或拖拽手柄未显示')
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x - image.width / 4, start.y - image.height / 4, { steps: 12 })
  await page.mouse.up()

  const size = dialog.getByRole('status', { name: '裁剪尺寸' })
  const match = (await size.textContent())?.match(/(\d+)\s*×\s*(\d+)/)
  if (!match) throw new Error('未显示裁剪像素尺寸')
  const crop = { x: 0, y: 0, width: Number(match[1]), height: Number(match[2]) }
  expect(Math.abs(crop.width - 240)).toBeLessThanOrEqual(1)
  expect(Math.abs(crop.height - 180)).toBeLessThanOrEqual(1)
  const submit = dialog.getByRole('button', { name: '裁剪并创建节点', exact: true })
  await submit.click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(size).toContainText(`${crop.width} × ${crop.height}`)
  await expect(submit).toBeEnabled()
  await expect(page.locator('.react-flow__node-image')).toHaveCount(1)
  expect(state.completed).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('free-crop-retry-narrow.png') })

  await submit.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.react-flow__node-image')).toHaveCount(2)
  expect(state.uploads).toHaveLength(2)
  expect(state.completed).toBe(1)
  expect(state.uploads[1]).toEqual(state.uploads[0])
  await assertCroppedPixels(page, originalPng, state.uploads[1], crop)
  expectNoUnexpectedApi(api)
})
