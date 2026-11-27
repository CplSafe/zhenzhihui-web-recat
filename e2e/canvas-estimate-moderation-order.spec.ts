import { expect, test, type Page } from '@playwright/test'
import {
  expectPaddedPixels,
  makePaddingSourcePng,
  mockIntrinsicVideoSize,
  mockPaddedImageUpload,
  NON_PLAYABLE_VIDEO,
  PADDED_ASSET_ID,
} from './fixtures/canvas-seedance-preflight'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const REFERENCE_TITLE = '故事场景长图'
const VIDEO_TITLE = '故事场景视频'
const CROP_ASSET_ID = 503
const CROP_UPLOAD_URL = 'https://canvas-test.oss-cn-beijing.aliyuncs.com/seedance-reference-crop'

type CanvasMutation = { element_id: string; payload?: { data?: Record<string, unknown> } }

async function installVideoModerationCanvas(
  page: Page,
  width: number,
  height: number,
  derivedAssetId?: number,
  sourceType: 'image' | 'video' = 'image',
) {
  const savedNodes: CanvasMutation[] = []
  let revision = 1
  await page.routeWebSocket('**/api/v1/canvases/125/node-locks/socket?**', (socket) => {
    socket.onMessage(() => socket.send(JSON.stringify({ type: 'state', data: { granted: true, nodes: {} } })))
  })
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 42,
            display_name: 'Seedance 2.5',
            capability: 'video',
            operation_codes: ['video.generate'],
            input_constraints: {
              'video.generate': {
                roles: [
                  { role: 'image', max_count: 5 },
                  { role: 'video', max_count: 1 },
                ],
              },
            },
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/125**', (route) => {
    if (route.request().method() === 'PATCH') {
      savedNodes.push(...(route.request().postDataJSON().mutations || []))
      revision++
      return route.fulfill({ json: { revision, sync_revision: revision } })
    }
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'image',
                kind: 'node',
                payload: {
                  id: 'image',
                  type: sourceType,
                  position: { x: 100, y: 100 },
                  data: {
                    kind: sourceType,
                    title: sourceType === 'image' ? REFERENCE_TITLE : '故事场景超宽视频',
                    assetId: 501,
                    assetWorkspaceId: WORKSPACE_ID,
                  },
                },
              },
              {
                element_id: 'video',
                kind: 'node',
                payload: {
                  id: 'video',
                  type: 'video',
                  position: { x: 600, y: 100 },
                  data: {
                    kind: 'video',
                    title: VIDEO_TITLE,
                    modelVersionId: 42,
                    operationCode: 'video.generate',
                    prompt: '一只小猫走过花园',
                  },
                },
              },
              {
                element_id: 'edge',
                kind: 'edge',
                payload: { id: 'edge', source: 'image', target: 'video', data: { slotIndex: 0 } },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 125, title: '审核顺序', revision: 1 },
    })
  })
  const source = sourceType === 'image' ? await makePaddingSourcePng(page, { width, height }) : undefined
  await page.route('**/api/v1/assets/501/download**', (route) => {
    if (sourceType === 'video') return route.fulfill({ contentType: 'image/svg+xml', body: NON_PLAYABLE_VIDEO })
    return route.fulfill({ contentType: 'image/png', body: source })
  })
  const listedAssets = derivedAssetId ? [501, derivedAssetId] : [501]
  await page.route('**/api/v1/assets?**', (route) =>
    route.fulfill({
      json: {
        items: listedAssets.map((id) => ({ id, workspace_id: WORKSPACE_ID, type: sourceType, status: 'active' })),
        total: listedAssets.length,
      },
    }),
  )
  await page.route('**/api/v1/canvases/125/node-locks?**', (route) =>
    route.fulfill({ json: { granted: true, nodes: {} } }),
  )
  return savedNodes
}

