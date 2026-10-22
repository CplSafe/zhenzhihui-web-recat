import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 768]) {
  test(`画布音频下载真实文件并可从失败恢复 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const api = await installStrictAuthenticatedApp(page)
    const errors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { code: 0, data: [] } }))
    await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: [] }))
    const wav = Buffer.alloc(4844)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(4836, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(24000, 24)
    wav.writeUInt32LE(48000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(4800, 40)
    let rejected = false
    await page.route('**/api/v1/assets/55/download?**', (route) => {
      expect(new URL(route.request().url()).searchParams.get('workspace_id')).toBe('21')
      return rejected
        ? route.fulfill({ status: 403, json: { message: '无权读取素材' } })
        : route.fulfill({ contentType: 'audio/wav', body: wav })
    })
    await page.route('**/api/v1/canvases/116**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? {
              elements: [
                {
                  element_id: 'audio-download',
                  kind: 'node',
                  op: 'upsert',
                  payload: {
                    id: 'audio-download',
                    type: 'audio',
                    position: { x: 400, y: 180 },
                    style: { width: 320, height: 120 },
                    data: {
                      kind: 'audio',
                      ...(width === 768 ? { audioRole: 'editor' } : {}),
                      title: '测试配音.mp3',
                      assetId: 55,
                      assetWorkspaceId: 21,
                      audio: { durationSec: 0.1, inSec: 0, outSec: 0.1, volume: 1, origin: 'upload' },
                    },
                  },
                },
              ],
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 116, title: 'Audio download', status: 'active', revision: 1 },
      }),
    )
    await page.goto('/canvas/116')
    await page.locator('.react-flow__node[data-id="audio-download"] .canvas-node-header').click()
    await page.getByRole('button', { name: /当前缩放.*点击回到 100%/ }).click()
    const toolbar = page.getByRole('toolbar', { name: '节点操作' })
    const button = toolbar.getByRole('button', { name: '下载素材', exact: true })
    await expect(toolbar.getByRole('button', { name: '重命名节点' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: '删除节点' })).toBeVisible()
    await expect(
      page.locator('.react-flow__node[data-id="audio-download"]').getByRole('button', { name: /下载/ }),
    ).toHaveCount(0)
    await expect(button).toBeEnabled()
    await expect
      .poll(async () => {
        const box = await button.boundingBox()
        return Boolean(box && box.x >= 0 && box.x + box.width <= width)
      })
      .toBe(true)
    await expect(
      page.locator('.react-flow__node[data-id="audio-download"]').getByRole('link', { name: '下载音频' }),
    ).toHaveCount(0)
    const pending = page.waitForEvent('download')
    await button.click()
    const download = await pending
    expect(download.suggestedFilename()).toBe('测试配音.wav')
    const saved = testInfo.outputPath('saved-audio.wav')
    await download.saveAs(saved)
    expect(await readFile(saved)).toEqual(wav)
    await expect(button).toBeEnabled()
    await button.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`audio-download-${width}.png`) })
    rejected = true
    await button.click()
    await expect(page.getByText('音频下载失败，请稍后重试', { exact: true })).toBeVisible()
    await expect(button).toBeEnabled()
    rejected = false
    const retry = page.waitForEvent('download')
    await button.click()
    expect((await retry).suggestedFilename()).toBe('测试配音.wav')
    expect(errors).toEqual([])
    expect(consoleErrors.every((message) => message.includes('403'))).toBe(true)
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
