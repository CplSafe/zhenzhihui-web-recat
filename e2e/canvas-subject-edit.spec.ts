import { expect, test, type Page } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const canvasId = 172
const videoAssetId = 601
const imageAssetId = 701
const maskAssetId = 702
const duration = 12
const subjectEditEnabled = process.env.VITE_CANVAS_SUBJECT_EDIT_ENABLED === 'true'

async function setupSubjectEdit(page: Page, kind: 'video' | 'image') {
  const api = await installStrictAuthenticatedApp(page)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const sourceAssetId = kind === 'video' ? videoAssetId : imageAssetId
  const outputAssetId = kind === 'video' ? 602 : 502
  const operation = kind === 'video' ? 'video.edit' : 'image.image_to_image'
  const modelId = kind === 'video' ? 42 : 43
  const sourceUrl = `/api/v1/assets/${sourceAssetId}/download?workspace_id=${WORKSPACE_ID}`
  const asset = {
    id: sourceAssetId,
    workspace_id: WORKSPACE_ID,
    type: kind,
    status: 'active',
    ...(kind === 'video' ? { duration, duration_sec: duration, width: 1920, height: 1080 } : {}),
  }
  const mask = { id: maskAssetId, workspace_id: WORKSPACE_ID, type: 'image', status: 'active' }
  const resultAsset = { ...asset, id: outputAssetId }
  const model = {
    id: modelId,
    provider: kind === 'image' ? 'openai' : 'mock',
    version: kind === 'image' ? 'gpt-image-2' : 'video-edit-12s',
    capability: kind,
    display_name: kind === 'image' ? 'GPT Image' : '测试视频编辑模型',
    enabled: true,
    operation_codes: [operation],
    ...(kind === 'video'
      ? {
          params_schema: {
            fields: [
              { name: 'duration', type: 'number', min: 1, max: 15, required: true },
              { name: 'source_video_duration', type: 'number', min: 1, max: 15 },
            ],
          },
        }
      : {
          input_constraints: {
            'image.image_to_image': {
              roles: [
                { role: 'image', min_count: 1, max_count: 1 },
                { role: 'mask', max_count: 1 },
              ],
            },
          },
        }),
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) => {
    const requestedOperation = new URL(route.request().url()).searchParams.get('operation_code')
    return route.fulfill({
      json: { items: requestedOperation && requestedOperation !== operation ? [] : [model] },
    })
  })
  await page.route(/\/api\/v1\/assets(?:\?|$)/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill({ json: { items: [asset, mask, resultAsset], total: 3 } })
  })
  await page.route(`**/api/v1/assets/${sourceAssetId}?**`, (route) => route.fulfill({ json: asset }))

  const source = {
    element_id: 'subject-source',
    kind: 'node',
    payload: {
      id: 'subject-source',
      type: kind,
      position: { x: 260, y: 120 },
      style: { width: 320, height: 220 },
      data: {
        kind,
        title: kind === 'video' ? '12 秒车辆原片' : '双主体原图',
        assetId: sourceAssetId,
        assetWorkspaceId: WORKSPACE_ID,
        resultUrl: sourceUrl,
        ...(kind === 'video' ? { durationSec: duration, videoDuration: duration } : {}),
      },
    },
  }
  let revision = 1
  const saved: unknown[] = []
  await page.route(`**/api/v1/canvases/${canvasId}**`, (route) => {
    if (route.request().method() === 'PATCH') {
      saved.push(route.request().postDataJSON())
      revision += 1
      return route.fulfill({ json: { revision, sync_revision: revision } })
    }
    const url = new URL(route.request().url())
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [source],
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: canvasId, title: '主体编辑回归', revision },
    })
  })
  await page.route(`**/api/v1/canvases/${canvasId}/node-locks?**`, (route) => {
    expect(route.request().method()).toBe('POST')
    const { nodes } = route.request().postDataJSON() as { nodes: string[] }
    return route.fulfill({
      json: {
        granted: true,
        nodes: Object.fromEntries(nodes.map((id) => [id, [{ user_id: 7, name: 'E2E 用户', editing: true }]])),
      },
    })
  })

  const estimates: Array<Record<string, unknown>> = []
  const submissions: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/ai/tasks/estimate-cost', (route) => {
    estimates.push(route.request().postDataJSON())
    return route.fulfill({ json: { estimated_cost: 10, balance: 9000, can_afford: true } })
  })
  await page.route(/\/api\/v1\/ai\/tasks(?:\?|$)/, (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    submissions.push(route.request().postDataJSON())
    return route.fulfill({
      status: 201,
      json: { id: 900 + submissions.length, status: 'queued', poll_after_ms: 100 },
    })
  })
  await page.route(/\/api\/v1\/ai\/tasks\/90[1-9](?:\?|$)/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1))
    return route.fulfill({ json: { id, status: 'succeeded', outputs: [{ asset_id: outputAssetId, type: kind }] } })
  })

  const sourceNode = page.locator('.react-flow__node[data-id="subject-source"]')
  const dialog = page.getByRole('dialog', { name: '主体编辑' })
  const open = async () => {
    await sourceNode.locator('.canvas-node-header').click()
    await page.getByRole('button', { name: '主体编辑', exact: true }).click()
    await expect(dialog).toBeVisible()
  }
  const result = (title: string) =>
    page.locator('.react-flow__node').filter({ has: page.getByRole('button', { name: `${title}结果`, exact: true }) })
  const expectMatchingEstimate = (request: Record<string, unknown>) => {
    expect(estimates.at(-1)).toMatchObject({
      model_version_id: request.model_version_id,
      operation_code: request.operation_code,
      prompt: request.prompt,
      params: request.params,
      input_assets: request.input_assets,
    })
  }
  return {
    api,
    dialog,
    expectMatchingEstimate,
    modelId,
    open,
    operation,
    pageErrors,
    result,
    saved,
    sourceNode,
    submissions,
  }
}