test('Seedance 费用确认后才自动审核宽高比下限的素材', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await installVideoModerationCanvas(page, 400, 1000)
  let releaseEstimate!: () => void
  const estimateWait = new Promise<void>((resolve) => {
    releaseEstimate = resolve
  })
  let estimates = 0
  await page.route('**/api/v1/ai/tasks/estimate-cost', async (route) => {
    estimates++
    await estimateWait
    await route.fulfill({ json: { estimated_cost: 10, balance: 9000, can_afford: true } })
  })
  let reviews = 0
  await page.route('**/api/v1/assets/501/seedance-moderation**', (route) => {
    reviews++
    return route.fulfill({ json: { data: { status: 'rejected', reason: '测试拒绝' } } })
  })
  await page.goto('/canvas/125')
  await page.locator('.react-flow__node[data-id="video"]').click()
  const send = page.locator('[data-canvas-node-panel] [data-canvas-generate]')
  await expect.poll(() => estimates).toBeGreaterThan(0)
  await expect(send).toBeDisabled()
  expect(reviews).toBe(0)
  releaseEstimate()
  await expect(page.getByText('预计消耗：10 积分', { exact: true })).toBeVisible()
  await send.click()
  const dialog = page.getByRole('alertdialog', { name: '确认制作费用' })
  await expect(dialog).toBeVisible()
  expect(reviews).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('cost-before-moderation.png') })
  await dialog.getByRole('button', { name: '再想想' }).click()
  expect(reviews).toBe(0)
  await send.click()
  await dialog.getByRole('button', { name: '继续制作' }).click()
  await expect.poll(() => reviews).toBe(1)
  await expect(page.getByText(/审核未通过/)).toBeVisible()
  expect(api.paidTaskSubmissions).toBe(0)
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})

