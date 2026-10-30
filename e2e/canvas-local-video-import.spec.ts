import { expect, test, type Page } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const CANVAS_ID = 961
const VIDEO_BYTES = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])

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
  await page.goto(`/canvas/${CANVAS_ID}`)
  await expect(page.locator('.react-flow__pane')).toBeVisible()

  await page.locator('.canvas-view').evaluate(
    (root, bytes: number[]) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(bytes as number[])], 'source.MP4'))
      root.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    },
    [...VIDEO_BYTES],
  )

  const node = page.locator('.react-flow__node-video')
  await expect(node).toHaveCount(1)
  await expect(node).toContainText('视频')
  await expect.poll(uploadCompleted).toBe(true)
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