test(
  subjectEditEnabled ? '视频主体编辑保留 12 秒原片，并分别生成新节点' : '视频节点默认隐藏主体编辑',
  async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    const app = await setupSubjectEdit(page, 'video')
    // 使用严格夹具的可播放 MP4，仅模拟源片的 12 秒元数据，检查整段片长进入估价与提交。
    await page.addInitScript((seconds) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')!
      Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
        ...descriptor,
        get(this: HTMLMediaElement) {
          return /\/assets\/601\/download/.test(this.currentSrc || this.src) ? seconds : descriptor.get?.call(this)
        },
      })
    }, duration)
    await page.route('**/api/v1/assets', (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      expect(route.request().postDataJSON()).toMatchObject({ workspace_id: WORKSPACE_ID, source: 'canvas-poster' })
      return route.fulfill({ status: 503, json: { message: '测试环境不保存自动封面' } })
    })
    await page.goto(`/canvas/${canvasId}`)
    if (!subjectEditEnabled) {
      await app.sourceNode.locator('.canvas-node-header').click()
      const toolbar = page.getByRole('toolbar', { name: '节点操作' })
      await expect(toolbar).toBeVisible()
      await expect(toolbar.getByRole('button', { name: '主体编辑', exact: true })).toHaveCount(0)
      await expect(app.dialog).toHaveCount(0)
      expect(app.submissions).toHaveLength(0)
      return
    }
    const target = '沿林间道路行驶的黑色车辆'
    for (const edit of [
      { mode: '主体消除' },
      { mode: '主体修改', field: '修改说明', description: '将车身改成白色' },
      { mode: '主体替换', field: '替换说明', description: '替换成蓝色皮卡并沿原轨迹行驶' },
    ] as const) {
      await app.open()
      await app.dialog.getByRole('button', { name: edit.mode, exact: true }).click()
      const quote = app.dialog.getByRole('button', { name: /^估\s*价$/ })
      const submit = app.dialog.getByRole('button', { name: '开始处理', exact: true })
      await expect(quote).toBeDisabled()
      await expect(submit).toBeDisabled()
      await app.dialog.getByRole('textbox', { name: '要处理的主体' }).fill(target)
      if (edit.mode !== '主体消除') {
        await expect(quote).toBeDisabled()
        await app.dialog.getByRole('textbox', { name: edit.field }).fill(edit.description)
      }
      const submittedBeforeQuote = app.submissions.length
      await quote.click()
      await expect(submit).toBeEnabled()
      expect(app.submissions).toHaveLength(submittedBeforeQuote)
      if (edit.mode === '主体消除') await page.screenshot({ path: testInfo.outputPath('video-removal-quoted.png') })
      await submit.click()
      await expect(app.dialog).toBeHidden()
      await expect.poll(() => app.submissions.length).toBe(submittedBeforeQuote + 1)
      const request = app.submissions.at(-1)!
      expect(request).toMatchObject({
        workspace_id: WORKSPACE_ID,
        model_version_id: app.modelId,
        operation_code: app.operation,
        params: { duration, source_video_duration: duration },
        input_assets: [{ asset_id: videoAssetId, role: 'video' }],
      })
      expect(request.idempotency_key).toBeTruthy()
      expect(request.prompt).toEqual(expect.stringContaining(target))
      if (edit.mode !== '主体消除') expect(request.prompt).toEqual(expect.stringContaining(edit.description))
      app.expectMatchingEstimate(request)
      await expect(app.result(edit.mode).locator('video')).toHaveAttribute('src', /\/assets\/602\/download/)
    }
    await expect(app.sourceNode.locator('video')).toHaveAttribute('src', /\/assets\/601\/download/)
    await expect.poll(() => JSON.stringify(app.saved)).toContain('"assetId":602')
    expect(app.pageErrors).toEqual([])
    expectNoUnexpectedApi(app.api)
    await page.screenshot({ path: testInfo.outputPath('video-edit-results.png') })
  },
)

