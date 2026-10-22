import { expect, test } from '@playwright/test'
import { setupVoiceLibrary } from './fixtures/canvas-voice-library'
import { expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

function trainingWav(seconds: number) {
  const samples = Math.round(seconds * 24000)
  const wav = Buffer.alloc(44 + samples * 2)
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
  wav.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index++)
    wav.writeInt16LE(Math.round(Math.sin(index / 20) * 5000), 44 + index * 2)
  return wav
}

for (const width of [1440, 390]) {
  test(`现场录音试听重录、十秒门槛、授权和提交 ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width, height: 1000 })
    // 仅以合成音源替代输入设备；录制、解码、WAV转换及预览使用真实浏览器实现。
    await page.addInitScript(() => {
      const state = window as unknown as { micCalls: number; micTracks: MediaStreamTrack[] }
      state.micCalls = 0
      state.micTracks = []
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => {
          state.micCalls++
          const context = new AudioContext()
          await context.resume()
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          gain.gain.value = 0.3
          const destination = context.createMediaStreamDestination()
          oscillator.connect(gain).connect(destination)
          oscillator.start()
          const track = destination.stream.getAudioTracks()[0]
          state.micTracks.push(track)
          const stop = track.stop.bind(track)
          track.stop = () => {
            stop()
            oscillator.stop()
            void context.close()
          }
          return destination.stream
        },
      })
    })
    const { modal, createRequests, errors, state } = await setupVoiceLibrary(page)
    let assetCreates = 0
    await page.route('**/api/v1/assets', (route) => {
      assetCreates++
      expect(route.request().postDataJSON()).toMatchObject({ workspace_id: 21, mime_type: 'audio/wav', type: 'audio' })
      return route.fulfill({
        json: {
          asset: { id: 55 },
          upload: { url: 'https://voice-test.oss-cn-beijing.aliyuncs.com/upload', form_fields: {} },
        },
      })
    })
    await page.route('https://voice-test.oss-cn-beijing.aliyuncs.com/upload', (route) => {
      const body = route.request().postDataBuffer()!
      const start = body.indexOf(Buffer.from('RIFF'))
      expect(start).toBeGreaterThan(0)
      expect(body.toString('ascii', start + 8, start + 12)).toBe('WAVE')
      expect(body.readUInt32LE(start + 40) / body.readUInt32LE(start + 28)).toBeGreaterThanOrEqual(10)
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    })
    await page.route('**/api/v1/assets/55/complete?**', (route) => route.fulfill({ json: { id: 55, status: 'ready' } }))
    await modal.getByRole('button', { name: '我的音色', exact: true }).click()
    await modal.getByRole('button', { name: '添加音色', exact: true }).click()
    const reference = modal.getByLabel('录音参考文案', { exact: true })
    const language = modal.getByRole('combobox', { name: '参考文案语言', exact: true })
    await expect(reference).toContainText('今天天气真好，我带着家人去公园散步。')
    await reference.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`recording-reference-zh-${width}.png`) })
    await language.selectOption('en')
    await expect(reference).toContainText(
      'The sun is shining, the birds are singing, and now everything feels fresh and new.',
    )
    await expect(reference).toHaveAttribute('lang', 'en')
    await reference.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`recording-reference-en-${width}.png`) })
    await modal.getByLabel('音色名称', { exact: true }).fill('现场录制音色')
    expect(await page.evaluate(() => (window as unknown as { micCalls: number }).micCalls)).toBe(0)
    await modal.getByRole('button', { name: '开始录音', exact: true }).click()
    await expect(modal.getByRole('button', { name: '结束录音' })).toBeVisible()
    await expect(reference).toBeVisible()
    await language.selectOption('zh')
    await expect(reference).toContainText('享受着这美好的一天。')
    await expect(modal.getByRole('button', { name: '结束录音' })).toBeVisible()
    await expect(modal.getByLabel('上传训练录音')).toBeDisabled()
    await modal.getByRole('button', { name: '结束录音' }).click()
    await expect(modal.getByLabel('试听现场录音')).toBeVisible()
    await expect(modal.getByRole('button', { name: '使用这段录音' })).toBeDisabled()
    await expect(modal.getByRole('alert')).toContainText('至少 10 秒')
    await page.screenshot({ path: testInfo.outputPath(`short-recording-${width}.png`) })
    expect(assetCreates).toBe(0)
    await modal.getByRole('button', { name: '重新录音' }).click()
    await expect(modal.getByText(/已达到最低时长/)).toBeVisible({ timeout: 20000 })
    await modal.getByRole('button', { name: '结束录音' }).click()
    await expect(modal.getByRole('button', { name: '使用这段录音' })).toBeEnabled()
    await modal.getByLabel('试听现场录音').evaluate(async (audio: HTMLAudioElement) => {
      await audio.play()
    })
    await expect
      .poll(() => modal.getByLabel('试听现场录音').evaluate((audio: HTMLAudioElement) => audio.currentTime))
      .toBeGreaterThan(0)
    await page.screenshot({ path: testInfo.outputPath(`recording-preview-${width}.png`) })
    await modal.getByRole('button', { name: '使用这段录音' }).click()
    await expect(modal.getByLabel('试听训练录音')).toBeVisible()
    await expect(modal.getByRole('button', { name: '提交复刻' })).toBeDisabled()
    expect(assetCreates).toBe(0)
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { micTracks: MediaStreamTrack[] }).micTracks.every(
            (track) => track.readyState === 'ended',
          ),
        ),
      )
      .toBe(true)
    await modal.getByRole('checkbox', { name: '我确认声音属于本人或已获得音色复刻授权' }).check()
    await modal.getByRole('button', { name: '提交复刻' }).click()
    await expect(modal.getByText('现场录制音色', { exact: true })).toBeVisible()
    expect(assetCreates).toBe(1)
    expect(createRequests).toHaveLength(1)
    expect(createRequests[0]).toMatchObject({ provider: 'minimax', sample_asset_id: 55 })
    expect(errors).toEqual([])
    expect(state.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(state)
  })
}

test('上传音频十秒边界、不可播放校验及关闭确认', async ({ page }, testInfo) => {
  const { modal, createRequests, errors, state } = await setupVoiceLibrary(page)
  await modal.getByRole('button', { name: '我的音色', exact: true }).click()
  await modal.getByRole('button', { name: '添加音色', exact: true }).click()
  await expect(modal.getByText(/请上传至少 10 秒的清晰人声音频/)).toBeVisible()
  await modal.getByLabel('音色名称', { exact: true }).fill('上传音色')
  const upload = modal.getByLabel('上传训练录音')
  await upload.setInputFiles({ name: 'short.wav', mimeType: 'audio/wav', buffer: trainingWav(9.9) })
  await expect(modal.getByRole('alert')).toContainText('至少 10 秒')
  await modal.getByRole('checkbox', { name: '我确认声音属于本人或已获得音色复刻授权' }).check()
  await expect(modal.getByRole('button', { name: '提交复刻' })).toBeDisabled()
  await upload.setInputFiles({ name: 'valid.wav', mimeType: 'audio/wav', buffer: trainingWav(10) })
  await expect(modal.getByRole('alert')).toHaveCount(0)
  await expect(modal.getByRole('checkbox', { name: '我确认声音属于本人或已获得音色复刻授权' })).not.toBeChecked()
  await modal.getByRole('checkbox', { name: '我确认声音属于本人或已获得音色复刻授权' }).check()
  await expect(modal.getByRole('button', { name: '提交复刻' })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('upload-valid-ten-seconds.png') })
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  const confirm = page.getByRole('alertdialog', { name: '丢弃录音', exact: true })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '取消', exact: true }).click()
  await expect(modal.getByLabel('音色名称')).toHaveValue('上传音色')
  await upload.setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('broken audio') })
  await expect(modal.getByRole('alert')).toContainText('无法读取录音')
  await expect(modal.getByRole('button', { name: '提交复刻' })).toBeDisabled()
  expect(createRequests).toHaveLength(0)
  expect(errors).toEqual([])
  expectNoUnexpectedApi(state)
})

test('拒绝麦克风权限可改用上传，等待授权取消后释放迟到麦克风', async ({ page }) => {
  await page.addInitScript(() => {
    let count = 0
    const state = window as unknown as { resolveMic: (stream: MediaStream) => void; stopped: number }
    state.stopped = 0
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        if (++count === 1) throw new DOMException('denied', 'NotAllowedError')
        return new Promise<MediaStream>((resolve) => {
          state.resolveMic = resolve
        })
      },
    })
  })
  const { modal, createRequests, errors, state } = await setupVoiceLibrary(page)
  await modal.getByRole('button', { name: '我的音色', exact: true }).click()
  await modal.getByRole('button', { name: '添加音色', exact: true }).click()
  await modal.getByRole('button', { name: '开始录音', exact: true }).click()
  await expect(modal.getByRole('alert')).toContainText('网站权限')
  await expect(modal.getByLabel('上传训练录音')).toBeEnabled()
  await modal.getByRole('button', { name: '开始录音', exact: true }).click()
  await expect(modal.getByText(/等待麦克风授权/)).toBeVisible()
  await modal.getByRole('button', { name: '取消录音', exact: true }).click()
  await page.evaluate(() => {
    const state = window as unknown as { resolveMic: (stream: MediaStream) => void; stopped: number }
    state.resolveMic({
      getTracks: () => [
        {
          stop: () => {
            state.stopped++
          },
        },
      ],
    } as unknown as MediaStream)
  })
  await expect.poll(() => page.evaluate(() => (window as unknown as { stopped: number }).stopped)).toBe(1)
  await expect(modal.getByRole('button', { name: '开始录音', exact: true })).toBeEnabled()
  expect(createRequests).toHaveLength(0)
  expect(errors).toEqual([])
  expectNoUnexpectedApi(state)
})
