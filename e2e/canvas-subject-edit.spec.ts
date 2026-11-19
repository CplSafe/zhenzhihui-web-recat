import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const canvasId = 172
const videoAssetId = 601
const imageAssetId = 701
const maskAssetId = 702
const videoReferenceAssetId = 703
const duration = 12
const videoReplacementAsset = {
  id: imageAssetId,
  workspace_id: WORKSPACE_ID,
  name: '蓝色皮卡.png',
  type: 'image',
  mime_type: 'image/png',
  source: 'upload',
  status: 'active',
}

async function dragSelection(page: Page, canvas: Locator, from: [number, number], to: [number, number]) {
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 6 })
  await page.mouse.up()
}

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
  const selectionAsset = {
    id: kind === 'video' ? videoReferenceAssetId : maskAssetId,
    workspace_id: WORKSPACE_ID,
    type: 'image',
    status: 'active',
  }
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
          input_constraints: {
            'video.edit': {
              roles: [
                { role: 'video', min_count: 1, max_count: 1 },
                { role: 'image', max_count: 1 },
              ],
            },
          },
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
  await page.setViewportSize(kind === 'video' ? { width: 1440, height: 1000 } : { width: 760, height: 900 })
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) => {
    const requestedOperation = new URL(route.request().url()).searchParams.get('operation_code')
    return route.fulfill({
      json: { items: requestedOperation && requestedOperation !== operation ? [] : [model] },
    })
  })
  await page.route(/\/api\/v1\/assets(?:\?|$)/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const type = new URL(route.request().url()).searchParams.get('type')
    const assets = [asset, selectionAsset, resultAsset]
    if (kind === 'video') assets.push(videoReplacementAsset)
    const items = type ? assets.filter((item) => item.type === type) : assets
    return route.fulfill({ json: { items, total: items.length } })
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
  await page.route(`**/api/v1/canvases/${canvasId}/events?**`, (route) => route.fulfill({ status: 204 }))

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
    for (const name of ['主体消除', '主体修改', '主体替换']) {
      await expect(dialog.getByRole('button', { name, exact: true })).toBeEnabled()
    }
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

test('视频主体编辑保留 12 秒原片，并分别生成新节点', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const app = await setupSubjectEdit(page, 'video')
  const replacement = videoReplacementAsset
  await page.route('**/api/v1/real-people?**', (route) => {
    expect(route.request().method()).toBe('GET')
    expect(new URL(route.request().url()).searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    return route.fulfill({ json: [] })
  })
  // 使用严格夹具的可播放 MP4，仅模拟源片的 12 秒元数据，检查整段片长进入估价与提交。
  await page.addInitScript((seconds) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')!
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      ...descriptor,
      get(this: HTMLMediaElement) {
        return this.getAttribute('aria-label') === '原视频' ? seconds : descriptor.get?.call(this)
      },
    })
  }, duration)
  let referenceUploads = 0
  await page.route('**/api/v1/assets', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = route.request().postDataJSON()
    if (body.source === 'canvas-poster')
      return route.fulfill({ status: 503, json: { message: '测试环境不保存自动封面' } })
    expect(body).toMatchObject({ workspace_id: WORKSPACE_ID, source: 'upload', mime_type: 'image/png' })
    return route.fulfill({
      json: {
        asset: { id: videoReferenceAssetId },
        upload: { url: new URL('/api/v1/mock-subject-video-reference', route.request().url()).href },
      },
    })
  })
  await page.route('**/api/v1/mock-subject-video-reference', (route) => {
    referenceUploads += 1
    return route.fulfill({ status: 204 })
  })
  await page.route(`**/api/v1/assets/${videoReferenceAssetId}/complete?**`, (route) =>
    route.fulfill({ json: { id: videoReferenceAssetId, status: 'active' } }),
  )
  await page.goto(`/canvas/${canvasId}`)
  const target = '沿林间道路行驶的黑色车辆'
  for (const edit of [
    { mode: '主体消除' },
    { mode: '主体修改', field: '修改说明', description: '将车身改成白色' },
    { mode: '主体替换' },
  ] as const) {
    await app.open()
    await app.dialog.getByRole('button', { name: edit.mode, exact: true }).click()
    const quote = app.dialog.getByRole('button', { name: /^估\s*价$/ })
    const submit = app.dialog.getByRole('button', { name: '开始处理', exact: true })
    await expect(quote).toBeDisabled()
    await expect(submit).toBeDisabled()
    await app.dialog.getByRole('textbox', { name: '要处理的主体' }).fill(target)
    const marked = edit.mode === '主体消除'
    if (marked) {
      const original = app.dialog.getByLabel('原视频', { exact: true })
      const timeline = app.dialog.getByRole('slider', { name: '视频帧时间轴', exact: true })
      const mark = app.dialog.getByRole('button', { name: '标记当前帧', exact: true })
      const clearMark = app.dialog.getByRole('button', { name: '清除标记', exact: true })
      const returnToMark = app.dialog.getByRole('button', { name: '返回标记帧', exact: true })
      const frame = app.dialog.locator('canvas[aria-label="视频帧涂抹区域"]')
      await expect
        .poll(() => original.evaluate((element) => (element as HTMLVideoElement).readyState))
        .toBeGreaterThanOrEqual(2)
      await expect(timeline).toBeEnabled()
      await expect(timeline).toHaveAttribute('max', String(duration))
      await expect(returnToMark).toHaveCount(0)
      await mark.click()
      await expect(frame).toBeVisible()
      await expect(original).toBeHidden()
      await expect(quote).toBeDisabled()
      await expect(app.dialog.getByRole('button', { name: '智能点选', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await clearMark.click()
      await expect(returnToMark).toHaveCount(0)
      await expect(frame).toBeHidden()
      await expect(original).toBeVisible()
      await expect(quote).toBeEnabled()
      await mark.click()
      await expect(frame).toBeVisible()
      await app.dialog.getByRole('button', { name: '框选', exact: true }).click()
      await dragSelection(page, frame, [0.28, 0.28], [0.72, 0.72])
      await expect(quote).toBeEnabled()
      await app.dialog.getByRole('button', { name: '返回视频', exact: true }).click()
      await expect(frame).toBeHidden()
      await expect(original).toBeVisible()
      await expect(quote).toBeEnabled()
      await expect(returnToMark).toBeEnabled()
      await page.screenshot({ path: testInfo.outputPath('video-timeline-mark.png') })
      await returnToMark.click()
      await expect(frame).toBeVisible()
      await expect(original).toBeHidden()
      await expect(app.dialog.getByRole('button', { name: '预览抠图', exact: true })).toBeEnabled()
      await expect(quote).toBeEnabled()
      await page.screenshot({ path: testInfo.outputPath('video-frame-selection.png') })
    } else if (edit.mode === '主体修改') {
      await expect(quote).toBeDisabled()
      await app.dialog.getByRole('textbox', { name: edit.field }).fill(edit.description)
    } else {
      await expect(quote).toBeDisabled()
      const description = app.dialog.getByRole('textbox', { name: '替换说明' })
      await expect(description).toHaveValue('')
      await app.dialog.getByRole('button', { name: '选择替换图片', exact: true }).click()
      const picker = page.getByRole('dialog', { name: '选择图片', exact: true })
      await expect(picker).toBeVisible()
      await picker.getByRole('textbox', { name: '搜索素材名称' }).fill(replacement.name)
      await expect(picker.locator(`img[src*="/assets/${replacement.id}/download"]`)).toBeVisible()
      const apply = picker.getByRole('button', { name: '应用', exact: true })
      await apply.focus()
      await apply.press('Enter')
      await expect(picker).toBeHidden()
      await expect(app.dialog.getByRole('img', { name: '替换参考图预览' })).toHaveAttribute(
        'src',
        new RegExp(`/assets/${replacement.id}/download`),
      )
      await expect(app.dialog.getByText(replacement.name, { exact: true })).toBeVisible()
      await expect(description).toHaveValue('')
      await expect(quote).toBeEnabled()
      await page.screenshot({ path: testInfo.outputPath('video-replacement-image.png') })
    }
    const submittedBeforeQuote = app.submissions.length
    await quote.click()
    await expect(submit).toBeEnabled()
    expect(app.submissions).toHaveLength(submittedBeforeQuote)
    if (marked) {
      expect(referenceUploads).toBe(1)
      await page.screenshot({ path: testInfo.outputPath('video-removal-quoted.png') })
    }
    await submit.click()
    await expect(app.dialog).toBeHidden()
    await expect.poll(() => app.submissions.length).toBe(submittedBeforeQuote + 1)
    const request = app.submissions.at(-1)!
    const inputAssets = [{ asset_id: videoAssetId, role: 'video' }]
    if (marked) inputAssets.push({ asset_id: videoReferenceAssetId, role: 'image' })
    if (edit.mode === '主体替换') inputAssets.push({ asset_id: replacement.id, role: 'image' })
    expect(request).toMatchObject({
      workspace_id: WORKSPACE_ID,
      model_version_id: app.modelId,
      operation_code: app.operation,
      params: { duration, source_video_duration: duration },
      input_assets: inputAssets,
    })
    expect(request.idempotency_key).toBeTruthy()
    expect(request.prompt).toEqual(expect.stringContaining(target))
    expect(request.params).not.toHaveProperty('mask_asset_id')
    if (marked) {
      expect(request.prompt).toEqual(expect.stringContaining('选区参考'))
      expect(request.prompt).toMatch(/原视频第\s*0(?:\.0+)?\s*秒/)
      const bounds = String(request.prompt).match(
        /从画面左边起 ([\d.]+)%、从上边起 ([\d.]+)%[，,]宽 ([\d.]+)%、高 ([\d.]+)%/,
      )
      expect(bounds).not.toBeNull()
      for (const [index, expected] of [28, 28, 44, 44].entries()) {
        expect(Math.abs(Number(bounds?.[index + 1]) - expected)).toBeLessThanOrEqual(8)
      }
      expect(request.prompt).toEqual(expect.stringContaining('参考图片仅用于辨认选中的主体'))
    } else if (edit.mode === '主体修改') {
      expect(request.prompt).toEqual(expect.stringContaining(edit.description))
      expect(request.prompt).not.toEqual(expect.stringContaining('选区参考'))
    } else {
      expect(request.prompt).toEqual(expect.stringContaining('第1张参考图是要换入的新主体'))
      expect(request.prompt).not.toEqual(expect.stringContaining('选区参考'))
    }
    app.expectMatchingEstimate(request)
    await expect(app.result(edit.mode).locator('video')).toHaveAttribute('src', /\/assets\/602\/download/)
  }
  await expect(app.sourceNode.locator('video')).toHaveAttribute('src', /\/assets\/601\/download/)
  expect(referenceUploads).toBe(1)
  await expect.poll(() => JSON.stringify(app.saved)).toContain('"assetId":602')
  expect(app.pageErrors).toEqual([])
  expectNoUnexpectedApi(app.api)
  await page.screenshot({ path: testInfo.outputPath('video-edit-results.png') })
})

test('图片涂抹消除提交同尺寸蒙版并保留原图', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const app = await setupSubjectEdit(page, 'image')
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
  await app.open()
  const modify = app.dialog.getByRole('textbox', { name: '修改说明' })
  const replace = app.dialog.getByRole('textbox', { name: '替换说明' })
  await app.dialog.getByRole('button', { name: '主体修改', exact: true }).click()
  await expect(modify).toBeEditable()
  await modify.fill('把选中的红色物体改成蓝色')
  await app.dialog.getByRole('button', { name: '主体替换', exact: true }).click()
  await expect(replace).toBeEditable()
  await expect(replace).toHaveValue('')
  await app.dialog.getByRole('button', { name: '主体消除', exact: true }).click()
  await expect(modify).toHaveCount(0)
  await expect(replace).toHaveCount(0)
  const quote = app.dialog.getByRole('button', { name: /^估\s*价$/ })
  const submit = app.dialog.getByRole('button', { name: '开始处理', exact: true })
  await expect(quote).toBeDisabled()
  await expect(submit).toBeDisabled()
  const brush = app.dialog.locator('canvas[aria-label="图片涂抹区域"]')
  await expect(brush).toBeVisible()
  const preview = app.dialog.getByRole('button', { name: '预览抠图', exact: true })
  const returnToSelection = app.dialog.getByRole('button', { name: '返回选区', exact: true })
  const cutout = app.dialog.locator('canvas[aria-label="抠图预览"]')
  await expect(preview).toBeDisabled()
  await app.dialog.getByRole('button', { name: '按颜色点选', exact: true }).click()
  const brushBox = (await brush.boundingBox())!
  await brush.click({ position: { x: brushBox.width * 0.375, y: brushBox.height * 0.5 } })
  await preview.click()
  await expect(cutout).toBeVisible()
  await expect
    .poll(() =>
      cutout.evaluate((element) => {
        const context = (element as HTMLCanvasElement).getContext('2d')!
        return [context.getImageData(60, 50, 1, 1).data[3], context.getImageData(120, 50, 1, 1).data[3]]
      }),
    )
    .toEqual([255, 0])
  await page.screenshot({ path: testInfo.outputPath('image-color-pick-cutout.png') })
  await returnToSelection.click()
  await expect(cutout).toBeHidden()
  const clear = app.dialog.getByRole('button', { name: '清空', exact: true })
  await clear.click()
  await expect(preview).toBeDisabled()
  await app.dialog.getByRole('button', { name: '框选', exact: true }).click()
  await dragSelection(page, brush, [0.28, 0.31], [0.45, 0.69])
  await expect(preview).toBeEnabled()
  await clear.click()
  await expect(preview).toBeDisabled()
  await app.dialog.getByRole('button', { name: '画笔', exact: true }).click()
  const paint = () => dragSelection(page, brush, [0.32, 0.5], [0.42, 0.5])
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
})

