import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('图片工具共用估价与任务接口，生成独立结果并保留原图', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const submissions: Array<Record<string, any>> = []
  const quotes: Array<Record<string, any>> = []
  const saved: Array<Record<string, any>> = []
  const tools = [
    {
      code: 'image.multi_angle',
      display_name: '多角度',
      version: 2,
      execution: 'prompt_workflow',
      operation_code: 'image.image_to_image',
      model_version_ids: [42],
      min_input_images: 1,
      max_input_images: 1,
      params_schema: {
        fields: [
          { name: 'horizontal_angle', display_name: '水平角', type: 'number', min: 0, max: 360, default: 0 },
          { name: 'vertical_angle', display_name: '俯仰角', type: 'number', min: -30, max: 60, default: 0 },
          { name: 'zoom', display_name: '远近', type: 'number', min: 0, max: 10, default: 5 },
        ],
      },
    },
    {
      code: 'image.relight',
      display_name: '打光',
      version: 1,
      execution: 'prompt_workflow',
      operation_code: 'image.image_to_image',
      model_version_ids: [42],
      params_schema: {
        fields: [
          {
            name: 'mode',
            display_name: '模式',
            type: 'select',
            options: ['manual', 'smart', 'reference'],
            default: 'manual',
          },
          {
            name: 'key_light',
            display_name: '主光',
            type: 'select',
            options: ['left', 'right', 'top', 'bottom', 'front', 'back'],
            default: 'left',
            visible_when: { mode: ['manual'] },
          },
          {
            name: 'brightness',
            display_name: '亮度',
            type: 'number',
            min: 0,
            max: 100,
            default: 65,
            visible_when: { mode: ['manual'] },
          },
        ],
      },
    },
    {
      code: 'image.panorama',
      display_name: '全景生成',
      version: 1,
      execution: 'prompt_workflow',
      operation_code: 'image.image_to_image',
      model_version_ids: [42],
      min_input_images: 1,
      max_input_images: 1,
      params_schema: { fields: [] },
    },
    {
      code: 'panorama.view',
      display_name: '全景浏览',
      version: 1,
      execution: 'browser',
      model_version_ids: [],
      params_schema: { fields: [] },
    },
  ]
  await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: tools } }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: 42,
            name: 'backend-image',
            display_name: '后端模型',
            capability: 'image',
            operation_codes: ['image.image_to_image'],
            params_schema: {
              fields: [{ name: 'count', display_name: '张数', type: 'integer', default: 1, min: 1, max: 6 }],
            },
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/120**', async (route) => {
    if (route.request().method() === 'PATCH') {
      saved.push(route.request().postDataJSON())
      await route.fulfill({ json: { revision: 2 } })
      return
    }
    await route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'image-source',
                kind: 'node',
                payload: {
                  id: 'image-source',
                  type: 'image',
                  position: { x: 300, y: 200 },
                  style: { width: 320, height: 240 },
                  data: { kind: 'image', assetId: 701, assetWorkspaceId: WORKSPACE_ID, title: '原图' },
                },
              },
              {
                element_id: 'other-image',
                kind: 'node',
                payload: {
                  id: 'other-image',
                  type: 'image',
                  position: { x: 800, y: 200 },
                  style: { width: 240, height: 200 },
                  data: { kind: 'image', assetId: 701, assetWorkspaceId: WORKSPACE_ID, title: '其他图片' },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 120, title: '图片工具验证', revision: 1 },
    })
  })
  await page.route('**/api/v1/assets?**', (route) =>
    route.fulfill({
      json: {
        items: [701, 502].map((id) => ({ id, workspace_id: WORKSPACE_ID, type: 'image', status: 'active' })),
        total: 2,
      },
    }),
  )
  await page.route('**/api/v1/ai/tasks/estimate-cost', async (route) => {
    quotes.push(route.request().postDataJSON())
    await route.fulfill({ json: { estimated_cost: 10, balance: 100, can_afford: true } })
  })
  await page.route(/\/api\/v1\/ai\/tasks(?:\?|$)/, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    submissions.push(route.request().postDataJSON())
    // 与创建接口的必填约束一致，不能像旧模拟接口一样接受空 prompt。
    if (!String(submissions.at(-1)?.prompt || '').trim()) {
      await route.fulfill({ status: 400, json: { code: 10001, message: '请求体格式不合法，请检查 JSON 结构' } })
      return
    }
    await route.fulfill({ status: 201, json: { id: 900 + submissions.length, status: 'queued', poll_after_ms: 1000 } })
  })
  await page.route(/\/api\/v1\/ai\/tasks\/9\d+\?/, (route) =>
    route.fulfill({
      json: {
        id: Number(new URL(route.request().url()).pathname.split('/').at(-1)),
        status: 'succeeded',
        poll_after_ms: 0,
        outputs: [{ asset_id: 502, type: 'image' }],
      },
    }),
  )
  await page.goto('/canvas/120')
  const source = page.locator('.react-flow__node[data-id="image-source"]')
  await expect(source).toBeVisible()
  await source.locator('.canvas-node-header').click()
  await page.getByRole('button', { name: '多角度', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByRole('spinbutton', { name: '水平角', exact: true })).toBeVisible()
  await modal.getByRole('spinbutton', { name: '水平角', exact: true }).fill('90')
  await expect(modal.getByRole('button', { name: '生成新图片' })).toBeEnabled()
  await modal.getByRole('button', { name: '背面视角', exact: true }).click()
  const angleControl = modal.getByRole('application', { name: '相机角度示意，拖动调整视角' })
  await angleControl.focus()
  await page.keyboard.press('ArrowRight')
  await expect(modal.getByRole('spinbutton', { name: '水平角', exact: true })).toHaveValue('185')
  await modal.getByRole('button', { name: '重置参数', exact: true }).click()
  await expect(modal.getByRole('spinbutton', { name: '水平角', exact: true })).toHaveValue('0')
  await page.screenshot({ path: 'artifacts/canvas-multi-angle.png' })
  await modal.getByRole('button', { name: 'Close', exact: true }).click()
  await source.locator('.canvas-node-header').click()
  await page.getByRole('button', { name: '打光', exact: true }).click()
  await expect(modal.getByRole('spinbutton', { name: '亮度', exact: true })).toBeVisible()
  await page.locator('.react-flow__node[data-id="other-image"] .canvas-node-header').click()
  await expect(modal).not.toBeVisible()
  await expect(page.locator('.canvas-panel-area')).toBeVisible()
  const editorBox = await page.locator('.canvas-panel-area').boundingBox()
  expect(editorBox?.x).toBeGreaterThanOrEqual(0)
  await source.locator('.canvas-node-header').click()
  await page.getByRole('button', { name: '打光', exact: true }).click()
  await expect(modal.getByRole('spinbutton', { name: '亮度', exact: true })).toBeVisible()
  await expect(page.locator('.canvas-panel-area')).toHaveCount(0)
  await expect
    .poll(async () => {
      const image = await source.boundingBox()
      const editor = await modal.boundingBox()
      if (!image || !editor) return 999
      return Math.abs(editor.y - image.y - image.height - 12)
    })
    .toBeLessThan(3)
  const light = modal.getByRole('application', { name: '灯位方向示意，拖动调整灯位' })
  await light.focus()
  await light.press('ArrowRight')
  await expect(modal.getByText('高级设置', { exact: true })).toHaveCount(0)
  expect(submissions).toHaveLength(0)
  await expect(modal.getByRole('button', { name: '生成新图片' })).toBeEnabled()
  await page.screenshot({ path: 'artifacts/canvas-relight.png' })
  await modal.getByRole('button', { name: '生成新图片' }).click()
  await expect(modal).not.toBeVisible()
  expect(submissions[0].prompt).toContain('275°')
  expect(submissions[0].params.tool_params).toEqual({ mode: 'manual', key_light: 'left', brightness: 65 })
  await source.locator('.canvas-node-header').click()
  await page.getByRole('button', { name: '全景', exact: true }).click()
  await expect(modal.getByRole('button', { name: '生成新图片' })).toBeEnabled()
  await modal.getByRole('button', { name: '生成新图片' }).click()
  await expect(modal).not.toBeVisible()
  await expect.poll(() => submissions.length).toBe(2)
  expect(submissions[1]).toMatchObject({
    workspace_id: WORKSPACE_ID,
    model_version_id: 42,
    operation_code: 'image.image_to_image',
    params: { count: 1, tool: 'image.panorama', tool_version: 1, tool_params: {} },
    input_assets: [{ asset_id: 701, role: 'reference_image' }],
  })
  expect(submissions[1].idempotency_key).toBeTruthy()
  expect(submissions[1].prompt).toContain('左右边缘无缝衔接')
  expect(quotes.at(-1)?.params).toEqual(submissions[1].params)
  await expect(
    page.locator('.react-flow__node').filter({ hasText: '全景生成结果' }).locator('img').first(),
  ).toHaveAttribute('src', /\/assets\/502\/download/)
  await expect(source.locator('img').first()).toHaveAttribute('src', /\/assets\/701\/download/)
  await expect.poll(() => JSON.stringify(saved)).toContain('"tool":"image.panorama"')
  expectNoUnexpectedApi(api)
})