test('Seedance 参考图越界时定位并裁剪，重试只审核替换后的素材', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const savedNodes = await installVideoModerationCanvas(page, 399, 1000, CROP_ASSET_ID)
  const reviews: string[] = []
  await page.route('**/api/v1/assets/501/seedance-moderation**', (route) => {
    reviews.push(route.request().method())
    return route.fulfill({ status: 500, json: { message: '不应送审' } })
  })
  const cropReviews: string[] = []
  await page.route(`**/api/v1/assets/${CROP_ASSET_ID}/seedance-moderation**`, (route) => {
    const method = route.request().method()
    if (method === 'GET' && !cropReviews.includes('POST')) {
      cropReviews.push(method)
      return route.fulfill({ status: 404, json: { message: '尚未审核' } })
    }
    cropReviews.push(method)
    if (method === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ workspace_id: WORKSPACE_ID })
      return route.fulfill({ json: { data: { status: 'pending' } } })
    }
    return route.fulfill({ json: { data: { status: 'rejected', reason: '替换图审核模拟拒绝' } } })
  })
  await page.addInitScript((uploadUrl) => {
    const capture = window as Window & { seedanceCropUpload?: number[] }
    const fetch = window.fetch
    window.fetch = async (input, init) => {
      if (String(input) === uploadUrl && init?.body instanceof FormData) {
        const file = init.body.get('file')
        if (file instanceof Blob) capture.seedanceCropUpload = [...new Uint8Array(await file.arrayBuffer())]
      }
      return fetch(input, init)
    }
  }, CROP_UPLOAD_URL)
  await page.route('**/api/v1/assets', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    expect(route.request().postDataJSON()).toMatchObject({
      workspace_id: WORKSPACE_ID,
      type: 'image',
      mime_type: 'image/png',
    })
    return route.fulfill({ json: { asset: { id: CROP_ASSET_ID }, upload: { url: CROP_UPLOAD_URL, form_fields: {} } } })
  })
  let croppedBytes: Buffer | undefined
  await page.route(CROP_UPLOAD_URL, async (route) => {
    const bytes = await page.evaluate(() => (window as Window & { seedanceCropUpload?: number[] }).seedanceCropUpload)
    expect(bytes).toBeDefined()
    croppedBytes = Buffer.from(bytes!)
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.route(`**/api/v1/assets/${CROP_ASSET_ID}/complete?**`, (route) =>
    route.fulfill({ json: { id: CROP_ASSET_ID, status: 'active' } }),
  )
  await page.route(`**/api/v1/assets/${CROP_ASSET_ID}/download?**`, (route) => {
    expect(croppedBytes).toBeDefined()
    return route.fulfill({ contentType: 'image/png', body: croppedBytes })
  })
  await page.goto('/canvas/125')
  await page.locator('.react-flow__node[data-id="video"]').click()
  const send = page.locator('[data-canvas-node-panel] [data-canvas-generate]')
  await send.click()

  const warning = page.getByRole('dialog', { name: '图片宽高比不符合送审要求' })
  await expect(warning).toBeVisible()
  await expect(warning.getByText(REFERENCE_TITLE, { exact: true })).toBeVisible()
  await expect(warning).toContainText(/399\s*×\s*1000/)
  await expect(page.getByRole('alertdialog', { name: '确认制作费用' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('invalid-reference-before-confirmation.png') })

  await warning.getByRole('button', { name: '定位并裁剪' }).click()
  const crop = page.getByRole('dialog', { name: '裁剪图片' })
  await expect(crop).toBeVisible()
  const saveCrop = crop.getByRole('button', { name: /^裁剪并(?:创建节点|替换参考图)$/ })
  await expect(saveCrop).toBeDisabled()
  await expect(crop.getByText(/图片宽高比低于 0\.4/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('invalid-reference-crop.png') })
  await crop.getByRole('button', { name: '1:1', exact: true }).click()
  await expect(crop.getByRole('status', { name: '裁剪尺寸' })).toContainText('399 × 399')
  await expect(saveCrop).toBeEnabled()
  await saveCrop.click()
  await expect(crop).toHaveCount(0)
  await expect
    .poll(() => savedNodes.filter((mutation) => mutation.element_id === 'video'))
    .toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          data: expect.objectContaining({
            croppedInputAssets: { edge: { originalAssetId: 501, assetId: CROP_ASSET_ID, workspaceId: WORKSPACE_ID } },
          }),
        }),
      }),
    )
  const source = page.locator('.react-flow__node[data-id="image"] img').first()
  await expect(source).toHaveAttribute('src', /\/assets\/501\/download/)
  expect(cropReviews).toEqual([])

  await page.getByRole('button', { name: '搜索', exact: true }).click()
  const search = page.getByRole('dialog', { name: '搜索画布节点' })
  await search.getByRole('textbox').fill(VIDEO_TITLE)
  await search.getByRole('option', { name: new RegExp(VIDEO_TITLE) }).click()
  await page.locator('.react-flow__node[data-id="video"]').click()
  await send.click()
  const confirmation = page.getByRole('alertdialog', { name: '确认制作费用' })
  await expect(confirmation).toBeVisible()
  expect(cropReviews).toEqual([])
  await confirmation.getByRole('button', { name: '继续制作' }).click()
  await expect(page.getByText(/替换图审核模拟拒绝/)).toBeVisible()
  expect(cropReviews).toEqual(['GET', 'POST', 'GET'])
  expect(reviews).toEqual([])
  expect(api.paidTaskSubmissions).toBe(0)
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})

