import { expect, test, type Page } from '@playwright/test'
import { makePaddingSourcePng } from './fixtures/canvas-seedance-preflight'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const CANVAS_ID = 936
const SOURCE_ASSET_ID = 501
const REPLACEMENT_ASSET_ID = 503
const UPLOAD_URL = 'https://canvas-test.oss-cn-beijing.aliyuncs.com/processed-reference'
const REFERENCE_TITLE = '故事分镜参考图'

type Mutation = { element_id: string; op: string; kind: string; payload?: { data?: Record<string, unknown> } }
type Size = { width: number; height: number }
type UploadWindow = Window & { replacementFileBytes?: number[] }

async function installReferenceCanvas(page: Page, size: Size, seedance: boolean) {
  const api = await installStrictAuthenticatedApp(page)
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  const sourceBytes = await makePaddingSourcePng(page, size)
  const initialElements = [
    {
      element_id: 'image',
      kind: 'node',
      op: 'upsert',
      payload: {
        type: 'image',
        position: { x: 100, y: 100 },
        data: {
          kind: 'image',
          title: REFERENCE_TITLE,
          assetId: SOURCE_ASSET_ID,
          assetWorkspaceId: WORKSPACE_ID,
          assetSource: 'upload',
        },
      },
    },
    {
      element_id: 'video',
      kind: 'node',
      op: 'upsert',
      payload: {
        type: 'video',
        position: { x: 600, y: 100 },
        data: {
          kind: 'video',
          title: '故事分镜短片',
          prompt: '一只小猫走过花园',
          modelVersionId: 42,
          operationCode: 'video.generate',
        },
      },
    },
    {
      element_id: 'edge',
      kind: 'edge',
      op: 'upsert',
      payload: { source: 'image', target: 'video', data: { slotIndex: 0 } },
    },
  ]
  const elements = new Map<string, Mutation>(initialElements.map((item) => [item.element_id, item]))
  const state = {
    revision: 1,
    mutations: [] as Mutation[],
    uploads: [] as Buffer[],
    assetCreates: 0,
    moderations: [] as Array<{ assetId: number; method: string }>,
    taskSubmissions: [] as Array<{ input_assets?: Array<{ asset_id: number }> }>,
    allowGeneration: false,
  }

  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 42,
            display_name: seedance ? 'Seedance 2.5' : '普通视频模型',
            capability: 'video',
            operation_codes: ['video.generate'],
            input_constraints: { 'video.generate': { roles: [{ role: 'image', max_count: 5 }] } },
          },
        ],
      },
    }),
  )
  await page.route(`**/api/v1/canvases/${CANVAS_ID}**`, (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname.endsWith('/events')) return route.fulfill({ status: 204 })
    if (url.pathname.endsWith('/members')) {
      return route.fulfill({
        json: { creator_id: 7, members_restricted: false, member_user_ids: [], can_manage: true },
      })
    }
    if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
    if (!url.pathname.endsWith('/elements')) {
      return route.fulfill({ json: { id: CANVAS_ID, title: '参考图替换验证', user_id: 7, revision: state.revision } })
    }
    if (method === 'PATCH') {
      const { mutations = [] } = route.request().postDataJSON() as { mutations?: Mutation[] }
      for (const mutation of mutations) {
        if (mutation.op === 'delete') elements.delete(mutation.element_id)
        else elements.set(mutation.element_id, mutation)
      }
      state.mutations.push(...mutations)
      return route.fulfill({ json: { sync_revision: ++state.revision } })
    }
    return route.fulfill({
      json: {
        elements: Number(url.searchParams.get('after_revision')) ? [] : [...elements.values()],
        sync_revision: state.revision,
        history_floor_revision: 0,
        has_more: false,
      },
    })
  })
  await page.routeWebSocket(`**/api/v1/canvases/${CANVAS_ID}/node-locks/socket?**`, (socket) => {
    socket.onMessage(() => socket.send(JSON.stringify({ type: 'state', data: { granted: true, nodes: {} } })))
  })

  await page.addInitScript((uploadUrl) => {
    const originalFetch = window.fetch
    window.fetch = async (input, init) => {
      if (String(input) === uploadUrl && init?.body instanceof FormData) {
        const file = init.body.get('file')
        if (file instanceof Blob)
          (window as UploadWindow).replacementFileBytes = [...new Uint8Array(await file.arrayBuffer())]
      }
      return originalFetch(input, init)
    }
  }, UPLOAD_URL)
  await page.route('**/api/v1/assets?**', (route) => {
    const ids = state.uploads.length ? [SOURCE_ASSET_ID, REPLACEMENT_ASSET_ID] : [SOURCE_ASSET_ID]
    return route.fulfill({
      json: { items: ids.map((id) => ({ id, workspace_id: WORKSPACE_ID, type: 'image', status: 'active' })) },
    })
  })
  await page.route('**/api/v1/assets', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    state.assetCreates++
    expect(route.request().postDataJSON()).toMatchObject({
      name: '已处理参考图.png',
      workspace_id: WORKSPACE_ID,
      type: 'image',
      mime_type: 'image/png',
    })
    return route.fulfill({
      json: { asset: { id: REPLACEMENT_ASSET_ID }, upload: { url: UPLOAD_URL, form_fields: {} } },
    })
  })
  await page.route(UPLOAD_URL, async (route) => {
    const bytes = await page.evaluate(() => (window as UploadWindow).replacementFileBytes)
    expect(bytes).toBeDefined()
    state.uploads.push(Buffer.from(bytes!))
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.route(`**/api/v1/assets/${SOURCE_ASSET_ID}/download**`, (route) =>
    route.fulfill({ contentType: 'image/png', body: sourceBytes }),
  )
  await page.route(`**/api/v1/assets/${REPLACEMENT_ASSET_ID}/complete?**`, (route) =>
    route.fulfill({ json: { id: REPLACEMENT_ASSET_ID, status: 'active' } }),
  )
  await page.route(`**/api/v1/assets/${REPLACEMENT_ASSET_ID}/download**`, (route) => {
    expect(state.uploads).toHaveLength(1)
    return route.fulfill({ contentType: 'image/png', body: state.uploads[0] })
  })
  await page.route('**/api/v1/assets/*/seedance-moderation**', (route) => {
    const assetId = Number(new URL(route.request().url()).pathname.split('/').at(-2))
    state.moderations.push({ assetId, method: route.request().method() })
    return route.fulfill({ status: 500, json: { message: '本用例不会送审' } })
  })
  await page.route('**/api/v1/ai/tasks', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    state.taskSubmissions.push(route.request().postDataJSON())
    expect(state.allowGeneration).toBe(true)
    return route.fulfill({ status: 400, json: { code_string: 'INVALID_MODEL_PARAMS', message: '模拟任务提交结束' } })
  })

  await page.goto(`/canvas/${CANVAS_ID}`)
  const video = page.locator('.react-flow__node[data-id="video"] .canvas-node-body')
  await video.click()
  const send = page.locator('[data-canvas-node-panel] [data-canvas-generate]')
  await expect(send).toBeEnabled()
  const confirmation = page.getByRole('alertdialog', { name: '确认制作费用' })
  return { api, pageErrors, state, send, confirmation, video }
}