test('全景浏览不创建 AI 任务，取景上传为独立图片并保存视角', async ({ page }) => {
  test.setTimeout(90000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const saved: Array<Record<string, any>> = []
  let uploads = 0
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 512
    const context = canvas.getContext('2d')!
    const gradient = context.createLinearGradient(0, 0, 1024, 512)
    gradient.addColorStop(0, '#95cbea')
    gradient.addColorStop(1, '#1b6c50')
    context.fillStyle = gradient
    context.fillRect(0, 0, 1024, 512)
    return canvas.toDataURL().split(',')[1]
  })
  await page.route('**/api/v1/assets/701/download?**', (route) =>
    route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }),
  )
  await page.route('**/api/v1/assets/702/download?**', (route) =>
    route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }),
  )
  await page.route('**/api/v1/ai/tools?**', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            code: 'panorama.view',
            display_name: '全景浏览',
            execution: 'browser',
            model_version_ids: [],
            version: 1,
            params_schema: { fields: [] },
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/120**', async (route) => {
    if (route.request().method() === 'PATCH') {
      saved.push(route.request().postDataJSON())
      await route.fulfill({ json: { revision: 2 } })
      return
    }
    await route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'panorama-source',
                kind: 'node',
                payload: {
                  id: 'panorama-source',
                  type: 'image',
                  position: { x: 300, y: 200 },
                  style: { width: 400, height: 200 },
                  data: { kind: 'image', assetId: 701, assetWorkspaceId: WORKSPACE_ID, title: '全景原图' },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 120, title: '全景取景验证', revision: 1 },
    })
  })
  await page.route('**/api/v1/assets', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    uploads += 1
    expect(route.request().postDataJSON()).toMatchObject({
      workspace_id: WORKSPACE_ID,
      type: 'image',
      source: 'canvas-capture',
      mime_type: 'image/png',
    })
    await route.fulfill({
      json: {
        asset: { id: 702 },
        upload: { url: 'https://canvas-test.oss-cn-beijing.aliyuncs.com/upload', form_fields: {} },
      },
    })
  })
  await page.route('https://canvas-test.oss-cn-beijing.aliyuncs.com/upload', async (route) => {
    const body = route.request().postDataBuffer()!
    const start = body.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(start).toBeGreaterThanOrEqual(0)
    expect(body.readUInt32BE(start + 16)).toBe(1080)
    expect(body.readUInt32BE(start + 20)).toBe(1920)
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.route('**/api/v1/assets/702/complete?**', (route) =>
    route.fulfill({ json: { id: 702, status: 'active' } }),
  )
  await page.goto('/canvas/120')
  const source = page.locator('.react-flow__node[data-id="panorama-source"]')
  await source.locator('.canvas-node-header').click()
  await page.getByRole('button', { name: '全景', exact: true }).click()
  const modal = page.getByRole('dialog')

  await modal.getByRole('button', { name: '浏览已有全景图' }).click()
  await modal.getByRole('spinbutton', { name: '水平视角', exact: true }).fill('90')
  await expect(modal.getByRole('button', { name: '当前视角截图' })).toBeEnabled()
  await modal.getByRole('button', { name: '大屏预览' }).click()
  await expect(modal.getByRole('button', { name: '退出大屏' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal).toBeVisible()
  await expect(modal.getByRole('button', { name: '大屏预览' })).toBeVisible()
  await modal.getByLabel('构图参考线').selectOption('thirds')
  await modal.getByRole('button', { name: '4视角截图', exact: true }).click()
  await expect(modal.getByRole('img', { name: /^视角 / })).toHaveCount(4)
  await modal.getByRole('button', { name: '12视角截图', exact: true }).click()
  await expect(modal.getByRole('img', { name: /^视角 / })).toHaveCount(12, { timeout: 45000 })
  expect(uploads).toBe(0)
  await modal.getByLabel('取景画幅').selectOption('1080x1920')
  await page.screenshot({ path: 'artifacts/canvas-panorama-view.png' })
  await modal.getByRole('button', { name: '当前视角截图' }).click()
  await modal.getByRole('button', { name: '将选中截图加入画布' }).click()
  await expect.poll(() => uploads).toBe(1)
  await expect(
    page.locator('.react-flow__node').filter({ hasText: '全景取景' }).locator('img').first(),
  ).toHaveAttribute('src', /\/assets\/702\/download/)
  await expect.poll(() => JSON.stringify(saved)).toContain('"panoramaView":{"yaw":90')
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