test('Seedance 参考图越界时预览左右补边，用新素材送审并保留原图', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1000, height: 800 })
  const api = await installStrictAuthenticatedApp(page)
  const savedNodes = await installVideoModerationCanvas(page, 320, 1000, PADDED_ASSET_ID)
  const originalModeration: string[] = []
  await page.route('**/api/v1/assets/501/seedance-moderation**', (route) => {
    originalModeration.push(route.request().method())
    return route.fulfill({ status: 500, json: { message: '原图不应送审' } })
  })
  const result = await mockPaddedImageUpload(page, REFERENCE_TITLE, 'rejected')
  await page.goto('/canvas/125')
  const video = page.locator('.react-flow__node[data-id="video"]')
  await video.click()
  const generate = page.locator('[data-canvas-node-panel] [data-canvas-generate]')
  await generate.click()
  const warning = page.getByRole('dialog', { name: '图片宽高比不符合送审要求' })
  await expect(warning.getByText(REFERENCE_TITLE, { exact: true })).toBeVisible()
  await expect(warning.getByRole('button', { name: '定位并裁剪' })).toBeVisible()
  await warning.getByRole('button', { name: '补边保留全图' }).click()
  const preview = page.getByRole('dialog', { name: '补边保留全图' })
  await expect(preview.getByRole('img', { name: '补边预览' })).toBeVisible()
  const dimensions = preview.getByRole('status', { name: '补边尺寸' })
  await expect(dimensions).toContainText(/400\s*×\s*1000/)
  await expect(dimensions).toContainText('左 40 px，右 40 px')
  const confirmation = page.getByRole('alertdialog', { name: '确认制作费用' })
  await expect(confirmation).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('padding-vertical-preview.png') })
  expect(result.uploads).toEqual([])
  expect(result.moderation).toEqual([])
  await preview.getByRole('button', { name: '另存并送审' }).click()
  await expect(preview).toHaveCount(0)
  await expect.poll(() => result.moderation).toEqual(['GET', 'POST', 'GET'])
  await expect
    .poll(() => savedNodes.filter((mutation) => mutation.element_id === 'video'))
    .toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          data: expect.objectContaining({
            croppedInputAssets: { edge: { originalAssetId: 501, assetId: PADDED_ASSET_ID, workspaceId: WORKSPACE_ID } },
          }),
        }),
      }),
    )
  await expect(page.locator('.react-flow__node[data-id="image"] img').first()).toHaveAttribute(
    'src',
    /\/assets\/501\/download/,
  )
  expect(result.uploads).toHaveLength(1)
  await expectPaddedPixels(page, result.uploads[0], { width: 400, height: 1000 })
  expect(api.paidTaskSubmissions).toBe(0)
  expect(originalModeration).toEqual([])
  await expect(confirmation).toHaveCount(0)

  await page.getByRole('button', { name: '搜索', exact: true }).click()
  const search = page.getByRole('dialog', { name: '搜索画布节点' })
  await search.getByRole('textbox').fill(VIDEO_TITLE)
  await search.getByRole('option', { name: new RegExp(VIDEO_TITLE) }).click()
  await video.click()
  await generate.click()
  await confirmation.getByRole('button', { name: '继续制作' }).click()
  await expect(page.getByText(/补边图审核模拟拒绝/)).toBeVisible()
  expect(result.moderation).toEqual(['GET', 'POST', 'GET', 'GET'])
  expect(originalModeration).toEqual([])
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})

test('Seedance 自动送审遇到超宽视频时只提醒手动裁剪和最小最大比例', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  await mockIntrinsicVideoSize(page, { width: 1001, height: 400 })
  await installVideoModerationCanvas(page, 1001, 400, undefined, 'video')
  const moderation: string[] = []
  await page.route('**/api/v1/assets/501/seedance-moderation**', (route) => {
    moderation.push(route.request().method())
    return route.fulfill({ status: 500, json: { message: '超出比例的视频不应送审' } })
  })
  await page.goto('/canvas/125')
  await page.locator('.react-flow__node[data-id="video"]').click()
  await page.locator('[data-canvas-node-panel] [data-canvas-generate]').click()
  const reminder = page.getByText(/请手动裁剪/)
  await expect(reminder).toBeVisible()
  await expect(reminder).toContainText(/最小\s*0\.4.*最大\s*2\.5/)
  await expect(reminder).toContainText('故事场景超宽视频')
  await expect(page.getByRole('button', { name: '补边保留全图' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '定位并裁剪' })).toHaveCount(0)
  await expect(page.getByRole('alertdialog', { name: '确认制作费用' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('automatic-video-crop-reminder.png') })
  expect(moderation).toEqual([])
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