test('智能点选在浏览器抠出局部主体，只在主动识别时请求候选', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const app = await setupSubjectEdit(page, 'image')
  const point = { x: 0.5, y: 0.35 }
  // 使用仓库篮球视频 1.28 秒的固定帧，让各浏览器对同一张图片运行真实分割模型。
  const framePath = fileURLToPath(new URL('./fixtures/canvas-subject-basketball.jpg', import.meta.url))
  await page.route(`**/api/v1/assets/${imageAssetId}/download?**`, (route) =>
    route.fulfill({ contentType: 'image/jpeg', path: framePath }),
  )

  const recognitionOperation = 'responses.multimodal'
  const recognitionModelId = 44
  const recognitions: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/ai/models**', (route) =>
    new URL(route.request().url()).searchParams.get('operation_code') === recognitionOperation
      ? route.fulfill({
          json: {
            code: 0,
            data: [
              {
                id: recognitionModelId,
                provider: 'mock',
                version: 'vision-model',
                capability: 'text',
                display_name: '测试视觉理解模型',
                enabled: true,
                operation_codes: [recognitionOperation],
              },
            ],
          },
        })
      : route.fallback(),
  )
  await page.route('**/api/v1/ai/responses', (route) => {
    expect(route.request().method()).toBe('POST')
    recognitions.push(route.request().postDataJSON())
    return route.fulfill({
      json: {
        text: JSON.stringify({
          candidates: [
            { label: '篮球', bounds: { x: 0.08, y: 0.14, width: 0.84, height: 0.48 } },
            { label: '完整球体', bounds: { x: 0.03, y: 0.1, width: 0.94, height: 0.57 } },
          ],
        }),
      },
    })
  })

  await page.goto(`/canvas/${canvasId}`)
  await app.open()
  const canvas = app.dialog.locator('canvas[aria-label="图片涂抹区域"]')
  const cutout = app.dialog.locator('canvas[aria-label="抠图预览"]')
  const preview = app.dialog.getByRole('button', { name: '预览抠图', exact: true })
  await expect(canvas).toBeVisible()
  await app.dialog.getByRole('button', { name: '智能点选', exact: true }).click()
  await expect(preview).toBeDisabled()
  const box = (await canvas.boundingBox())!
  await canvas.click({ position: { x: box.width * point.x, y: box.height * point.y } })
  await expect(preview).toBeEnabled({ timeout: 25_000 })
  await preview.click()
  await expect(cutout).toBeVisible()
  const mask = await cutout.evaluate((element, click) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('2d')!
    const { width, height } = canvas
    const { data } = context.getImageData(0, 0, width, height)
    let selected = 0
    for (let offset = 3; offset < data.length; offset += 4) {
      if (data[offset] >= 128) selected += 1
    }
    return {
      center: context.getImageData(Math.floor(width * click.x), Math.floor(height * click.y), 1, 1).data[3],
      corner: data[3],
      coverage: selected / (width * height),
    }
  }, point)
  expect(mask.center).toBe(255)
  expect(mask.corner).toBe(0)
  expect(mask.coverage).toBeGreaterThan(0.12)
  expect(mask.coverage).toBeLessThan(0.45)
  expect(recognitions).toHaveLength(0)
  expect(app.submissions).toHaveLength(0)
  await page.screenshot({ path: testInfo.outputPath('image-smart-pick-cutout.png') })

  await app.dialog.getByRole('button', { name: '返回选区', exact: true }).click()
  const candidates = app.dialog.getByRole('group', { name: '主体候选' })
  await candidates.getByRole('button', { name: /识别主体候选/ }).click()
  await expect(candidates.getByRole('button', { name: '完整球体', exact: true })).toBeVisible()
  expect(recognitions).toHaveLength(1)
  expect(recognitions[0]).toMatchObject({
    workspace_id: WORKSPACE_ID,
    canvas_id: canvasId,
    operation_code: recognitionOperation,
    model_version_id: recognitionModelId,
    input_assets: [{ asset_id: imageAssetId, role: 'image' }],
    prompt: expect.stringContaining('图片点击位置'),
  })
  await page.screenshot({ path: testInfo.outputPath('image-smart-pick-candidates.png') })
  await candidates.getByRole('button', { name: '篮球', exact: true }).click()
  await expect(preview).toBeEnabled({ timeout: 25_000 })
  await app.dialog.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(preview).toBeEnabled()
  expect(recognitions).toHaveLength(1)
  expect(app.submissions).toHaveLength(0)
  expect(app.pageErrors).toEqual([])
  expectNoUnexpectedApi(app.api)
})
