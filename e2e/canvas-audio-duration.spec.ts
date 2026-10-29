import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('连接配音时禁止短于配音的视频时长和最大时长不足的模型', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 101,
            display_name: '最多10秒模型',
            operation_codes: ['video.generate'],
            input_constraints: { 'video.generate': { roles: [{ role: 'audio', max_count: 1 }] } },
            params_schema: { fields: [{ name: 'duration', display_name: '时长', options: [5, 10], default: 5 }] },
          },
          {
            id: 102,
            display_name: '最多15秒模型',
            operation_codes: ['video.generate'],
            input_constraints: { 'video.generate': { roles: [{ role: 'audio', max_count: 1 }] } },
            params_schema: { fields: [{ name: 'duration', display_name: '时长', options: [5, 10, 15], default: 5 }] },
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/ai/tasks/estimate-cost', (route) =>
    route.fulfill({ json: { estimated_cost: 10, balance: 1000, can_afford: true } }),
  )

  const audio = {
    lane: 'voice',
    durationSec: 11,
    inSec: 0,
    outSec: 11,
    startSec: 0,
    volume: 1,
    muted: false,
    loop: false,
    fadeInSec: 0,
    fadeOutSec: 0,
    origin: 'generated',
  }
  let revision = 1
  const elements = [
    {
      element_id: 'voice',
      kind: 'node',
      payload: {
        id: 'voice',
        type: 'audio',
        position: { x: 100, y: 120 },
        style: { width: 280, height: 150 },
        data: {
          kind: 'audio',
          title: '11秒旁白',
          assetId: 55,
          assetWorkspaceId: WORKSPACE_ID,
          resultUrl: `/api/v1/assets/55/download?workspace_id=${WORKSPACE_ID}`,
          audio,
        },
      },
    },
    {
      element_id: 'video',
      kind: 'node',
      payload: {
        id: 'video',
        type: 'video',
        position: { x: 520, y: 120 },
        style: { width: 320, height: 240 },
        data: { kind: 'video', prompt: '根据连接的旁白生成视频', params: { duration: 5 }, videoMode: 'auto' },
      },
    },
    {
      element_id: 'voice-to-video',
      kind: 'edge',
      payload: { id: 'voice-to-video', source: 'voice', target: 'video', data: { slotIndex: 0 } },
    },
  ]
  await page.route('**/api/v1/canvases/126**', (route) => {
    if (route.request().method() === 'PATCH')
      return route.fulfill({ json: { revision: ++revision, sync_revision: revision } })
    const url = new URL(route.request().url())
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: Number(url.searchParams.get('after_revision') || 0) > 0 ? [] : elements,
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 126, title: '配音时长限制验证', revision },
    })
  })

  const wav = Buffer.alloc(44 + 264000 * 2)
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
  await page.route('**/api/v1/assets/55/download**', (route) => route.fulfill({ contentType: 'audio/wav', body: wav }))

  let taskSubmissions = 0
  await page.route('**/api/v1/ai/tasks', (route) => {
    taskSubmissions++
    return route.fulfill({ status: 400, json: { message: '该用例不应提交生成任务' } })
  })
  await page.goto('/canvas/126')
  await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('100')
  const videoNode = page.locator('.react-flow__node[data-id="video"]')
  await expect(videoNode).toBeVisible()
  await videoNode.click()
  const panel = page.locator('[data-canvas-node-panel]')
  await expect(panel.locator('[data-canvas-generate]')).toBeDisabled()

  await panel.getByRole('button', { name: '最多15秒模型' }).click()
  const shortModel = page.getByRole('option', { name: /最多10秒模型/ })
  await expect(shortModel).toHaveAttribute('aria-disabled', 'true')
  await expect(shortModel).toContainText('已连接的配音约 11 秒')
  await expect(page.getByRole('option', { name: /最多15秒模型/ })).not.toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')

  await panel.getByRole('button', { name: /自由生成/ }).click()
  const paramsRegion = page.getByRole('region', { name: '生成参数' })
  const durationOptions = page.getByRole('listbox', { name: '时长' })
  await expect(paramsRegion).toContainText('已连接的配音约 11 秒')
  await expect(durationOptions.getByRole('option', { name: '5秒', exact: true })).toBeDisabled()
  await expect(durationOptions.getByRole('option', { name: '10秒', exact: true })).toBeDisabled()
  await expect(durationOptions.getByRole('option', { name: '15秒', exact: true })).toBeEnabled()
  await expect(panel.locator('[data-canvas-generate]')).toHaveAttribute('title', /视频时长短于配音时长/)
  expect(taskSubmissions).toBe(0)
  expect(api.paidTaskSubmissions).toBe(0)
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
  await page.screenshot({ path: testInfo.outputPath('connected-audio-duration-guard.png') })
})
