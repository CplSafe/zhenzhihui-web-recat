import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  expectNoUnexpectedApi,
  fulfillFixtureVideo,
  installStrictAuthenticatedApp,
  WORKSPACE_ID,
} from './fixtures/strict-authenticated-app'

const canvasId = 172
const videoAssetId = 601
const imageAssetId = 701
const maskAssetId = 702
const videoReferenceAssetId = 703
const targetImageAssetId = 704
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
const targetImageAsset = { ...videoReplacementAsset, id: targetImageAssetId, name: '蓝色陶瓷杯.png' }

type SubjectModelFixture = {
  id: number
  provider: string
  model?: string
  version: string
  capability: 'image' | 'video'
  display_name: string
  enabled: boolean
  operation_codes: string[]
  input_constraints?: Record<string, unknown>
  params_schema?: Record<string, unknown>
}

const openAiSubjectModel: SubjectModelFixture = {
  id: 57,
  provider: 'openai',
  model: 'gpt-image-2.6-sunburst',
  version: 'gpt-image-2.6-sunburst',
  display_name: 'GPT Image 2.6 Sunburst',
  capability: 'image',
  enabled: true,
  operation_codes: ['image.image_to_image'],
  input_constraints: {
    'image.image_to_image': {
      roles: [
        { role: 'reference_image', min_count: 1, max_count: 16, mime_types: ['image/*'] },
        { role: 'mask', max_count: 1 },
      ],
    },
  },
}

const gptImage25FlareSubjectModel: SubjectModelFixture = {
  ...openAiSubjectModel,
  id: 31,
  model: 'gpt-image-2.5-flare',
  version: 'gpt-image-2.5-flare',
  display_name: 'GPT Image 2.5 Flare',
}

const gptImage25SunburstSubjectModel: SubjectModelFixture = {
  ...openAiSubjectModel,
  id: 30,
  model: 'gpt-image-2.5-sunburst',
  version: 'gpt-image-2.5-sunburst',
  display_name: 'GPT Image 2.5 Sunburst',
}

const seedreamSubjectModel: SubjectModelFixture = {
  id: 33,
  provider: 'volcengine',
  model: 'doubao-seedream-5-0-pro',
  version: 'doubao-seedream-5-0-pro-260628',
  display_name: 'Seedream 5.0 Pro',
  capability: 'image',
  enabled: true,
  operation_codes: ['image.image_to_image'],
  input_constraints: {
    'image.image_to_image': {
      roles: [{ role: 'reference_image', min_count: 1, max_count: 10, mime_types: ['image/*'] }],
    },
  },
}

const happyHorseSubjectModel: SubjectModelFixture = {
  id: 9,
  provider: 'bailian',
  model: 'happyhorse-1.0-video-edit',
  version: 'happyhorse-1.0-video-edit',
  display_name: 'HappyHorse 视频编辑',
  capability: 'video',
  enabled: true,
  operation_codes: ['video.edit'],
  input_constraints: {
    'video.edit': {
      roles: [
        { role: 'video', min_count: 1, max_count: 1 },
        { role: 'image', min_count: 0, max_count: 5, mime_types: ['image/*'] },
      ],
    },
  },
  params_schema: {
    fields: [{ name: 'audio_setting', type: 'select', options: ['auto', 'origin'] }],
  },
}

const wanSubjectModel: SubjectModelFixture = {
  ...happyHorseSubjectModel,
  id: 19,
  model: 'wan3.0-video',
  version: 'wan3.0-video',
  display_name: '万相 3.0 视频生成',
  params_schema: { fields: [{ name: 'audio', type: 'boolean', default: true }] },
}

const sourceOnlyVideoModel: SubjectModelFixture = {
  id: 46,
  provider: 'mock',
  version: 'video-edit-source-only',
  display_name: '仅支持原视频的编辑模型',
  capability: 'video',
  enabled: true,
  operation_codes: ['video.edit'],
  input_constraints: {
    'video.edit': { roles: [{ role: 'video', min_count: 1, max_count: 1 }] },
  },
}

const seedanceSubjectModel: SubjectModelFixture = {
  id: 18,
  provider: 'volcengine',
  model: 'doubao-seedance-2-5',
  version: 'doubao-seedance-2-5-260628',
  display_name: 'Seedance 2.5',
  capability: 'video',
  enabled: true,
  operation_codes: ['video.generate'],
  input_constraints: {
    'video.generate': {
      roles: [
        { role: 'image', min_count: 0, max_count: 30, mime_types: ['image/jpeg', 'image/png', 'image/webp'] },
        { role: 'video', min_count: 0, max_count: 10, mime_types: ['video/*'] },
        { role: 'audio', min_count: 0, max_count: 10, mime_types: ['audio/*'] },
      ],
    },
  },
  params_schema: {
    fields: [
      {
        name: 'duration',
        type: 'select',
        required: true,
        default: 5,
        options: Array.from({ length: 27 }, (_, i) => i + 4),
      },
      { name: 'resolution', type: 'select', default: '720p', options: ['480p', '720p'] },
      { name: 'ratio', type: 'select', default: '16:9', options: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] },
      { name: 'generate_audio', type: 'boolean', default: false },
      { name: 'reference_mode', type: 'boolean', default: false },
      { name: 'mode', type: 'select', default: 'generate', options: ['generate', 'edit', 'extend'] },
    ],
  },
}

