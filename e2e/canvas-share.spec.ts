import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

const node = (id: string, kind: string, x: number, data: Record<string, unknown>) => ({
  element_id: id,
  kind: 'node',
  payload: {
    id,
    type: kind,
    position: { x, y: 100 },
    style: { width: 260, height: 180 },
    data: { kind, ...data },
  },
})

test('免登录分享页展示公开素材与历史连线', async ({ page }) => {
  await page.route('**/api/v1/canvas-shares/shared-token**', async (route) => {
    const path = new URL(route.request().url()).pathname
    await route.fulfill({
      json: path.endsWith('/elements')
        ? {
            elements: [
              node('image', 'image', 80, {
                assetId: 12,
                resultUrl: '/api/v1/assets/12/download?workspace_id=3',
                publicResultUrl: '/shared/image.svg',
              }),
              node('text', 'text', 480, { text: '分享的画布文字' }),
              node('video', 'video', 880, { publicResultUrl: '/t1test.mp4' }),
              node('audio', 'audio', 1280, { publicResultUrl: '/shared/audio.wav' }),
              {
                element_id: 'edge-1',
                kind: 'edge',
                payload: {
                  id: 'edge-1',
                  source: 'image',
                  target: 'text',
                  sourceHandle: 'image-right-source',
                  targetHandle: 'text-left-target',
                },
              },
            ],
            has_more: false,
          }
        : { title: '分享测试画布', status: 'active' },
    })
  })
  await page.route('**/shared/image.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>',
    }),
  )
  await page.route('**/api/v1/assets/12/download**', (route) => route.fulfill({ status: 403 }))
  await page.route('**/shared/audio.wav', (route) => {
    const samples = 8000
    const wav = Buffer.alloc(44 + samples)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(36 + samples, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(8000, 24)
    wav.writeUInt32LE(8000, 28)
    wav.writeUInt16LE(1, 32)
    wav.writeUInt16LE(8, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(samples, 40)
    wav.fill(128, 44)
    return route.fulfill({ contentType: 'audio/wav', body: wav })
  })

  await page.goto('/canvas/share/shared-token', { waitUntil: 'domcontentloaded' })

  await expect(page.getByText('分享测试画布')).toBeVisible()
  await expect(page.getByRole('img', { name: '图片预览' })).toHaveJSProperty('complete', true)
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge-path')).toHaveAttribute('d', /[MLC]/)
  await expect(page.getByText('分享的画布文字')).toBeVisible()
  const viewport = page.locator('.react-flow__viewport')
  const initialTransform = await viewport.evaluate((el) => getComputedStyle(el).transform)
  await page.getByRole('button', { name: 'zoom in' }).click()
  await expect.poll(() => viewport.evaluate((el) => getComputedStyle(el).transform)).not.toBe(initialTransform)
  const zoomedTransform = await viewport.evaluate((el) => getComputedStyle(el).transform)
  await page.getByRole('button', { name: 'zoom out' }).click()
  await expect.poll(() => viewport.evaluate((el) => getComputedStyle(el).transform)).not.toBe(zoomedTransform)
  const video = page.locator('video[aria-label="视频预览"]')
  const audio = page.locator('audio[aria-label="音频试听"]')
  for (const media of [video, audio]) {
    await expect(media).toHaveAttribute('controls', '')
    await expect.poll(() => media.evaluate((el: HTMLMediaElement) => el.readyState)).toBeGreaterThan(0)
    await media.evaluate(async (el: HTMLMediaElement) => {
      el.muted = true
      await el.play()
    })
    await expect.poll(() => media.evaluate((el: HTMLMediaElement) => el.currentTime)).toBeGreaterThan(0)
    await media.evaluate((el: HTMLMediaElement) => el.pause())
  }
})

test('画布操作中暂不显示分享入口', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  let revision = 1
  let shareRequests = 0
  await page.route('**/api/v1/canvases/128**', async (route) => {
    const request = route.request()
    if (request.url().includes('/share')) {
      shareRequests++
      return route.fulfill({ json: {} })
    }
    if (request.method() === 'PATCH') return route.fulfill({ json: { sync_revision: ++revision } })
    return route.fulfill({
      json: request.url().includes('/elements')
        ? { elements: [], sync_revision: revision, history_floor_revision: 0, has_more: false }
        : { id: 128, title: '分享权限测试', status: 'active', revision },
    })
  })
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  await page.goto('/canvas/128')
  await expect(page.getByRole('button', { name: '分享这块画布' })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '分享画布' })).toHaveCount(0)
  expect(shareRequests).toBe(0)
  expectNoUnexpectedApi(api)
})