for (const seedance of [false, true]) {
  test(`${seedance ? 'Seedance' : '普通视频'}参考图支持上传已处理图片，内置裁剪由用户选择`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1200, height: 900 })
    const size = seedance ? { width: 320, height: 1000 } : { width: 200, height: 300 }
    const invalidFile = await makePaddingSourcePng(page, { width: 224, height: 420 })
    const validFile = await makePaddingSourcePng(page, { width: 400, height: 1000 })
    const { api, pageErrors, state, send, confirmation, video } = await installReferenceCanvas(page, size, seedance)
    const warning = page.getByRole('dialog', { name: seedance ? '图片宽高比不符合送审要求' : '参考图尺寸不符合要求' })
    const openWarning = async () => {
      if (await warning.isVisible()) return
      if (!(await send.isVisible())) await video.click()
      await send.click()
      if (!seedance) {
        await expect(warning.or(confirmation).first()).toBeVisible()
        if (!(await warning.isVisible())) await confirmation.getByRole('button', { name: '继续制作' }).click()
      }
      await expect(warning).toBeVisible()
    }
    const crop = page.getByRole('dialog', { name: '裁剪图片', exact: true })
    const builtInControls = warning.getByRole('combobox', { name: '裁切比例' })

    await openWarning()
    await expect(warning).toContainText(new RegExp(`${size.width}\\s*×\\s*${size.height}`))
    await expect(warning.getByText(/256\s*[–—-]\s*5760\s*像素/)).toBeVisible()
    await expect(warning.getByText(/0\.4\s*[–—-]\s*2\.5/)).toBeVisible()
    await expect(crop).toBeHidden()
    await expect(builtInControls).toBeHidden()
    await expect(confirmation).toBeHidden()
    await page.screenshot({ path: testInfo.outputPath('reference-image-limits.png'), animations: 'disabled' })
    await warning.getByRole('button', { name: seedance ? /close|关闭/i : '关闭，稍后生成' }).click()
    await expect(warning).toBeHidden()
    expect(state.assetCreates).toBe(0)
    expect(state.uploads).toEqual([])
    expect(state.moderations).toEqual([])
    expect(state.taskSubmissions).toEqual([])

    await openWarning()
    await warning.getByRole('button', { name: seedance ? '定位并裁剪' : '使用内置裁剪', exact: true }).click()
    if (seedance) {
      await expect(crop).toBeVisible()
      await crop.getByRole('button', { name: /^取\s*消$/ }).click()
      await expect(crop).toBeHidden()
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      const search = page.getByRole('dialog', { name: '搜索画布节点' })
      await search.getByRole('textbox').fill('故事分镜短片')
      await search.getByRole('option', { name: /故事分镜短片/ }).click()
      await video.click()
    } else {
      await expect(builtInControls).toBeVisible()
      await warning.getByRole('button', { name: '收起内置裁剪', exact: true }).click()
      await expect(builtInControls).toBeHidden()
    }
    expect(state.assetCreates).toBe(0)

    await openWarning()
    const selectReplacement = async (name: string, buffer: Buffer) => {
      const upload = warning.getByRole('button', { name: /上传已处理图片/ })
      await expect(upload).toBeEnabled()
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10_000 }), upload.click()])
      await chooser.setFiles({ name, mimeType: 'image/png', buffer })
    }
    await selectReplacement('尺寸仍超限.png', invalidFile)
    await expect(warning.getByRole('alert').filter({ hasText: /224\s*×\s*420/ })).toBeVisible()
    expect(state.assetCreates).toBe(0)
    expect(state.uploads).toEqual([])
    expect(state.moderations).toEqual([])
    expect(state.taskSubmissions).toEqual([])

    await selectReplacement('已处理参考图.png', validFile)
    await expect(warning).toBeHidden()
    await expect
      .poll(() => state.mutations.findLast((mutation) => mutation.element_id === 'video')?.payload?.data)
      .toMatchObject({
        croppedInputAssets: {
          edge: { originalAssetId: SOURCE_ASSET_ID, assetId: REPLACEMENT_ASSET_ID, workspaceId: WORKSPACE_ID },
        },
      })
    await expect(page.locator('.react-flow__node[data-id="image"] img').first()).toHaveAttribute(
      'src',
      /\/assets\/501\/download/,
    )
    expect(state.assetCreates).toBe(1)
    expect(state.uploads).toEqual([validFile])
    expect(state.moderations).toEqual([])
    expect(state.taskSubmissions).toEqual([])
    expect(api.paidTaskSubmissions).toBe(0)
    await expect(confirmation).toBeHidden()
    expect(pageErrors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}

test('普通视频模型接收尺寸合规的原参考图，无需裁剪或重新上传', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1200, height: 900 })
  const { api, pageErrors, state, send, confirmation } = await installReferenceCanvas(
    page,
    { width: 256, height: 640 },
    false,
  )
  await send.click()
  await expect(confirmation).toBeVisible()
  expect(state.taskSubmissions).toEqual([])
  state.allowGeneration = true
  await confirmation.getByRole('button', { name: '继续制作' }).click()
  await expect.poll(() => state.taskSubmissions.length).toBe(1)
  expect(state.taskSubmissions[0].input_assets).toContainEqual(expect.objectContaining({ asset_id: SOURCE_ASSET_ID }))
  await expect(page.getByRole('dialog', { name: '参考图尺寸不符合要求' })).toBeHidden()
  expect(state.assetCreates).toBe(0)
  expect(state.moderations).toEqual([])
  expect(pageErrors).toEqual([])
  expectNoUnexpectedApi(api)
})
