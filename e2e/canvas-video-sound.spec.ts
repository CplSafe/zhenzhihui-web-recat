import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('视频放大预览默认有声，自动播放受阻后保持声音开启，关闭重开恢复默认', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => {
    expect(route.request().method()).toBe('GET')
    return route.fulfill({ json: { code: 0, data: [] } })
  })
  await page.route('**/api/v1/assets', (route) => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toMatchObject({ workspace_id: 21, source: 'canvas-poster' })
    return route.fulfill({ status: 503, json: { message: '测试环境不保存封面' } })
  })
  await page.addInitScript(() => {
    const originalPlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      if (this.closest('[role="dialog"]'))
        return Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'))
      return originalPlay.call(this)
    }
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/canvases/122**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'video',
                kind: 'node',
                payload: {
                  id: 'video',
                  type: 'video',
                  position: { x: 300, y: 200 },
                  style: { width: 320, height: 240 },
                  data: { kind: 'video', title: '有声视频', resultUrl: '/api/v1/assets/601/download?workspace_id=21' },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 122, title: '默认有声验证', revision: 1 },
    }),
  )
  await page.goto('/canvas/122')
  const nodeVideo = page.locator('.react-flow__node[data-id="video"] video')
  await expect(nodeVideo).toBeVisible()
  await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('100')
  await expect
    .poll(() => page.locator('.react-flow__viewport').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a))
    .toBe(1)
  let finishDownload!: () => void
  const downloadGate = new Promise<void>((resolve) => {
    finishDownload = resolve
  })
  let fetches = 0
  await page.route('**/api/v1/assets/601/download**', async (route) => {
    if (route.request().resourceType() === 'fetch') {
      fetches += 1
      await downloadGate
    }
    await route.fallback()
  })
  await page
    .locator('.react-flow__node[data-id="video"]')
    .getByRole('button', { name: '放大视频', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: '视频预览', exact: true })
  const video = dialog.locator('video')
  await expect(dialog).toBeVisible()
  await expect.poll(() => fetches).toBe(1)
  await expect(dialog.getByRole('status')).toBeVisible()
  await expect(video).not.toHaveAttribute('src')
  await expect(video).toHaveJSProperty('paused', true)
  await page.screenshot({ path: 'test-results/canvas-video-preparing.png' })
  finishDownload()
  await expect(video).toHaveAttribute('src', /^blob:/)
  await expect(video).toHaveJSProperty('readyState', 4)
  await expect(video).toHaveJSProperty('muted', false)
  await expect(video).toHaveJSProperty('volume', 1)
  await dialog.getByRole('button', { name: '静音视频', exact: true }).click()
  await expect(video).toHaveJSProperty('muted', true)
  await expect(dialog.getByRole('button', { name: '开启视频声音', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await dialog.getByRole('button', { name: '开启视频声音', exact: true }).click()
  await expect(video).toHaveJSProperty('muted', false)
  await dialog.getByRole('button', { name: '静音视频', exact: true }).click()
  await page.getByRole('button', { name: '收起', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page
    .locator('.react-flow__node[data-id="video"]')
    .getByRole('button', { name: '放大视频', exact: true })
    .click()
  await expect(video).toBeVisible()
  await expect(video).toHaveJSProperty('readyState', 4)
  await expect(video).toHaveJSProperty('muted', false)
  await expect(video).toHaveJSProperty('volume', 1)
  await page.screenshot({ path: 'test-results/canvas-video-sound.png' })
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})
