import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  installStrictAuthenticatedApp,
  expectNoUnexpectedApi,
  waitForScopedApiResponse,
  WORKSPACE_ID,
} from './fixtures/strict-authenticated-app'

for (const renamed of [false, true]) {
  test(`图片工具独立操作码${renamed ? '后台重命名' : '默认配置'}：模型隔离、估价、生成和保存`, async ({
    page,
  }, testInfo) => {
    // 同一场景覆盖三种工具、三次生成及多个视口截图，保留每个交互的独立等待断言。
    test.setTimeout(90_000)
    const operations = renamed
      ? ['studio.camera.rotate', 'studio.lighting.adjust', 'studio.scene.sphere']
      : ['image.multi_angle', 'image.relight', 'image.panorama']
    const modelQueries: string[] = []
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('requestfailed', (request) => failedRequests.push(new URL(request.url()).pathname))
    page.on('pageerror', (error) => pageErrors.push(error.message))

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
        operation_code: operations[0],
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
        operation_code: operations[1],
        model_version_ids: [43],
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
            {
              name: 'color',
              display_name: '灯光颜色',
              type: 'string',
              default: '',
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
        operation_code: operations[2],
        model_version_ids: [44],
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
    await page.route('**/api/v1/ai/models**', (route) => {
      const operation = new URL(route.request().url()).searchParams.get('operation_code') || ''
      modelQueries.push(operation)
      const index = operations.indexOf(operation)
      return route.fulfill({
        json: {
          data:
            index < 0
              ? []
              : [
                  {
                    id: 42 + index,
                    name: `backend-tool-${index}`,
                    display_name: ['多角度专用模型', '打光专用模型', '全景专用模型'][index],
                    capability: 'image',
                    operation_codes: [operation],
                    params_schema: {
                      fields: [
                        { name: 'count', display_name: '张数', type: 'integer', default: 1, min: 1, max: 6 },
                        ...(index === 0
                          ? [{ name: 'negative_prompt', display_name: '反向提示词', type: 'string', max_length: 500 }]
                          : []),
                        ...(index === 1 && renamed
                          ? [
                              {
                                name: 'size',
                                display_name: '输出尺寸',
                                type: 'select',
                                options: ['1024x1536', '2048x3072'],
                                default: '1024x1536',
                              },
                              {
                                name: 'quality',
                                display_name: '输出质量',
                                type: 'select',
                                options: ['standard', 'high'],
                                default: 'standard',
                              },
                            ]
                          : []),
                      ],
                    },
                  },
                ],
        },
      })
    })
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
      const body = route.request().postDataJSON()
      quotes.push(body)
      // 真实模型48：同角度短描述成功，旧版长描述被后端模板拼接长度校验拒绝。
      if (body.operation_code === operations[0] && Array.from(String(body.prompt || '')).length > 230) {
        await route.fulfill({
          status: 400,
          json: { code: 10001, code_string: 'INVALID_MODEL_PARAMS', message: '模型参数无效，请检查参数后重试。' },
        })
        return
      }
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
      await route.fulfill({
        status: 201,
        json: { id: 900 + submissions.length, status: 'queued', poll_after_ms: 1000 },
      })
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
    const ready = waitForScopedApiResponse(page, {
      method: 'GET',
      path: '/api/v1/canvases/120/elements',
      workspaceId: WORKSPACE_ID,
    })
    await page.goto('/canvas/120')
    await ready
    const source = page.locator('.react-flow__node[data-id="image-source"]')
    await expect(source).toBeVisible({ timeout: 30000 })
    await source.locator('.canvas-node-header').click()
    await page.getByRole('button', { name: '多角度', exact: true }).click()
    const modal = page.getByRole('dialog')
    await expect(page.getByRole('toolbar', { name: '节点操作', exact: true })).toHaveCount(0)
    await modal.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('toolbar', { name: '节点操作', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '多角度', exact: true }).click()
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
    await page.screenshot({ path: testInfo.outputPath('multi-angle.png') })
    // 浏览器指针的连续位移会产生小数，显示值和估价正文必须保持整度一致。
    const globe = await angleControl.boundingBox()
    expect(globe).not.toBeNull()
    await angleControl.evaluate((element) => {
      element.addEventListener(
        'pointerdown',
        (event) => {
          const pointer = event as PointerEvent
          element.setAttribute('data-test-drag-start', JSON.stringify({ x: pointer.clientX, y: pointer.clientY }))
        },
        { once: true },
      )
      element.addEventListener('pointermove', (event) => {
        const pointer = event as PointerEvent
        element.setAttribute('data-test-drag-end', JSON.stringify({ x: pointer.clientX, y: pointer.clientY }))
      })
    })
    await page.mouse.move(globe!.x + globe!.width / 2, globe!.y + globe!.height / 2)
    await page.mouse.down()
    await page.mouse.move(globe!.x + globe!.width / 2 + 67.85, globe!.y + globe!.height / 2 - 56.25)
    await page.mouse.up()
    const drag = await angleControl.evaluate((element) => ({
      start: JSON.parse(element.getAttribute('data-test-drag-start')!),
      end: JSON.parse(element.getAttribute('data-test-drag-end')!),
    }))
    const expectedYaw = Math.round((drag.end.x - drag.start.x) * 0.8)
    const expectedPitch = Math.round((drag.start.y - drag.end.y) * 0.5)
    await expect(modal.getByRole('spinbutton', { name: '水平角', exact: true })).toHaveValue(String(expectedYaw))
    await expect(modal.getByRole('spinbutton', { name: '俯仰角', exact: true })).toHaveValue(String(expectedPitch))
    await expect
      .poll(() =>
        quotes.some(
          (quote) =>
            quote.params?.tool_params?.horizontal_angle === expectedYaw &&
            quote.params?.tool_params?.vertical_angle === expectedPitch,
        ),
      )
      .toBe(true)
    await page.screenshot({ path: testInfo.outputPath('multi-angle-drag.png') })
    await modal.getByRole('spinbutton', { name: '远近', exact: true }).fill('10')
    await expect
      .poll(() =>
        quotes.some(
          (quote) =>
            quote.params?.tool_params?.zoom === 10 &&
            String(quote.prompt).includes('极度特写镜头，广角镜头，边缘带有鱼眼畸变效果') &&
            !String(quote.prompt).includes('或鱼眼变形'),
        ),
      )
      .toBe(true)
    await page.screenshot({ path: testInfo.outputPath('multi-angle-fisheye.png') })
    await modal.getByRole('button', { name: '背面视角', exact: true }).click()
    await modal.getByText('场景约束与提示词', { exact: true }).click()
    await expect(
      modal.getByText('背面视角下瓶身与包装盒分别转到背面，背标和条码朝向镜头；保留所有配件。'),
    ).toBeVisible()
    const sceneInput = modal.getByRole('textbox', { name: '多角度补充场景信息' })
    await sceneInput.fill('红衣女子站在窗边，桌上有白杯')
    const promptPreview = modal.getByLabel('多角度生成提示词')
    await expect(promptPreview).toContainText('保持参考图全部物件的设计、标识、比例和场景')
    await expect(promptPreview).toContainText('红衣女子站在窗边，桌上有白杯')
    await modal.getByRole('button', { name: '正面仰拍', exact: true }).click()
    await expect(sceneInput).toHaveValue('红衣女子站在窗边，桌上有白杯')
    await expect(promptPreview).toContainText('仰拍20°')
    await modal.getByRole('button', { name: '背面视角', exact: true }).click()
    await page.setViewportSize({ width: 760, height: 1000 })
    await sceneInput.scrollIntoViewIfNeeded()
    await expect(sceneInput).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('multi-angle-scene-760.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(modal.getByRole('button', { name: '生成新图片' })).toBeEnabled()
    await modal.getByRole('button', { name: '生成新图片' }).click()
    await expect(modal).not.toBeVisible()
    expect(submissions[0]).toMatchObject({ operation_code: operations[0], model_version_id: 42 })
    expect(submissions[0].params.tool_version).toBe(2)
    expect(
      quotes
        .filter((quote) => quote.operation_code === operations[0])
        .every((quote) => quote.params.tool_version === 2),
    ).toBe(true)
    expect(submissions[0].params.tool_params).toMatchObject({ horizontal_angle: 180, vertical_angle: 0, zoom: 5 })
    expect(submissions[0].prompt).toContain('水平环绕180°')
    expect(submissions[0].prompt).toContain('正后方背面机位')
    expect(submissions[0].prompt).toContain('各绕竖直轴原地旋转180°，各自背面朝镜头')
    expect(submissions[0].prompt).toContain('正面主标不可见，包装背标或条码朝镜头')
    expect(submissions[0].params.negative_prompt).toContain('正面主标可见')
    expect(submissions[0].params.negative_prompt).toContain('商品包装缺失')
    expect(submissions[0].prompt).toContain('无人物参考不得新增人物')
    expect(submissions[0].prompt).toContain('红衣女子站在窗边，桌上有白杯')
    expect(quotes.some((quote) => quote.prompt === submissions[0].prompt)).toBe(true)
    expect(submissions[0].prompt).toContain('平视0°，中景')
    expect(Array.from(submissions[0].prompt).length).toBeLessThanOrEqual(200)
    await source.locator('.canvas-node-header').click()
    await page.getByRole('button', { name: '打光', exact: true }).click()
    await expect(page.getByRole('toolbar', { name: '节点操作', exact: true })).toHaveCount(0)
    await expect(modal.getByRole('spinbutton', { name: '亮度', exact: true })).toBeVisible()
    for (const width of [1440, 760]) {
      await page.setViewportSize({ width, height: 1000 })
      const modes = ['手动布光', '智能补光', '参考图布光'].map((name) =>
        modal.getByRole('button', { name, exact: true }),
      )
      await expect(async () => {
        const boxes = await Promise.all(modes.map((button) => button.boundingBox()))
        for (let index = 0; index < boxes.length; index++) {
          expect(boxes[index]).not.toBeNull()
          expect(Math.abs(boxes[index]!.y - boxes[0]!.y)).toBeLessThan(2)
          expect(boxes[index]!.x).toBeGreaterThanOrEqual(0)
          expect(boxes[index]!.x + boxes[index]!.width).toBeLessThanOrEqual(width)
          if (index > 0) expect(boxes[index]!.x).toBeGreaterThan(boxes[index - 1]!.x)
        }
      }).toPass()
      await modes[1].click()
      await expect(modes[1]).toHaveAttribute('aria-pressed', 'true')
      await expect(modal.getByRole('spinbutton', { name: '亮度', exact: true })).toHaveCount(0)
      await modes[0].click()
      await expect(modal.getByRole('spinbutton', { name: '亮度', exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`relight-horizontal-${width}.png`) })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
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
    await expect(modal.getByText('输出尺寸', { exact: true })).toHaveCount(0)
    await expect(modal.getByRole('combobox', { name: '输出尺寸' })).toHaveCount(0)
    await modal.getByRole('textbox', { name: '灯光颜色', exact: true }).fill('#00ff00')
    if (renamed) {
      await modal.getByRole('combobox', { name: '输出质量' }).focus()
      await modal.getByRole('combobox', { name: '输出质量' }).press('ArrowDown')
      await page.locator('.ant-select-item-option').filter({ hasText: 'high' }).click()
    } else {
      await expect(modal.getByRole('combobox', { name: '输出尺寸' })).toHaveCount(0)
      await expect(modal.getByRole('combobox', { name: '输出质量' })).toHaveCount(0)
    }
    await light.focus()
    await light.press('ArrowRight')
    await expect(modal.getByText('高级设置', { exact: true })).toHaveCount(0)
    expect(submissions).toHaveLength(1)
    await expect(modal.getByRole('button', { name: '生成新图片' })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('relight.png') })
    await modal.getByRole('button', { name: '生成新图片' }).click()
    await expect(modal).not.toBeVisible()
    expect(submissions[1].prompt).toContain('275°')
    expect(submissions[1].prompt).toContain('保留已有光源的方向、颜色和光照效果')
    expect(submissions[1].prompt).toContain('新增光源颜色为#00ff00')
    expect(submissions[1].prompt).toContain('不要把整张图片染成该颜色')
    expect(submissions[1].input_assets).toEqual([{ asset_id: 701, role: 'reference_image' }])
    expect(submissions[1].params.tool_params).toEqual({
      mode: 'manual',
      key_light: 'left',
      brightness: 65,
      color: '#00ff00',
    })
    expect(submissions[1].params).not.toHaveProperty('size')
    if (renamed) expect(submissions[1].params).toMatchObject({ quality: 'high' })
    else {
      expect(submissions[1].params).not.toHaveProperty('size')
      expect(submissions[1].params).not.toHaveProperty('quality')
    }
    expect(quotes.at(-1)?.params).toEqual(submissions[1].params)
    await source.locator('.canvas-node-header').click()
    await page.getByRole('button', { name: '全景', exact: true }).click()
    await expect(page.getByRole('toolbar', { name: '节点操作', exact: true })).toHaveCount(0)
    await expect(modal.getByRole('button', { name: '生成新图片' })).toBeEnabled()
    const panoramaSource = modal.getByRole('img', { name: '全景生成参考图' })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(panoramaSource).toBeVisible()
      await expect
        .poll(async () =>
          panoramaSource.evaluate((image) => {
            const media = image.getBoundingClientRect()
            const dialog = image.closest('[role="dialog"]')!.getBoundingClientRect()
            return media.width <= dialog.width && media.right <= dialog.right && media.height <= 240
          }),
        )
        .toBe(true)
      expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      await modal.getByRole('button', { name: '生成新图片' }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`panorama-generation-${width}.png`) })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await modal.getByRole('button', { name: '生成新图片' }).click()
    await expect(modal).not.toBeVisible()
    await expect.poll(() => submissions.length).toBe(3)
    expect(submissions[2]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      model_version_id: 44,
      operation_code: operations[2],
      params: { count: 1, tool: 'image.panorama', tool_params: {} },
      input_assets: [{ asset_id: 701, role: 'reference_image' }],
    })
    expect(submissions[2].idempotency_key).toBeTruthy()
    expect(submissions[2].prompt).toContain('左右边缘无缝衔接')
    expect(quotes.at(-1)?.params).toEqual(submissions[2].params)
    await expect(
      page.locator('.react-flow__node').filter({ hasText: '全景生成结果' }).locator('img').first(),
    ).toHaveAttribute('src', /\/assets\/502\/download/)
    await expect(source.locator('img').first()).toHaveAttribute('src', /\/assets\/701\/download/)
    await expect.poll(() => JSON.stringify(saved)).toContain('"tool":"image.panorama"')
    for (let index = 0; index < operations.length; index += 1) {
      expect(modelQueries).toContain(operations[index])
      expect(submissions[index]).toMatchObject({ operation_code: operations[index], model_version_id: 42 + index })
      expect(
        quotes.some((quote) => quote.operation_code === operations[index] && quote.model_version_id === 42 + index),
      ).toBeTruthy()
      await expect.poll(() => JSON.stringify(saved)).toContain(`"operationCode":"${operations[index]}"`)
    }
    expect(pageErrors).toEqual([])
    await testInfo.attach('browser-checks', {
      body: JSON.stringify({ consoleErrors, failedRequests, modelQueries }, null, 2),
      contentType: 'application/json',
    })
    expect(consoleErrors).toEqual([])
    expect(failedRequests).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('tool-results.png') })
    expectNoUnexpectedApi(api)
  })
}

