import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const failOnce of [false, true])
  test(`恢复视频任务合入原配音、关闭模型原声，刷新不重复生成 failOnce=${failOnce}`, async ({ page }, testInfo) => {
    test.setTimeout(90000)
    const api = await installStrictAuthenticatedApp(page)
    const video = await readFile('public/tutorials/hot-copy.mp4')
    const wav = Buffer.alloc(44 + 24000)
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
    wav.writeUInt32LE(24000, 40)
    for (let i = 0; i < 12000; i++)
      wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 16000), 44 + i * 2)
    let saved: any = {
      element_id: 'video',
      kind: 'node',
      op: 'upsert',
      payload: {
        id: 'video',
        type: 'video',
        position: { x: 300, y: 100 },
        style: { width: 320, height: 260 },
        data: {
          kind: 'video',
          title: '保留原配音',
          prompt: '画面描述',
          operationCode: 'video.generate',
          taskId: 801,
          taskStatus: 'processing',
          posterAssetId: 703,
          taskRunId: 'voice-run',
          taskIdempotencyKey: 'voice-key',
          videoAudioComposition: {
            submissionKey: 'voice-key',
            clips: [
              {
                sourceNodeId: 'original-voice',
                assetId: 55,
                title: '440Hz 原配音',
                lane: 'voice',
                durationSec: 0.5,
                inSec: 0,
                outSec: 0.5,
                startSec: 0,
                volume: 1,
                muted: false,
                loop: false,
                fadeInSec: 0,
                fadeOutSec: 0,
                origin: 'generated',
              },
            ],
          },
        },
      },
    }
    let uploads = 0
    let composed: Buffer | null = null
    let revision = 1
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/ai/tasks/801?**', (route) =>
      route.fulfill({ json: { id: 801, status: 'succeeded', outputs: [{ asset_id: 701, type: 'video' }] } }),
    )
    await page.route('**/api/v1/assets?**', (route) =>
      route.fulfill({
        json: { items: [{ id: 701, type: 'video', status: 'ready', workspace_id: 21, source_task_id: 801 }], total: 1 },
      }),
    )
    await page.route('**/api/v1/assets/701/download?**', (route) =>
      route.fulfill({ contentType: 'video/mp4', body: video }),
    )
    await page.route('**/api/v1/assets/55/download?**', (route) =>
      route.fulfill({ contentType: 'audio/wav', body: wav }),
    )
    await page.route('**/api/v1/assets/703/download?**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6jVQAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    )
    await page.route('**/api/v1/assets', (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ workspace_id: 21, mime_type: 'video/mp4' })
      uploads++
      return route.fulfill({
        json: {
          asset: { id: 702 },
          upload: { url: 'https://voice-test.oss-cn-beijing.aliyuncs.com/upload', form_fields: {} },
        },
      })
    })
    let rejected = false
    await page.route('https://voice-test.oss-cn-beijing.aliyuncs.com/upload', (route) => {
      if (failOnce && !rejected) {
        rejected = true
        return route.fulfill({ status: 400, body: '模拟合成视频上传失败' })
      }
      const body = route.request().postDataBuffer()!
      const start = body.indexOf(Buffer.from('ftyp')) - 4
      const end = body.lastIndexOf(Buffer.from('\r\n--'))
      expect(start).toBeGreaterThan(0)
      composed = body.subarray(start, end)
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    })
    await page.route('**/api/v1/assets/702/complete?**', (route) =>
      route.fulfill({ json: { id: 702, status: 'ready' } }),
    )
    await page.route('**/api/v1/assets/702/download?**', (route) =>
      route.fulfill({ contentType: 'video/mp4', body: composed! }),
    )
    await page.route('**/api/v1/canvases/129**', (route) => {
      if (route.request().method() === 'PATCH') {
        for (const element of route.request().postDataJSON().mutations || [])
          if (element.element_id === 'video' && element.payload) saved = element
        return route.fulfill({ json: { sync_revision: ++revision } })
      }
      const url = new URL(route.request().url())
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [saved],
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 129, title: '原配音合成验证', status: 'active', revision },
      })
    })
    await page.goto('/canvas/129')
    if (failOnce) {
      await expect.poll(() => saved.payload.data.taskStatus, { timeout: 60000 }).toBe('result_sync_failed')
      await page.screenshot({ path: testInfo.outputPath('voice-composition-retry.png') })
      await page.getByRole('button', { name: '重试配音合成', exact: true }).click()
    }
    await expect.poll(() => saved.payload.data.assetId, { timeout: 60000 }).toBe(702)
    expect(saved.payload.data.videoAudioComposition.result).toEqual({ sourceAssetId: 701, assetId: 702 })
    expect(saved.payload.data.resultHistory.at(-1).assetId).toBe(702)
    expect(uploads).toBe(failOnce ? 2 : 1)
    const audioEvidence = await page.evaluate(async () => {
      const context = new AudioContext()
      try {
        const response = await fetch('/api/v1/assets/702/download?workspace_id=21')
        const decoded = await context.decodeAudioData(await response.arrayBuffer())
        const values = decoded.getChannelData(0)
        const rms = (start: number, end: number) => {
          const part = values.subarray(Math.floor(start * decoded.sampleRate), Math.floor(end * decoded.sampleRate))
          return Math.sqrt(part.reduce((sum, value) => sum + value * value, 0) / part.length)
        }
        let crossings = 0
        for (let i = Math.floor(0.1 * decoded.sampleRate); i < Math.floor(0.4 * decoded.sampleRate); i++)
          if (values[i] <= 0 && values[i + 1] > 0) crossings++
        return { rms: rms(0.1, 0.4), silence: rms(1, 2), frequency: crossings / 0.3 }
      } finally {
        await context.close()
      }
    })
    expect(audioEvidence.rms).toBeGreaterThan(0.2)
    expect(audioEvidence.frequency).toBeCloseTo(440, -1)
    expect(audioEvidence.silence).toBeLessThan(0.001)
    const player = page.locator('.react-flow__node[data-id="video"] video').first()
    await expect(player).toHaveAttribute('src', /assets\/702\/download/)
    await expect.poll(() => player.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath('video-original-voice.png') })
    await page.reload()
    await expect(page.locator('.react-flow__node[data-id="video"] video').first()).toHaveAttribute(
      'src',
      /assets\/702\/download/,
    )
    expect(uploads).toBe(failOnce ? 2 : 1)
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