test(
  subjectEditEnabled ? '图片涂抹消除提交同尺寸蒙版并保留原图' : '图片节点默认隐藏主体编辑',
  async ({ page }, testInfo) => {
    const app = await setupSubjectEdit(page, 'image')
    await page.setViewportSize({ width: 760, height: 900 })
    const png = await page.evaluate(() => {
      const source = document.createElement('canvas')
      source.width = 160
      source.height = 100
      const context = source.getContext('2d')!
      context.fillStyle = '#b7d4e0'
      context.fillRect(0, 0, 160, 100)
      context.fillStyle = '#c44832'
      context.fillRect(45, 32, 26, 36)
      context.fillStyle = '#28664d'
      context.fillRect(105, 32, 26, 36)
      return source.toDataURL().split(',')[1]
    })
    await page.route(/\/api\/v1\/assets\/(701|502)\/download/, (route) =>
      route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }),
    )
    let uploads = 0
    await page.route('**/api/v1/assets', (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      expect(route.request().postDataJSON()).toMatchObject({ workspace_id: WORKSPACE_ID, mime_type: 'image/png' })
      return route.fulfill({
        json: {
          asset: { id: maskAssetId },
          upload: { url: new URL('/api/v1/mock-subject-mask', route.request().url()).href },
        },
      })
    })
    await page.addInitScript(() => {
      const upload = window.fetch
      window.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input)
        if (url.endsWith('/api/v1/mock-subject-mask') && init?.body instanceof FormData) {
          const content = init.body.get('file')
          if (content instanceof Blob) {
            const bitmap = await createImageBitmap(content)
            const canvas = document.createElement('canvas')
            canvas.width = bitmap.width
            canvas.height = bitmap.height
            const context = canvas.getContext('2d')!
            context.drawImage(bitmap, 0, 0)
            Object.assign(window, {
              subjectMask: {
                width: bitmap.width,
                height: bitmap.height,
                paintedAlpha: context.getImageData(60, 50, 1, 1).data[3],
                otherSubjectAlpha: context.getImageData(120, 50, 1, 1).data[3],
              },
            })
            bitmap.close()
          }
        }
        return upload(input, init)
      }
    })
    await page.route('**/api/v1/mock-subject-mask', (route) => {
      uploads += 1
      return route.fulfill({ status: 204 })
    })
    await page.route(`**/api/v1/assets/${maskAssetId}/complete?**`, (route) =>
      route.fulfill({ json: { id: maskAssetId, status: 'active' } }),
    )
    await page.goto(`/canvas/${canvasId}`)
    if (!subjectEditEnabled) {
      await app.sourceNode.locator('.canvas-node-header').click()
      const toolbar = page.getByRole('toolbar', { name: '节点操作' })
      await expect(toolbar).toBeVisible()
      await expect(toolbar.getByRole('button', { name: '主体编辑', exact: true })).toHaveCount(0)
      await expect(app.dialog).toHaveCount(0)
      expect(app.submissions).toHaveLength(0)
      return
    }
    await app.open()
    const quote = app.dialog.getByRole('button', { name: /^估\s*价$/ })
    const submit = app.dialog.getByRole('button', { name: '开始处理', exact: true })
    await expect(quote).toBeDisabled()
    await expect(submit).toBeDisabled()
    const brush = app.dialog.locator('canvas[aria-label="图片涂抹区域"]')
    await expect(brush).toBeVisible()
    const paint = async () => {
      const box = (await brush.boundingBox())!
      await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.5)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.5, { steps: 6 })
      await page.mouse.up()
    }
    await paint()
    await expect(quote).toBeEnabled()
    await app.dialog.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(quote).toBeDisabled()
    await paint()
    await quote.click()
    await expect(submit).toBeEnabled()
    expect(uploads).toBe(1)
    expect(app.submissions).toHaveLength(0)
    expect(await page.evaluate(() => Reflect.get(window, 'subjectMask'))).toEqual({
      width: 160,
      height: 100,
      paintedAlpha: 0,
      otherSubjectAlpha: 255,
    })
    await page.screenshot({ path: testInfo.outputPath('image-removal-mask.png') })
    await submit.click()
    await expect(app.dialog).toBeHidden()
    await expect.poll(() => app.submissions.length).toBe(1)
    const request = app.submissions[0]
    expect(request).toMatchObject({
      workspace_id: WORKSPACE_ID,
      operation_code: app.operation,
      model_version_id: app.modelId,
      params: { mask_asset_id: maskAssetId },
      input_assets: [
        { asset_id: imageAssetId, role: 'image' },
        { asset_id: maskAssetId, role: 'mask' },
      ],
    })
    app.expectMatchingEstimate(request)
    await expect(app.result('主体消除').locator('img').first()).toHaveAttribute('src', /\/assets\/502\/download/)
    await expect(app.sourceNode.locator('img').first()).toHaveAttribute('src', /\/assets\/701\/download/)
    await expect.poll(() => JSON.stringify(app.saved)).toContain('"assetId":502')
    expect(app.pageErrors).toEqual([])
    expectNoUnexpectedApi(app.api)
    await page.screenshot({ path: testInfo.outputPath('image-removal-result.png') })
  },
)