test('全景浏览不创建 AI 任务，取景上传为独立图片并保存视角', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  test.setTimeout(90000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const saved: Array<Record<string, any>> = []
  let uploads = 0
  let uploadedPng: Buffer | null = null
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
    route.fulfill({ contentType: 'image/png', body: uploadedPng || Buffer.from(png, 'base64') }),
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
    // WebKit 的网络协议可能省略 multipart 文件字节；从实际传给 fetch 的 File 读取，仍校验真实上传内容。
    const bytes = await page.evaluate(() => (window as any).__panoramaUploadBytes as number[])
    expect(bytes).toBeDefined()
    const body = Buffer.from(bytes)
    const start = body.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(start).toBeGreaterThanOrEqual(0)
    const end = body.indexOf(Buffer.from('49454e44ae426082', 'hex'), start) + 8
    uploadedPng = body.subarray(start, end)
    expect(body.readUInt32BE(start + 16)).toBe(1080)
    expect(body.readUInt32BE(start + 20)).toBe(1920)
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.route('**/api/v1/assets/702/complete?**', (route) =>
    route.fulfill({ json: { id: 702, status: 'active' } }),
  )
  await page.addInitScript(() => {
    const fetch = window.fetch
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === 'https://canvas-test.oss-cn-beijing.aliyuncs.com/upload' && init?.body instanceof FormData) {
        let file: Blob | undefined
        init.body.forEach((value) => {
          if (!file && value instanceof Blob) file = value
        })
        if (file) (window as any).__panoramaUploadBytes = [...new Uint8Array(await file.arrayBuffer())]
      }
      return fetch(input, init)
    }
  })
  await page.goto('/canvas/120')
  const source = page.locator('.react-flow__node[data-id="panorama-source"]')
  await source.locator('.canvas-node-header').click()
  await page.getByRole('button', { name: '全景', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(page.getByRole('button', { name: '多角度', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '打光', exact: true })).toHaveCount(0)

  await expect(modal.getByRole('button', { name: '生成新图片' })).toHaveCount(0)
  await modal.getByRole('spinbutton', { name: '水平视角', exact: true }).fill('90')
  await expect(modal.getByRole('button', { name: '当前视角截图' })).toBeEnabled()
  await modal.getByRole('button', { name: '大屏预览' }).click()
  await expect(modal.getByRole('button', { name: '退出大屏' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal).toBeVisible()
  await expect(modal.getByRole('button', { name: '大屏预览' })).toBeVisible()
  await modal.getByLabel('构图参考线').selectOption('thirds')
  await expect(modal.getByLabel('全景截图工作台')).toContainText('俯视、平视、仰视各 4 张')
  await modal.getByRole('button', { name: '4视角截图', exact: true }).click()
  await expect(modal.getByRole('img', { name: /^视角 / })).toHaveCount(4)
  await modal.getByRole('button', { name: '12视角截图', exact: true }).click()
  await expect(modal.getByRole('img', { name: /^视角 / })).toHaveCount(16, { timeout: 45000 })
  const collection = modal.getByRole('region', { name: '截图预览' })
  await expect(collection).toContainText('共 16 张 · 已选 16 张')
  await expect(collection).toContainText('水平 90° · 俯仰 -35°')
  await expect(collection).toContainText('水平 90° · 俯仰 35°')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  expect(uploads).toBe(0)
  await collection.getByRole('button', { name: '取消全选' }).click()
  await expect(collection).toContainText('已选 0 张')
  await expect(collection.getByRole('button', { name: '将选中截图加入画布' })).toBeDisabled()
  await collection.getByRole('button', { name: '全选未添加截图' }).click()
  await expect(collection).toContainText('已选 16 张')
  await collection.getByRole('button', { name: '取消全选' }).click()
  await modal.getByLabel('取景画幅').selectOption('1080x1920')
  await page.screenshot({ path: testInfo.outputPath('panorama-view.png') })
  await modal.getByRole('button', { name: '当前视角截图' }).click()
  await expect(collection.getByRole('img', { name: /^视角 / })).toHaveCount(17)
  await expect(collection).toContainText('共 17 张 · 已选 1 张')
  expect(uploads).toBe(0)
  await collection.screenshot({ path: testInfo.outputPath('panorama-capture-collection.png') })
  await modal.getByRole('button', { name: '将选中截图加入画布' }).click()
  await expect.poll(() => uploads, { timeout: 30_000 }).toBe(1)
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect(collection.getByRole('button', { name: '将选中截图加入画布' })).toBeDisabled()
  await expect(
    page.locator('.react-flow__node').filter({ hasText: '全景取景' }).locator('img').first(),
  ).toHaveAttribute('src', /\/assets\/702\/download/)
  await expect.poll(() => JSON.stringify(saved)).toContain('"panoramaView":{"yaw":90')
  await page.setViewportSize({ width: 768, height: 1000 })
  await expect(collection).toBeVisible()
  await expect(collection).toContainText('共 17 张 · 已选 0 张')
  await expect(collection.getByRole('button', { name: '将选中截图加入画布' })).toBeDisabled()
  await expect.poll(() => collection.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('panorama-capture-narrow.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await modal.getByRole('button', { name: '当前视角截图' }).click()
  await expect(collection.getByRole('img', { name: /^视角 / })).toHaveCount(18)
  await modal.getByRole('button', { name: '当前视角截图' }).click()
  await expect(collection.getByRole('img', { name: /^视角 / })).toHaveCount(19)
  await expect(collection).toContainText('已选 2 张')
  const downloadPromise = page.waitForEvent('download')
  await collection.getByRole('button', { name: '拼接下载选中截图' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('全景分镜拼图.png')
  const pngFile = await readFile((await download.path())!)
  expect(pngFile.readUInt32BE(16)).toBe(2160)
  expect(pngFile.readUInt32BE(20)).toBe(1920)
  expect(uploads).toBe(1)
  await collection.getByRole('button', { name: '将选中截图加入画布' }).click()
  // 两张 1080×1920 截图会串行上传至模拟 OSS；在 Windows Chromium 上各自可耗时约 10 秒。
  await expect.poll(() => uploads, { timeout: 30_000 }).toBe(3)
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  await expect(page.locator('.canvas-group-frame')).toContainText('全景分镜组')
  await expect.poll(() => JSON.stringify(saved)).toContain('"groupName":"全景分镜组"')
  const positions = await page.locator('.react-flow__node').evaluateAll((elements) =>
    elements.slice(-2).map((element) => ({
      x: (element as HTMLElement).style.transform,
    })),
  )
  expect(positions[0].x).not.toBe(positions[1].x)
  await expect
    .poll(async () => {
      const rects = await page.locator('.react-flow__node').evaluateAll((elements) =>
        elements.slice(-2).map((element) => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, right: rect.right }
        }),
      )
      return rects[0].right <= rects[1].left
    })
    .toBe(true)
  await modal.getByRole('button', { name: '返回图片预览', exact: true }).click()
  await page.getByRole('button', { name: '复位视图', exact: true }).click()
  await expect
    .poll(async () =>
      page.locator('.canvas-group-frame').evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
      }),
    )
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('panorama-grid-group.png') })
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
