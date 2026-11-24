import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  expectNoUnexpectedApi,
  fulfillFixtureVideo,
  installStrictAuthenticatedApp,
  WORKSPACE_ID,
} from './fixtures/strict-authenticated-app'

const canvasId = 968
const sourceAssetId = 1708
const trimmedAssetId = 1709
const activeTaskId = 1710
const uploadUrl = 'https://canvas-test.oss-cn-beijing.aliyuncs.com/video-trim'
type Element = {
  element_id: string
  kind: 'node' | 'edge'
  op: 'upsert' | 'delete'
  payload: Record<string, unknown>
}

const labels = {
  lossless: '视频无损裁剪本地生成可播放文件，保存到原节点并保留连线',
  precise: '视频精确裁剪本地生成可播放文件，保存到原节点并保留连线',
  timeline: '只有一条视频的剪辑时间线可以合成并产出视频',
  generating: '已有结果的视频节点正在生成时不能裁剪旧视频',
} as const

for (const mode of ['lossless', 'precise', 'timeline', 'generating'] as const) {
  const precise = mode === 'precise'
  const timeline = mode === 'timeline'
  const generating = mode === 'generating'
  const label = labels[mode]
  test(label, async ({ page, browserName }, testInfo) => {
    test.skip(precise && browserName !== 'chromium', '精确裁剪案例使用 Chromium 的 H.264 WebCodecs')
    await page.setViewportSize({ width: 1024, height: 700 })
    const api = await installStrictAuthenticatedApp(page)
    const source = await readFile('e2e/fixtures/canvas-video-trim-12s.mp4')
    const position = { x: 90, y: 115 }
    const data = {
      kind: 'video',
      title: '待裁剪视频',
      assetId: sourceAssetId,
      assetWorkspaceId: WORKSPACE_ID,
      ...(generating ? { taskId: activeTaskId, taskStatus: 'running' } : {}),
    }
    const edge = { source: 'video-source', target: 'next-node', data: { slotIndex: 0 } }
    const initialElements: Element[] = [
      { element_id: 'video-source', kind: 'node', op: 'upsert', payload: { type: 'video', position, data } },
      {
        element_id: 'next-node',
        kind: 'node',
        op: 'upsert',
        payload: { type: 'video', position: { x: 540, y: 115 }, data: { kind: 'video', title: '下游节点' } },
      },
      { element_id: 'original-edge', kind: 'edge', op: 'upsert', payload: edge },
    ]
    if (timeline) {
      initialElements.push({
        element_id: 'timeline',
        kind: 'node',
        op: 'upsert',
        payload: {
          type: 'timeline',
          position: { x: 660, y: 170 },
          style: { width: 460, height: 400 },
          data: {
            kind: 'timeline',
            title: '单视频剪辑',
            timeline: {
              clips: [{ id: 'clip', assetId: sourceAssetId, sourceDurationSec: 12, inSec: 1, outSec: 10.005 }],
            },
          },
        },
      })
    }
    const elements = new Map(initialElements.map((element) => [element.element_id, element]))
    let revision = 1
    let creates = 0
    let upload: Buffer<ArrayBuffer> | undefined
    await page.addInitScript((url) => {
      const originalFetch = window.fetch
      window.fetch = async (input, init) => {
        if (String(input) === url && init?.body instanceof FormData) {
          const file = init.body.get('file')
          if (file instanceof File) {
            ;(window as Window & { uploadedTrim?: number[] }).uploadedTrim = [
              ...new Uint8Array(await file.arrayBuffer()),
            ]
          }
        }
        return originalFetch(input, init)
      }
    }, uploadUrl)
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    if (generating) {
      await page.route(`**/api/v1/ai/tasks/${activeTaskId}**`, (route) =>
        route.fulfill({ json: { data: { id: activeTaskId, status: 'running' } } }),
      )
    }
    await page.route(`**/api/v1/canvases/${canvasId}**`, async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'PATCH') {
        for (const mutation of (request.postDataJSON().mutations || []) as Element[]) {
          if (mutation.op === 'delete') elements.delete(mutation.element_id)
          else elements.set(mutation.element_id, mutation)
        }
        return route.fulfill({ json: { sync_revision: ++revision } })
      }
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [...elements.values()],
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: canvasId, title: '原节点视频裁剪验收', status: 'active', revision },
      })
    })
    await page.route(`**/api/v1/canvases/${canvasId}/node-locks**`, (route) =>
      route.fulfill({ json: { granted: true, nodes: {} } }),
    )
    await page.route(`**/api/v1/assets/${sourceAssetId}/download?**`, (route) => fulfillFixtureVideo(route, source))
    await page.route(`**/api/v1/assets/${trimmedAssetId}/download?**`, (route) => fulfillFixtureVideo(route, upload!))
    await page.route('**/api/v1/assets', async (route) => {
      const request = route.request()
      if (request.method() !== 'POST') return route.fallback()
      const body = request.postDataJSON()
      if (body.source === 'canvas-poster') return route.fulfill({ status: 503, json: { message: '测试忽略封面写入' } })
      expect(body).toMatchObject({ workspace_id: WORKSPACE_ID, type: 'video', mime_type: 'video/mp4' })
      creates++
      return route.fulfill({ json: { asset: { id: trimmedAssetId }, upload: { url: uploadUrl, form_fields: {} } } })
    })
    await page.route(uploadUrl, async (route) => {
      const bytes = await page.evaluate(() => (window as Window & { uploadedTrim?: number[] }).uploadedTrim)
      expect(bytes).toBeDefined()
      upload = Buffer.from(bytes!)
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    })
    await page.route(`**/api/v1/assets/${trimmedAssetId}/complete?**`, (route) =>
      route.fulfill({ json: { id: trimmedAssetId, status: 'active' } }),
    )

    await page.goto(`/canvas/${canvasId}`)
    if (timeline) {
      const node = page.locator('.react-flow__node[data-id="timeline"]')
      await node.locator('.canvas-node-header').click()
      await expect(node.getByRole('button', { name: '合成', exact: true })).toBeEnabled()
      await node.getByRole('button', { name: '精修', exact: true }).click()
      const editor = page.getByRole('dialog', { name: '视频剪辑', exact: true })
      const compose = editor.getByRole('button', { name: '合成为一条视频', exact: true })
      await expect(compose).toBeEnabled()
      await compose.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath('timeline-single-clip-compose.png') })
      await compose.click()
      const getOutputNodeId = () =>
        [...elements.values()].find((element) => {
          const asset = element.payload.data as { assetId?: number } | undefined
          return element.kind === 'node' && asset?.assetId === trimmedAssetId
        })?.element_id
      await expect.poll(getOutputNodeId).toBeDefined()
      expect(creates).toBe(1)
      expect(upload?.length).toBeGreaterThan(1000)
      const output = page.locator(`.react-flow__node[data-id="${getOutputNodeId()}"]`)
      await expect
        .poll(async () => output.locator('video').evaluate((video: HTMLVideoElement) => video.duration))
        .toBeCloseTo(9.005, 2)
      expect(api.paidTaskSubmissions).toBe(0)
      expectNoUnexpectedApi(api)
      return
    }
    const original = page.locator('.react-flow__node[data-id="video-source"]')
    await original.locator('.canvas-node-header').click()
    const trim = page.getByRole('toolbar', { name: '节点操作', exact: true }).getByRole('button', { name: '裁剪时长' })
    await trim.click()
    const dialog = page.getByRole('dialog', { name: '裁剪时长', exact: true })
    if (generating) {
      await expect(page.getByText('原视频正在生成，请等任务结束后再裁剪时长')).toBeVisible()
      await expect(dialog).toHaveCount(0)
      expect(creates).toBe(0)
      expect(api.paidTaskSubmissions).toBe(0)
      expectNoUnexpectedApi(api)
      return
    }
    await expect(dialog).toBeVisible()
    const head = dialog.getByRole('spinbutton', { name: '从头部裁剪' })
    const tail = dialog.getByRole('spinbutton', { name: '从尾部裁剪' })
    await head.focus()
    await head.press('Escape')
    await expect(dialog).toBeHidden()
    expect(creates).toBe(0)

    await trim.click()
    await expect(head).toBeEnabled()
    if (browserName === 'chromium') await expect(dialog.locator('img[alt=""]')).toHaveCount(6)
    if (mode === 'lossless' && browserName === 'chromium') {
      const track = dialog.getByRole('slider', { name: '裁剪起点' }).locator('xpath=..')
      const drag = async (boundary: 'head' | 'tail', targetFraction: number) => {
        // The modal animates open, and the hint below the timeline can move it after the first drag.
        await track.hover()
        const bounds = await track.boundingBox()
        if (!bounds) throw new Error('找不到裁剪滑块')
        const y = bounds.y + bounds.height / 2
        const x = boundary === 'head' ? bounds.x + 10 : bounds.x + bounds.width - 10
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(bounds.x + bounds.width * targetFraction, y, { steps: 8 })
        await page.mouse.up()
      }
      await drag('head', 0.25)
      await expect.poll(async () => Number(await head.inputValue())).toBeGreaterThan(1)
      await drag('tail', 0.75)
      await expect.poll(async () => Number(await tail.inputValue())).toBeGreaterThan(1)
    }
    await head.fill('1e0')
    await expect(head).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByRole('button', { name: '保存裁剪', exact: true })).toBeDisabled()
    await expect(dialog.getByText('请输入有效秒数，裁剪后至少保留 0.1 秒。', { exact: true })).toBeVisible()

    await head.fill('1.03')
    await dialog.getByRole('button', { name: '从头部裁剪增加 0.1 秒' }).click()
    await expect(head).toHaveValue('1.13')
    await head.press('ArrowDown')
    await expect(head).toHaveValue('1.03')
    await tail.fill('2.02')
    await dialog.getByRole('button', { name: '从尾部裁剪减少 0.1 秒' }).click()
    await expect(tail).toHaveValue('1.92')
    await head.fill(precise ? '1.3' : '1')
    await tail.fill(precise ? '2.2' : '2')
    const expectedDuration = precise ? 8.5 : 9
    await expect(dialog.getByText(`结果 ${expectedDuration} 秒`, { exact: false })).toBeVisible()
    if (precise) await expect(dialog.getByText('精确裁剪需要重新编码视频画面。')).toBeVisible()
    const save = dialog.getByRole('button', { name: '保存裁剪', exact: true })
    await expect(save).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: testInfo.outputPath('video-trim-dialog.png') })
    await save.click()
    await expect(dialog).toBeHidden({ timeout: 35_000 })
    await expect
      .poll(() => elements.get('video-source')?.payload)
      .toMatchObject({
        position,
        data: { ...data, assetId: trimmedAssetId },
      })
    expect(elements.size).toBe(3)
    expect(elements.get('original-edge')?.payload).toMatchObject(edge)
    expect(creates).toBe(1)
    expect(upload?.length).toBeGreaterThan(1000)
    await expect
      .poll(async () => original.locator('video').evaluate((video: HTMLVideoElement) => video.duration))
      .toBeCloseTo(expectedDuration, 1)
    if (browserName === 'chromium') {
      const audioLevel = await page.evaluate(
        async ({ assetId, workspaceId }) => {
          const context = new AudioContext()
          try {
            const response = await fetch(`/api/v1/assets/${assetId}/download?workspace_id=${workspaceId}`)
            const audio = await context.decodeAudioData(await response.arrayBuffer())
            const samples = audio.getChannelData(0).subarray(0, audio.sampleRate)
            return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
          } finally {
            await context.close()
          }
        },
        { assetId: trimmedAssetId, workspaceId: WORKSPACE_ID },
      )
      expect(audioLevel).toBeGreaterThan(0.01)
    }
    await page.screenshot({ path: testInfo.outputPath('video-trim-original-node.png') })
    await page.locator('.canvas-view').focus()
    await page.keyboard.press('Control+z')
    await expect.poll(() => elements.get('video-source')?.payload).toMatchObject({ position, data })
    expect(elements.get('original-edge')?.payload).toMatchObject(edge)
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