const seedanceFlashSubjectModel: SubjectModelFixture = {
  ...seedanceSubjectModel,
  id: 60,
  model: 'doubao-seedance-2-5-flash',
  version: 'doubao-seedance-2-5-flash-261115',
  display_name: 'Seedance 2.5 Flash',
  input_constraints: {
    'video.generate': {
      roles: [
        { role: 'image', min_count: 0, max_count: 10, mime_types: ['image/jpeg', 'image/png', 'image/webp'] },
        { role: 'video', min_count: 0, max_count: 5, mime_types: ['video/*'] },
        { role: 'audio', min_count: 0, max_count: 5, mime_types: ['audio/*'] },
      ],
    },
  },
}

const seedanceStandardSubjectModel: SubjectModelFixture = {
  ...seedanceSubjectModel,
  id: 5,
  model: 'doubao-seedance-2-0',
  version: 'doubao-seedance-2-0-260128',
  display_name: 'Seedance 2.0',
}

const seedanceFastSubjectModel: SubjectModelFixture = {
  ...seedanceSubjectModel,
  id: 15,
  model: 'doubao-seedance-2-0-fast',
  version: 'doubao-seedance-2-0-fast-260128',
  display_name: 'Seedance 2.0 Fast',
}

const seedanceMiniSubjectModel: SubjectModelFixture = {
  ...seedanceSubjectModel,
  id: 16,
  model: 'doubao-seedance-2-0-mini',
  version: 'doubao-seedance-2-0-mini-260615',
  display_name: 'Seedance 2.0 Mini',
}

const nanoBananaSubjectModel: SubjectModelFixture = {
  ...seedreamSubjectModel,
  id: 17,
  provider: 'google',
  model: 'gemini-2.5-flash-image',
  version: 'gemini-2.5-flash-image',
  display_name: 'Nano Banana (Google)',
}

const nanoBanana2SubjectModel: SubjectModelFixture = {
  ...nanoBananaSubjectModel,
  id: 28,
  model: 'gemini-3.1-flash-image',
  version: 'gemini-3.1-flash-image',
  display_name: 'Nano Banana 2 (Google)',
}

const qwenSubjectModel: SubjectModelFixture = {
  ...seedreamSubjectModel,
  id: 48,
  provider: 'bailian',
  model: 'qwen-image-2.0',
  version: 'qwen-image-2.0-2026-03-03',
  display_name: 'Qwen Image edit 2.0',
}

const gptImage2SubjectModel: SubjectModelFixture = {
  ...openAiSubjectModel,
  id: 2,
  model: 'gpt-image-2',
  version: 'gpt-image-2',
  display_name: 'GPT Image 2',
}

async function dragSelection(page: Page, canvas: Locator, from: [number, number], to: [number, number]) {
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 6 })
  await page.mouse.up()
}

async function mockOriginalVideo(page: Page) {
  const video = readFileSync(new URL('./fixtures/canvas-subject-12s.mp4', import.meta.url))
  await page.route(/\/api\/v1\/assets\/(601|602)\/download\?/, (route) => fulfillFixtureVideo(route, video))
}

async function mockSubjectImageDownloads(page: Page) {
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
  await page.route(/\/api\/v1\/assets\/(701|704|502)\/download/, (route) =>
    route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }),
  )
}

