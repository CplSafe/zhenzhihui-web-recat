import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('保留基础音轨编辑，隐藏上一轮增强', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
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
  await page.route('**/api/v1/assets/201/download**', (route) => route.fulfill({ contentType: 'audio/wav', body: wav }))
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
            clips: [{ id: 'clip', assetId: 601, sourceDurationSec: 5, inSec: 0, outSec: 5 }],
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
  const slider = dialog.getByRole('slider', { name: '旁白音轨位置' })
  await expect(dialog).toBeVisible()
  await expect(slider).toHaveCount(0)
  await expect(dialog.getByText(/按住 Alt 临时关闭吸附/)).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('audio-basic-preserved.png') })
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})
