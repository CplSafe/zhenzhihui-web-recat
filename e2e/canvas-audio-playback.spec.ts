import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('音频通过不支持分段的素材地址加载后可播放、暂停和定位', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: { items: [] } }))
  const frames = 24000 * 4
  const wav = Buffer.alloc(44 + frames * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(24000, 24)
  wav.writeUInt32LE(48000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < frames; i++)
    wav.writeInt16LE(Math.round(14000 * Math.sin((2 * Math.PI * 440 * i) / 24000)), 44 + i * 2)
  let downloads = 0
  await page.route('**/api/v1/assets/55/download?**', (route) => {
    downloads++
    // Simulate the actual proxy shape: full 200 response, no Range support, generic content type.
    return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: wav })
  })
  await page.route('**/api/v1/canvases/155**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: Number(url.searchParams.get('after_revision') || 0)
              ? []
              : [
                  {
                    element_id: 'audio-playback',
                    kind: 'node',
                    op: 'upsert',
                    payload: {
                      id: 'audio-playback',
                      type: 'audio',
                      position: { x: 400, y: 200 },
                      style: { width: 320, height: 120 },
                      data: {
                        kind: 'audio',
                        title: '播放测试',
                        assetId: 55,
                        assetWorkspaceId: WORKSPACE_ID,
                        audio: { durationSec: 4, outSec: 4, volume: 1, origin: 'generated' },
                      },
                    },
                  },
                ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 155, title: '音频播放测试', status: 'active', revision: 1 },
    })
  })
  await page.route('**/api/v1/canvases/155/events?**', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: ': ready\n\n' }),
  )
  await page.goto('/canvas/155')
  const node = page.locator('.react-flow__node[data-id="audio-playback"]')
  await expect(node).toBeVisible({ timeout: 30000 })
  const play = node.getByRole('button', { name: '播放音频' })
  await expect(play).toBeEnabled({ timeout: 30000 })
  const audio = node.locator('audio')
  await expect(audio).toHaveAttribute('src', /^blob:/)
  await play.click()
  await expect(node.getByRole('button', { name: '暂停音频' })).toBeVisible()
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(0.3)
  await page.screenshot({ path: testInfo.outputPath('audio-playing.png') })
  await node.getByRole('button', { name: '暂停音频' }).click()
  await expect(node.getByRole('button', { name: '播放音频' })).toBeVisible()
  await node.getByRole('slider', { name: '音频播放进度' }).fill('2')
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(1.9)
  await node.getByRole('button', { name: '播放音频' }).click()
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(2.2)
  expect(downloads).toBe(1)
  expect(errors).toEqual([])
  expect(consoleErrors).toEqual([])
  expectNoUnexpectedApi(api)
})
