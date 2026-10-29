import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const customized of [false, true]) {
  test(`视频剪辑播放、逐帧与波纹删除（自定义=${customized}）`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const api = await installStrictAuthenticatedApp(page)
    const keys = customized
      ? { play: 'p', split: 'x', remove: 'r', left: 'j', right: 'k', undo: 'Control+u' }
      : { play: 'Space', split: 'c', remove: 'b', left: 'ArrowLeft', right: 'ArrowRight', undo: 'Control+z' }
    if (customized)
      await page.addInitScript(() =>
        localStorage.setItem(
          'zzh_canvas_preferences',
          JSON.stringify({
            shortcutsVersion: 3,
            shortcuts: {
              timelinePlay: 'P',
              timelineSplit: 'X',
              timelineRippleDelete: 'R',
              timelineBack: 'J',
              timelineForward: 'K',
              timelineBackSecond: 'Shift+J',
              timelineForwardSecond: 'Shift+K',
              undo: 'Mod+U',
            },
          }),
        ),
      )

    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    const wav = Buffer.alloc(44 + 24000 * 2 * 5)
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
    wav.writeUInt32LE(wav.length - 44, 40)
    await page.route('**/api/v1/assets/201/download**', (route) =>
      route.fulfill({ contentType: 'audio/wav', body: wav }),
    )
    await page.route('**/api/v1/assets/601/download**', (route) =>
      route.fulfill({ path: 'public/tutorials/canvas.mp4', contentType: 'video/mp4' }),
    )
    const audio = {
      lane: 'voice',
      durationSec: 5,
      inSec: 0,
      outSec: 5,
      startSec: 0,
      volume: 1,
      muted: false,
      loop: false,
      fadeInSec: 0,
      fadeOutSec: 0,
      origin: 'generated',
    }
    const elements = [
      {
        element_id: 'voice',
        kind: 'node',
        op: 'upsert',
        payload: {
          id: 'voice',
          type: 'audio',
          position: { x: 100, y: 100 },
          data: { kind: 'audio', title: '旁白', assetId: 201, audio },
          style: { width: 300, height: 160 },
        },
      },
      {
        element_id: 'edit',
        kind: 'node',
        op: 'upsert',
        payload: {
          id: 'edit',
          type: 'timeline',
          position: { x: 500, y: 100 },
          data: {
            kind: 'timeline',
            title: '音轨编辑验证',
            timeline: {
              clips: [{ id: 'clip', assetId: 601, sourceDurationSec: 5, inSec: 0, outSec: 4 }],
              audioClips: [{ ...audio, sourceNodeId: 'voice', assetId: 201, title: '旁白' }],
            },
          },
          style: { width: 460, height: 400 },
        },
      },
      {
        element_id: 'voice-edge',
        kind: 'edge',
        op: 'upsert',
        payload: { id: 'voice-edge', source: 'voice', target: 'edit' },
      },
    ]
    await page.route('**/api/v1/canvases/143**', (route) => {
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
      const url = new URL(route.request().url())
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : elements,
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 143, title: '音轨编辑验证', revision: 1 },
      })
    })
    await page.goto('/canvas/143')
    await page.locator('.react-flow__node[data-id="edit"] .canvas-node-header').click()
    await page.locator('.react-flow__node[data-id="edit"]').getByRole('button', { name: '精修', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '视频剪辑', exact: true })
    await expect(dialog).toBeVisible()
    const playhead = dialog.getByRole('slider', { name: '播放头', exact: true })
    await expect(dialog).toBeFocused()
    await page.keyboard.press(keys.right)
    await expect(playhead).toHaveAttribute('aria-valuenow', '0.04')
    await playhead.focus()
    await page.keyboard.press(keys.right)
    await expect(playhead).toHaveAttribute('aria-valuenow', '0.08')
    await page.keyboard.press(keys.left)
    await page.keyboard.press(keys.left)
    await expect(playhead).toHaveAttribute('aria-valuenow', '0')
    await dialog.focus()
    const play = dialog.getByRole('button', { name: '播放', exact: true })
    await expect(play).toBeEnabled()
    await page.keyboard.press(keys.play)
    await expect(dialog.getByRole('button', { name: '暂停', exact: true })).toBeVisible()
    await page.keyboard.press(keys.play)
    await expect(play).toBeVisible()
    // 回到开始，避免真实媒体播放时钟影响下面的精确分割断言。
    await playhead.focus()
    await page.keyboard.press('Home')
    await expect(playhead).toHaveAttribute('aria-valuenow', '0')
    await dialog.focus()
    await page.keyboard.press(`Shift+${keys.right}`)
    if (customized) {
      await page.keyboard.press('c')
      await expect(dialog.getByLabel('片段列表').getByRole('listitem')).toHaveCount(1)
    }
    await page.keyboard.press(keys.split)
    await expect(dialog.getByLabel('片段列表').getByRole('listitem')).toHaveCount(2)
    await expect(dialog.getByText('2 段 · 共 00:04.0')).toBeVisible()
    await page.keyboard.press(keys.remove)
    await expect(dialog.getByLabel('片段列表').getByRole('listitem')).toHaveCount(1)
    await expect(dialog.getByText('1 段 · 共 00:03.0')).toBeVisible()
    await page.keyboard.press(keys.undo)
    await expect(dialog.getByLabel('片段列表').getByRole('listitem')).toHaveCount(2)
    await dialog.getByRole('button', { name: '片段 2', exact: true }).click()
    await dialog.getByLabel('终点', { exact: true }).focus()
    await page.keyboard.press(keys.remove)
    await expect(dialog.getByLabel('片段列表').getByRole('listitem')).toHaveCount(2)
    await dialog.getByRole('button', { name: '片段 2', exact: true }).focus()
    await page.keyboard.press('Control+b')
    await expect(dialog.getByLabel('片段列表').getByRole('listitem')).toHaveCount(2)
    await page.keyboard.press(keys.remove)
    await expect(dialog.getByText('1 段 · 共 00:01.0')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('timeline-shortcuts.png') })
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