async function addTargetReference(page: Page, dialog: Locator) {
  await dialog.getByRole('button', { name: '添加目标参考图', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择图片', exact: true })
  await expect(picker).toBeVisible()
  await picker.getByRole('textbox', { name: '搜索素材名称' }).fill(targetImageAsset.name)
  await expect(picker.locator(`img[src*="/assets/${targetImageAsset.id}/download"]`)).toBeVisible()
  const apply = picker.getByRole('button', { name: '应用', exact: true })
  await apply.focus()
  await apply.press('Enter')
  await expect(picker).toBeHidden()
  await expect(dialog.getByRole('img', { name: '目标参考图预览' })).toHaveAttribute(
    'src',
    new RegExp(`/assets/${targetImageAsset.id}/download`),
  )
}

async function openEditModelMenu(page: Page, dialog: Locator) {
  await dialog.getByRole('combobox', { name: '编辑模型' }).press('ArrowDown')
  const menu = page.locator('.ant-select-dropdown:visible')
  await expect(menu).toBeVisible()
  return menu
}

async function chooseEditModel(page: Page, dialog: Locator, model: SubjectModelFixture) {
  const menu = await openEditModelMenu(page, dialog)
  await menu.getByTitle(model.display_name, { exact: true }).click()
}

async function mockSubjectMaskUpload(page: Page) {
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
  await page.route('**/api/v1/mock-subject-mask', (route) => {
    uploads += 1
    return route.fulfill({ status: 204 })
  })
  await page.route(`**/api/v1/assets/${maskAssetId}/complete?**`, (route) =>
    route.fulfill({ json: { id: maskAssetId, status: 'active' } }),
  )
  return () => uploads
}

async function setupSubjectEdit(
  page: Page,
  kind: 'video' | 'image',
  {
    extraModels = [],
    materials = [],
  }: { extraModels?: SubjectModelFixture[]; materials?: (typeof targetImageAsset)[] } = {},
) {
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
  const model: SubjectModelFixture = {
    id: modelId,
    provider: kind === 'image' ? 'openai' : 'mock',
    version: kind === 'image' ? 'gpt-image-2.6-flare' : 'video-edit-12s',
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
  if (kind === 'video') {
    await mockOriginalVideo(page)
    await page.route('**/api/v1/assets', (route) => {
      if (route.request().method() === 'POST' && route.request().postDataJSON()?.source === 'canvas-poster') {
        return route.fulfill({ status: 503, json: { message: '测试环境不保存自动封面' } })
      }
      return route.fallback()
    })
  }
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  let workspaceCatalogReads = 0
  await page.route('**/api/v1/ai/models**', (route) => {
    const query = new URL(route.request().url()).searchParams
    const operationCode = query.get('operation_code')
    const capability = query.get('capability')
    if (!operationCode && !capability) {
      expect(query.get('workspace_id')).toBe(String(WORKSPACE_ID))
      expect(query.has('plan')).toBe(false)
      workspaceCatalogReads += 1
    }
    return route.fulfill({
      json: {
        items: [model, ...extraModels].filter(
          (item) =>
            (!operationCode || item.operation_codes.includes(operationCode)) &&
            (!capability || capability === item.capability),
        ),
      },
    })
  })
  await page.route(/\/api\/v1\/assets(?:\?|$)/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const type = new URL(route.request().url()).searchParams.get('type')
    const assets = [asset, selectionAsset, resultAsset, ...materials]
    if (kind === 'video') assets.push(videoReplacementAsset)
    const items = type ? assets.filter((item) => item.type === type) : assets
    return route.fulfill({ json: { items, total: items.length } })
  })
  await page.route(`**/api/v1/assets/${sourceAssetId}?**`, (route) => route.fulfill({ json: asset }))
  await page.route('**/api/v1/real-people?**', (route) => {
    expect(route.request().method()).toBe('GET')
    expect(new URL(route.request().url()).searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    return route.fulfill({ json: [] })
  })

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
  const open = async (beforeOpen?: () => Promise<void>) => {
    await sourceNode.locator('.canvas-node-header').click()
    await beforeOpen?.()
    await page.getByRole('button', { name: '主体编辑', exact: true }).click()
    await expect(dialog).toBeVisible()
    for (const name of ['主体消除', '主体修改', '主体替换']) {
      await expect(dialog.getByRole('button', { name, exact: true })).toBeEnabled()
    }
  }
  const result = (title: string) =>
    page.locator('.react-flow__node').filter({ has: page.getByRole('button', { name: `${title}结果`, exact: true }) })
  const expectMatchingEstimate = (request: Record<string, unknown>) => {
    expect(estimates.filter((estimate) => estimate.prompt === request.prompt).at(-1)).toMatchObject({
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
    estimates,
    expectMatchingEstimate,
    modelId,
    open,
    operation,
    pageErrors,
    result,
    saved,
    sourceNode,
    submissions,
    get workspaceCatalogReads() {
      return workspaceCatalogReads
    },
  }
}

async function expectVideoEstimate(
  app: Awaited<ReturnType<typeof setupSubjectEdit>>,
  request: Record<string, unknown>,
) {
  await expect.poll(() => app.estimates.at(-1)).toMatchObject(request)
  await expect(app.dialog.getByText('预计消耗 10 积分', { exact: true })).toBeVisible()
}

for (const { kind, hidden, visible } of [
  {
    kind: 'video',
    hidden: [happyHorseSubjectModel, seedanceStandardSubjectModel],
    visible: [wanSubjectModel, seedanceFastSubjectModel, seedanceSubjectModel],
  },
  {
    kind: 'image',
    hidden: [qwenSubjectModel, nanoBananaSubjectModel, gptImage2SubjectModel],
    visible: [nanoBanana2SubjectModel, openAiSubjectModel, seedreamSubjectModel],
  },
] as const) {
  test(`主体编辑隐藏指定${kind === 'video' ? '视频' : '图片'}模型并保留其他型号`, async ({ page }, testInfo) => {
    // 准备完整目录时把隐藏项放在前面，确保其缺席不是 Ant Design 虚拟滚动未渲染所致。
    const app = await setupSubjectEdit(page, kind, { extraModels: [...hidden, ...visible] })
    await page.goto(`/canvas/${canvasId}`)
    await app.open()
    const menu = await openEditModelMenu(page, app.dialog)
    for (const model of visible) await expect(menu.getByTitle(model.display_name, { exact: true })).toBeVisible()
    for (const model of hidden) await expect(menu.getByTitle(model.display_name, { exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`${kind}-subject-edit-model-menu.png`) })
    expect(app.workspaceCatalogReads).toBeGreaterThan(0)
    expect(app.submissions).toHaveLength(0)
    expect(app.pageErrors).toEqual([])
    expectNoUnexpectedApi(app.api)
  })
}

test('视频主体编辑按模式筛选 Seedance 型号并按 Flash 版本提交', async ({ page }, testInfo) => {
  const app = await setupSubjectEdit(page, 'video', {
    extraModels: [seedanceMiniSubjectModel, seedanceSubjectModel, seedanceFastSubjectModel, seedanceFlashSubjectModel],
  })
  await page.route(`**/api/v1/assets/${videoAssetId}/seedance-moderation?**`, (route) =>
    route.fulfill({ json: { data: { status: 'active' } } }),
  )
  await page.goto(`/canvas/${canvasId}`)
  await app.open()
  const { dialog } = app
  const modify = dialog.getByRole('button', { name: '主体修改', exact: true })
  const remove = dialog.getByRole('button', { name: '主体消除', exact: true })
  const replace = dialog.getByRole('button', { name: '主体替换', exact: true })
  const submit = dialog.getByRole('button', { name: '开始处理', exact: true })
  const selected = dialog.locator('.ant-select-selection-item')
  const mini = seedanceMiniSubjectModel.display_name
  const seedance25 = seedanceSubjectModel.display_name
  const fast = seedanceFastSubjectModel.display_name
  const flash = seedanceFlashSubjectModel.display_name

  await modify.click()
  let menu = await openEditModelMenu(page, dialog)
  await expect(menu.getByTitle(mini, { exact: true })).toBeVisible()
  await expect(menu.getByTitle(seedance25, { exact: true })).toBeVisible()
  await expect(menu.getByTitle(fast, { exact: true })).toBeVisible()
  await expect(menu.getByTitle(flash, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('video-modify-model-menu.png') })
  await menu.getByTitle(mini, { exact: true }).click()
  await expectVideoEstimate(app, { model_version_id: seedanceMiniSubjectModel.id })
  await expect(submit).toBeDisabled()
  await dialog.getByRole('textbox', { name: '要处理的主体' }).fill('画面中央的红色物体')
  await dialog.getByRole('textbox', { name: '修改说明' }).fill('改成蓝色')
  await expect(submit).toBeEnabled()

  await remove.click()
  await expect(selected).toHaveText('测试视频编辑模型')
  await expectVideoEstimate(app, { model_version_id: app.modelId })
  menu = await openEditModelMenu(page, dialog)
  await expect(menu.getByTitle(mini, { exact: true })).toHaveCount(0)
  await expect(menu.getByTitle(seedance25, { exact: true })).toBeVisible()
  await expect(menu.getByTitle(fast, { exact: true })).toBeVisible()
  await expect(menu.getByTitle(flash, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('video-remove-model-menu.png') })
  await menu.getByTitle(seedance25, { exact: true }).click()
  await expectVideoEstimate(app, { model_version_id: seedanceSubjectModel.id })
  await expect(submit).toBeEnabled()

  await replace.click()
  await expect(selected).toHaveText('测试视频编辑模型')
  await expectVideoEstimate(app, { model_version_id: app.modelId })
  await expect(submit).toBeDisabled()
  menu = await openEditModelMenu(page, dialog)
  await expect(menu.getByTitle(mini, { exact: true })).toBeVisible()
  await expect(menu.getByTitle(seedance25, { exact: true })).toHaveCount(0)
  await expect(menu.getByTitle(fast, { exact: true })).toBeVisible()
  await expect(menu.getByTitle(flash, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('video-replace-model-menu.png') })
  await menu.getByTitle(flash, { exact: true }).click()
  await dialog.getByRole('textbox', { name: '替换说明' }).fill('替换为深绿色皮卡')
  const flashRequest = {
    model_version_id: seedanceFlashSubjectModel.id,
    operation_code: 'video.generate',
    params: { mode: 'edit', duration, generate_audio: true, reference_mode: true },
    input_assets: [{ asset_id: videoAssetId, role: 'video' }],
  }
  await expectVideoEstimate(app, flashRequest)
  await expect(submit).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('video-replace-flash-estimate.png') })
  await submit.click()
  await expect(dialog).toBeHidden()
  expect(app.submissions).toHaveLength(1)
  expect(app.submissions[0]).toMatchObject(flashRequest)
  app.expectMatchingEstimate(app.submissions[0])
  expect(app.pageErrors).toEqual([])
  expectNoUnexpectedApi(app.api)
})

test('图片主体编辑仅在修改模式隐藏 GPT Image 2.5 Flare 并清除旧估价', async ({ page }, testInfo) => {
  const app = await setupSubjectEdit(page, 'image', {
    extraModels: [gptImage25FlareSubjectModel, gptImage25SunburstSubjectModel],
  })
  await mockSubjectImageDownloads(page)
  await mockSubjectMaskUpload(page)
  await page.goto(`/canvas/${canvasId}`)
  await app.open()
  const { dialog } = app
  const flare = gptImage25FlareSubjectModel.display_name
  const sunburst = gptImage25SunburstSubjectModel.display_name
  const submit = dialog.getByRole('button', { name: '开始处理', exact: true })
  let menu = await openEditModelMenu(page, dialog)
  await expect(menu.getByTitle(flare, { exact: true })).toBeVisible()
  await expect(menu.getByTitle(sunburst, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('image-remove-model-menu.png') })
  await menu.getByTitle(flare, { exact: true }).click()
  const selection = dialog.locator('canvas[aria-label="图片涂抹区域"]')
  await expect(selection).toBeVisible()
  await dialog.getByRole('button', { name: '框选', exact: true }).click()
  await dragSelection(page, selection, [0.28, 0.32], [0.45, 0.69])
  await dialog.getByRole('button', { name: /^估\s*价$/ }).click()
  await expect(submit).toBeEnabled()
  expect(app.estimates.at(-1)?.model_version_id).toBe(gptImage25FlareSubjectModel.id)

  await dialog.getByRole('button', { name: '主体修改', exact: true }).click()
  await expect(dialog.locator('.ant-select-selection-item')).toHaveText('GPT Image')
  await expect(dialog.getByRole('status')).toHaveText('')
  await expect(submit).toBeDisabled()
  menu = await openEditModelMenu(page, dialog)
  await expect(menu.getByTitle(flare, { exact: true })).toHaveCount(0)
  await expect(menu.getByTitle(sunburst, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('image-modify-model-menu.png') })
  await menu.getByTitle(sunburst, { exact: true }).click()

  await dialog.getByRole('button', { name: '主体替换', exact: true }).click()
  menu = await openEditModelMenu(page, dialog)
  await expect(menu.getByTitle(flare, { exact: true })).toBeVisible()
  await expect(menu.getByTitle(sunburst, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('image-replace-model-menu.png') })
  expect(app.submissions).toHaveLength(0)
  expect(app.pageErrors).toEqual([])
  expectNoUnexpectedApi(app.api)
})

test('视频主体编辑保留 12 秒原片，并分别生成新节点', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const app = await setupSubjectEdit(page, 'video')
  const replacement = videoReplacementAsset
  let referenceUploads = 0
  await page.route('**/api/v1/assets', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = route.request().postDataJSON()
    if (body.source === 'canvas-poster') return route.fallback()
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
    const marked = edit.mode === '主体消除'
    let markedFrameTime: number | undefined
    await app.open(
      marked
        ? async () => {
            const nodeVideo = app.sourceNode.locator('video')
            const nodeTrack = app.sourceNode.getByRole('slider', { name: '视频进度', exact: true })
            await expect
              .poll(() => nodeVideo.evaluate((video: HTMLVideoElement) => video.readyState))
              .toBeGreaterThanOrEqual(2)
            await nodeVideo.evaluate((video: HTMLVideoElement) => video.pause())
            await nodeTrack.press('Home')
            await nodeTrack.press('ArrowRight')
            await nodeTrack.press('ArrowRight')
            await expect
              .poll(() =>
                nodeVideo.evaluate(
                  (video: HTMLVideoElement) => !video.seeking && Math.abs(video.currentTime - 2) < 0.05,
                ),
              )
              .toBe(true)
          }
        : undefined,
    )
    await app.dialog.getByRole('button', { name: edit.mode, exact: true }).click()
    const submit = app.dialog.getByRole('button', { name: '开始处理', exact: true })
    const frame = app.dialog.locator('canvas[aria-label="视频帧涂抹区域"]')
    await expect(frame).toBeVisible()
    await expect(app.dialog.getByRole('button', { name: /^(重新)?估\s*价$/ })).toHaveCount(0)
    await expectVideoEstimate(app, {
      model_version_id: app.modelId,
      operation_code: app.operation,
      params: { duration, source_video_duration: duration },
      input_assets: [{ asset_id: videoAssetId, role: 'video' }],
    })
    await expect(submit).toBeDisabled()
    if (marked) {
      const original = app.dialog.getByLabel('原视频', { exact: true })
      const player = original.locator('..')
      const timeline = app.dialog.getByRole('slider', { name: '视频帧时间轴', exact: true })
      const clearMark = app.dialog.getByRole('button', { name: '清除标记', exact: true })
      const returnToMark = app.dialog.getByRole('button', { name: '返回标记帧', exact: true })
      const framePosition = app.dialog.getByText(/^已定位到 [\d.]+ 秒$/)
      const readFramePosition = async () => {
        const [label] = await framePosition.allTextContents()
        return Number(label?.match(/[\d.]+/)?.[0])
      }
      await expect(timeline).toBeEnabled()
      await expect(timeline).toHaveAttribute('max', String(duration))
      await expect.poll(readFramePosition).toBeCloseTo(2, 1)
      await expect(app.dialog.getByRole('button', { name: '标记当前帧', exact: true })).toHaveCount(0)
      await expect(clearMark).toHaveCount(0)
      await expect(returnToMark).toHaveCount(0)
      await expect(player).toHaveAttribute('aria-hidden', 'true')
      await expect(player).toHaveCSS('opacity', '0')
      await expect(app.dialog.getByRole('button', { name: '智能点选', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expect(app.dialog.getByRole('button', { name: '画笔', exact: true })).toBeEnabled()
      await expect(app.dialog.getByRole('button', { name: '橡皮', exact: true })).toBeEnabled()
      expect(referenceUploads).toBe(0)
      expect(app.submissions).toHaveLength(0)
      await page.screenshot({ path: testInfo.outputPath('video-auto-frame-and-estimate.png') })

      await timeline.fill('4')
      await expect.poll(readFramePosition).toBeCloseTo(4, 1)
      markedFrameTime = await readFramePosition()
      await expect(frame).toBeVisible()
      await app.dialog.getByRole('button', { name: '框选', exact: true }).click()
      await dragSelection(page, frame, [0.28, 0.28], [0.72, 0.72])
      await expect(returnToMark).toBeEnabled()
      await clearMark.click()
      await expect(returnToMark).toHaveCount(0)
      await expect(frame).toBeVisible()
      await expect(submit).toBeDisabled()
      await app.dialog.getByRole('button', { name: '框选', exact: true }).click()
      await dragSelection(page, frame, [0.28, 0.28], [0.72, 0.72])
      await app.dialog.getByRole('textbox', { name: '要处理的主体' }).fill(target)
      await app.dialog.getByRole('button', { name: '返回视频', exact: true }).click()
      await expect(frame).toBeHidden()
      await expect(original).toBeVisible()
      await expect(player).toHaveAttribute('aria-hidden', 'false')
      await expect(player).toHaveCSS('opacity', '1')
      await expect(returnToMark).toBeEnabled()
      await page.screenshot({ path: testInfo.outputPath('video-timeline-mark.png') })

      const controls = app.dialog.getByRole('group', { name: '原视频播放控制' })
      const volume = controls.getByRole('slider', { name: '原视频音量' })
      await expect.poll(() => original.evaluate((video: HTMLVideoElement) => video.controls)).toBe(false)
      await controls.getByRole('button', { name: /^静\s*音$/ }).click()
      await expect.poll(() => original.evaluate((video: HTMLVideoElement) => video.muted)).toBe(true)
      await expect(volume).toHaveValue('0')
      await controls.getByRole('button', { name: '开启声音', exact: true }).click()
      await expect.poll(() => original.evaluate((video: HTMLVideoElement) => video.muted)).toBe(false)
      await volume.fill('0.4')
      await expect.poll(() => original.evaluate((video: HTMLVideoElement) => video.volume)).toBeCloseTo(0.4)
      await timeline.fill('0')
      await expect.poll(() => original.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeLessThan(0.05)
      await controls.getByRole('button', { name: '播放视频' }).press('Space')
      await expect(controls.getByRole('button', { name: '暂停视频' })).toBeVisible()
      await expect.poll(() => original.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.15)
      await controls.getByRole('button', { name: '暂停视频' }).click()
      await expect.poll(() => original.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
      await timeline.fill('0')
      // WebKit 会停在 MP4 最早的可播放采样，时间戳可能比 0 晚一帧。
      await expect
        .poll(() =>
          original.evaluate(
            (video: HTMLVideoElement) => video.currentTime < 0.05 && !video.seeking && video.readyState >= 2,
          ),
        )
        .toBe(true)
      await page.screenshot({ path: testInfo.outputPath('video-playback-controls.png') })

      await returnToMark.click()
      await expect(frame).toBeVisible()
      await expect(player).toHaveAttribute('aria-hidden', 'true')
      await expect(player).toHaveCSS('opacity', '0')
      await expect(app.dialog.getByRole('button', { name: '预览抠图', exact: true })).toBeEnabled()
      await page.screenshot({ path: testInfo.outputPath('video-frame-selection.png') })
    } else if (edit.mode === '主体修改') {
      await app.dialog.getByRole('textbox', { name: '要处理的主体' }).fill(target)
      await expect(submit).toBeDisabled()
      await app.dialog.getByRole('textbox', { name: edit.field }).fill(edit.description)
    } else {
      await app.dialog.getByRole('textbox', { name: '要处理的主体' }).fill(target)
      await expect(submit).toBeDisabled()
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
      await expectVideoEstimate(app, {
        input_assets: [
          { asset_id: videoAssetId, role: 'video' },
          { asset_id: replacement.id, role: 'image' },
        ],
      })
      await page.screenshot({ path: testInfo.outputPath('video-replacement-image.png') })
    }
    await expect(submit).toBeEnabled()
    const submissionsBeforeSubmit = app.submissions.length
    const estimatesBeforeSubmit = app.estimates.length
    if (marked) {
      expect(referenceUploads).toBe(0)
      await page.screenshot({ path: testInfo.outputPath('video-removal-quoted.png') })
    }
    await submit.click()
    await expect(app.dialog).toBeHidden()
    await expect.poll(() => app.submissions.length).toBe(submissionsBeforeSubmit + 1)
    expect(app.estimates.length).toBeGreaterThan(estimatesBeforeSubmit)
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
      const submittedFrameTime = Number(String(request.prompt).match(/原视频第\s*([\d.]+)\s*秒/)?.[1])
      expect(submittedFrameTime).toBeCloseTo(markedFrameTime!, 2)
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

test('视频自动估价失败后可重试，最终价格变化时等用户确认', async ({ page }, testInfo) => {
  const app = await setupSubjectEdit(page, 'video')
  await page.setViewportSize({ width: 390, height: 844 })
  const target = '去除道路中央的车辆'
  let failNextEstimate = true
  await page.route('**/api/v1/ai/tasks/estimate-cost', (route) => {
    const request = route.request().postDataJSON()
    if (failNextEstimate) {
      failNextEstimate = false
      app.estimates.push(request)
      return route.fulfill({ status: 503, json: { message: '测试估价暂不可用' } })
    }
    if (String(request.prompt).includes(target)) {
      app.estimates.push(request)
      return route.fulfill({ json: { estimated_cost: 12, balance: 9000, can_afford: true } })
    }
    return route.fallback()
  })
  await page.goto(`/canvas/${canvasId}`)
  await app.open()
  const { dialog } = app
  const retry = dialog.getByRole('button', { name: '重试估价', exact: true })
  const submit = dialog.getByRole('button', { name: '开始处理', exact: true })
  await expect(retry).toBeVisible()
  await expect(submit).toBeDisabled()
  await retry.click()
  await expectVideoEstimate(app, { model_version_id: app.modelId })
  await expect(dialog.getByText('预计消耗 10 积分', { exact: true })).toBeInViewport()
  await expect(dialog.getByLabel('视频帧涂抹区域', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('video-auto-frame-narrow.png') })
  await expect(retry).toHaveCount(0)
  await expect(submit).toBeDisabled()
  await dialog.getByRole('textbox', { name: '要处理的主体' }).fill(target)
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(dialog.getByText('预计消耗 12 积分', { exact: true })).toBeVisible()
  await expect(dialog.getByText('积分预估已更新，请确认后开始处理')).toBeVisible()
  expect(app.submissions).toHaveLength(0)
  await submit.click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => app.submissions.length).toBe(1)
  app.expectMatchingEstimate(app.submissions[0])
  expect(app.pageErrors).toEqual([])
  expectNoUnexpectedApi(app.api)
})

test('图片涂抹消除提交同尺寸蒙版并保留原图', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const app = await setupSubjectEdit(page, 'image')
  await mockSubjectImageDownloads(page)
  const maskUploads = await mockSubjectMaskUpload(page)
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
  await page.goto(`/canvas/${canvasId}`)
  await app.open()
  const modify = app.dialog.getByRole('textbox', { name: '修改说明' })
  const replace = app.dialog.getByRole('textbox', { name: '替换说明' })
  await app.dialog.getByRole('button', { name: '主体修改', exact: true }).click()
  await expect(modify).toBeEditable()
  await expect(app.dialog.getByRole('button', { name: '添加目标参考图', exact: true })).toHaveCount(0)
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
  expect(maskUploads()).toBe(1)
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

test('图片主体修改允许不用目标图，并按模型提交蒙版或选区指令', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const app = await setupSubjectEdit(page, 'image', {
    extraModels: [openAiSubjectModel, seedreamSubjectModel],
    materials: [targetImageAsset],
  })
  await mockSubjectImageDownloads(page)
  const maskUploads = await mockSubjectMaskUpload(page)
  await page.goto(`/canvas/${canvasId}`)
  const { dialog } = app
  const modify = dialog.getByRole('button', { name: '主体修改', exact: true })
  const addTarget = dialog.getByRole('button', { name: '添加目标参考图', exact: true })
  const quote = dialog.getByRole('button', { name: /^估\s*价$/ })
  const submit = dialog.getByRole('button', { name: '开始处理', exact: true })
  const description = '把框中的红色主体改成蓝色'
  const markSubject = async () => {
    await dialog.getByRole('textbox', { name: '修改说明' }).fill(description)
    const selection = dialog.locator('canvas[aria-label="图片涂抹区域"]')
    await expect(selection).toBeVisible()
    await dialog.getByRole('button', { name: '框选', exact: true }).click()
    await dragSelection(page, selection, [0.28, 0.32], [0.45, 0.69])
  }

  await app.open()
  await chooseEditModel(page, dialog, openAiSubjectModel)
  await expect(addTarget).toHaveCount(0)
  await modify.click()
  await expect(addTarget).toBeVisible()
  await markSubject()
  await quote.click()
  await expect(submit).toBeEnabled()
  const source = { asset_id: imageAssetId, role: 'reference_image' }
  const mask = { asset_id: maskAssetId, role: 'mask' }
  expect(app.estimates.at(-1)).toMatchObject({
    model_version_id: openAiSubjectModel.id,
    params: { mask_asset_id: maskAssetId },
    input_assets: [source, mask],
  })
  expect(maskUploads()).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('image-modify-without-target.png') })

  await addTargetReference(page, dialog)
  await expect(submit).toBeDisabled()
  await quote.click()
  await expect(submit).toBeEnabled()
  expect(app.estimates).toHaveLength(2)
  expect(app.estimates.at(-1)).toMatchObject({
    model_version_id: openAiSubjectModel.id,
    params: { mask_asset_id: maskAssetId },
    input_assets: [source, { asset_id: targetImageAssetId, role: 'reference_image' }, mask],
    prompt: expect.stringContaining('第2张图是修改后的外观参考'),
  })
  await page.screenshot({ path: testInfo.outputPath('image-modify-with-target.png') })
  await submit.click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => app.submissions.length).toBe(1)
  app.expectMatchingEstimate(app.submissions[0])
  await expect(app.result('主体修改').locator('img').first()).toHaveAttribute('src', /\/assets\/502\/download/)

  const previousMaskUploads = maskUploads()
  await app.open()
  await chooseEditModel(page, dialog, seedreamSubjectModel)
  await modify.click()
  await expect(addTarget).toBeVisible()
  await markSubject()
  await quote.click()
  await expect(submit).toBeEnabled()
  expect(app.estimates.at(-1)).toMatchObject({
    model_version_id: seedreamSubjectModel.id,
    input_assets: [source],
    prompt: expect.stringMatching(/<bbox>\d+ \d+ \d+ \d+<\/bbox>/),
  })
  expect(app.estimates.at(-1)?.prompt).toEqual(expect.stringContaining(description))
  expect(app.estimates.at(-1)?.params).not.toHaveProperty('mask_asset_id')
  expect(maskUploads()).toBe(previousMaskUploads)
  await page.screenshot({ path: testInfo.outputPath('image-modify-selection-prompt.png') })
  await submit.click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => app.submissions.length).toBe(2)
  app.expectMatchingEstimate(app.submissions[1])
  await expect(app.result('主体修改')).toHaveCount(2)
  expect(app.workspaceCatalogReads).toBeGreaterThan(0)
  expect(app.pageErrors).toEqual([])
  expectNoUnexpectedApi(app.api)
})

test('视频主体修改按模型开放目标参考图，且切换模式自动刷新估价', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const app = await setupSubjectEdit(page, 'video', {
    extraModels: [wanSubjectModel, sourceOnlyVideoModel],
    materials: [targetImageAsset],
  })
  await mockSubjectImageDownloads(page)

  await page.goto(`/canvas/${canvasId}`)
  await app.open()
  const { dialog } = app
  const modify = dialog.getByRole('button', { name: '主体修改', exact: true })
  const addTarget = dialog.getByRole('button', { name: '添加目标参考图', exact: true })
  const targetPreview = dialog.getByRole('img', { name: '目标参考图预览' })
  const description = dialog.getByRole('textbox', { name: '修改说明' })
  const submit = dialog.getByRole('button', { name: '开始处理', exact: true })
  const video = { asset_id: videoAssetId, role: 'video' }
  const target = '沿林间道路行驶的黑色车辆'
  const instructions = '将车身改成参考图中的蓝色，保留原车型'

  await chooseEditModel(page, dialog, sourceOnlyVideoModel)
  await modify.click()
  await expectVideoEstimate(app, { model_version_id: sourceOnlyVideoModel.id, input_assets: [video] })
  await expect(submit).toBeDisabled()
  await dialog.getByRole('textbox', { name: '要处理的主体' }).fill(target)
  await description.fill(instructions)
  await expect(addTarget).toHaveCount(0)
  await expect(submit).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('video-modify-model-without-reference.png') })

  await chooseEditModel(page, dialog, wanSubjectModel)
  await expect(addTarget).toBeVisible()
  await expectVideoEstimate(app, { model_version_id: wanSubjectModel.id, input_assets: [video] })
  await expect(submit).toBeEnabled()

  await addTargetReference(page, dialog)
  const expectedWithReference = {
    model_version_id: wanSubjectModel.id,
    operation_code: 'video.edit',
    params: { audio: true },
    input_assets: [video, { asset_id: targetImageAssetId, role: 'image' }],
  }
  await expectVideoEstimate(app, expectedWithReference)
  await expect(submit).toBeEnabled()
  await dialog.getByRole('button', { name: '主体消除', exact: true }).click()
  await expect(targetPreview).toHaveCount(0)
  await expect(addTarget).toHaveCount(0)
  await expectVideoEstimate(app, { model_version_id: wanSubjectModel.id, input_assets: [video] })
  await expect(submit).toBeEnabled()

  await modify.click()
  await expect(addTarget).toBeVisible()
  await expect(description).toHaveValue('')
  await expect(targetPreview).toHaveCount(0)
  await expect(submit).toBeDisabled()
  await description.fill(instructions)
  await addTargetReference(page, dialog)
  await expectVideoEstimate(app, expectedWithReference)
  await expect(submit).toBeEnabled()
  expect(app.submissions).toHaveLength(0)
  await page.screenshot({ path: testInfo.outputPath('video-modify-with-target.png') })
  await submit.click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => app.submissions.length).toBe(1)
  expect(app.submissions[0]).toMatchObject({
    ...expectedWithReference,
    prompt: expect.stringContaining('第1张参考图仅用于指定修改后的外观'),
  })
  app.expectMatchingEstimate(app.submissions[0])
  await expect(app.result('主体修改').locator('video')).toHaveAttribute('src', /\/assets\/602\/download/)
  expect(app.pageErrors).toEqual([])
  expectNoUnexpectedApi(app.api)
})

test('Seedance 2.5 在主体修改中按编辑模式估价，提交前审核目标图和原视频', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const app = await setupSubjectEdit(page, 'video', {
    extraModels: [seedanceSubjectModel],
    materials: [targetImageAsset],
  })
  await mockSubjectImageDownloads(page)
  const moderationChecks: number[] = []
  let isTargetApproved = false
  await page.route(/\/api\/v1\/assets\/(601|704)\/seedance-moderation\?/, (route) => {
    const url = new URL(route.request().url())
    const assetId = Number(url.pathname.split('/').at(-2))
    expect(route.request().method()).toBe('GET')
    expect(url.searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    moderationChecks.push(assetId)
    return route.fulfill({
      json: { data: { status: assetId === videoAssetId || isTargetApproved ? 'active' : 'rejected' } },
    })
  })
  await page.goto(`/canvas/${canvasId}`)
  await app.open()
  const { dialog } = app
  await chooseEditModel(page, dialog, seedanceSubjectModel)
  await dialog.getByRole('button', { name: '主体修改', exact: true }).click()
  await dialog.getByRole('textbox', { name: '要处理的主体' }).fill('沿林间道路行驶的黑色车辆')
  await dialog.getByRole('textbox', { name: '修改说明' }).fill('将车身改成参考图的蓝色，保留原车型')
  await addTargetReference(page, dialog)
  const submit = dialog.getByRole('button', { name: '开始处理', exact: true })
  await expectVideoEstimate(app, {
    model_version_id: seedanceSubjectModel.id,
    operation_code: 'video.generate',
    params: { mode: 'edit', duration, generate_audio: true, reference_mode: true },
    input_assets: [
      { asset_id: videoAssetId, role: 'video' },
      { asset_id: targetImageAssetId, role: 'image' },
    ],
  })
  await expect(submit).toBeEnabled()
  expect(app.estimates.at(-1)?.params).not.toHaveProperty('ratio')
  expect(moderationChecks).toHaveLength(0)

  await submit.click()
  await expect(dialog.getByText('未能提交主体编辑，请按提示检查素材后重试')).toBeVisible()
  await expect(submit).toBeEnabled()
  expect(moderationChecks).toContain(targetImageAssetId)
  expect(app.submissions).toHaveLength(0)
  await page.screenshot({ path: testInfo.outputPath('seedance-subject-moderation-blocked.png') })

  isTargetApproved = true
  moderationChecks.length = 0
  await submit.click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => app.submissions.length).toBe(1)
  expect(moderationChecks).toEqual(expect.arrayContaining([videoAssetId, targetImageAssetId]))
  app.expectMatchingEstimate(app.submissions[0])
  await expect(app.result('主体修改').locator('video')).toHaveAttribute('src', /\/assets\/602\/download/)
  await page.screenshot({ path: testInfo.outputPath('seedance-subject-edit-result.png') })
  expect(app.pageErrors).toEqual([])
  expectNoUnexpectedApi(app.api)
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
