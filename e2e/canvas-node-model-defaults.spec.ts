import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

const canvasId = 957
const imageOperation = 'image.text_to_image'
const videoOperation = 'video.generate'

function generationModel(
  id: number,
  name: string,
  operation: string,
  ratios: string[] | undefined,
  defaultRatio: string,
  ratioName = 'ratio',
) {
  return {
    id,
    display_name: name,
    operation_codes: [operation],
    params_schema: {
      fields: [
        { name: ratioName, type: ratios ? 'select' : 'string', options: ratios, default: defaultRatio },
        ...(operation === videoOperation ? [{ name: 'duration', options: [5, 10], default: 5 }] : []),
      ],
    },
  }
}

function videoNode(id: string, modelVersionId: number, x: number) {
  return {
    element_id: id,
    kind: 'node',
    payload: {
      id,
      type: 'video',
      position: { x, y: 120 },
      style: { width: 240, height: 200 },
      data: {
        kind: 'video',
        modelVersionId,
        operationCode: videoOperation,
        videoMode: 'full-ref',
        ratio: '4:3',
        params: { ratio: '4:3', duration: 10 },
        prompt: '保持镜头内人物和道具的位置',
        title: id,
      },
    },
  }
}

async function installModelCanvas(page: Page, elements: unknown[] = []) {
  const api = await installStrictAuthenticatedApp(page)
  const estimates: Record<string, unknown>[] = []
  await page.setViewportSize({ width: 1440, height: 940 })
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) => {
    const operation = new URL(route.request().url()).searchParams.get('operation_code')
    return route.fulfill({
      json: {
        data:
          operation === imageOperation
            ? [
                generationModel(41, '默认影像模型', imageOperation, ['1:1', '16:9'], '1:1'),
                generationModel(42, '仅方形模型', imageOperation, ['1:1'], '1:1'),
                generationModel(43, '开放比例图片模型', imageOperation, undefined, '1:1', 'aspect_ratio'),
                generationModel(
                  44,
                  '像素尺寸图片模型',
                  imageOperation,
                  ['1024x1024', '2048x1152'],
                  '1024x1024',
                  'size',
                ),
              ]
            : operation === videoOperation
              ? [
                  generationModel(53, 'Seedance 2.5 Flash', videoOperation, ['16:9', '9:16', '4:3'], '16:9'),
                  generationModel(54, '宽屏视频模型', videoOperation, ['16:9', '21:9'], '21:9'),
                  generationModel(55, '开放比例视频模型', videoOperation, undefined, '16:9', 'aspect_ratio'),
                ]
              : [],
      },
    })
  })
  await page.route('**/api/v1/ai/tasks/estimate-cost', (route) => {
    estimates.push(route.request().postDataJSON())
    return route.fulfill({ json: { estimated_cost: 10, balance: 9000, can_afford: true } })
  })
  let revision = 1
  await page.route(`**/api/v1/canvases/${canvasId}**`, (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: ++revision } })
    const url = new URL(route.request().url())
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: Number(url.searchParams.get('after_revision')) ? [] : elements,
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: canvasId, title: '模型默认值验证', revision },
    })
  })
  await page.route(`**/api/v1/canvases/${canvasId}/node-locks**`, (route) =>
    route.fulfill({ json: { granted: true, nodes: {} } }),
  )
  await page.goto(`/canvas/${canvasId}`)
  await expect(page.locator('.react-flow__pane')).toBeVisible()
  return { api, estimates }
}

async function openModelPicker(page: Page, trigger: Locator) {
  const bounds = await trigger.boundingBox()
  const viewport = page.viewportSize()
  if (!bounds || !viewport) throw new Error('模型选择器尚未定位')
  const controlBottom = bounds.y + bounds.height
  const shiftUp = controlBottom - (viewport.height - 175)
  if (shiftUp > 0) {
    // 选中节点保持视口位置，靠近底部时先手动平移来露出模型选择器。
    const start: [number, number] = [viewport.width - 110, viewport.height - 180]
    await page.mouse.move(...start)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(start[0], start[1] - shiftUp, { steps: 10 })
    await page.mouse.up({ button: 'middle' })
  }
  await trigger.click()
}

async function selectedCardRatio(page: Page, kind: 'image' | 'video') {
  const bounds = await page.locator(`.react-flow__node-${kind}.selected`).boundingBox()
  if (!bounds) throw new Error('没有找到选中的新节点')
  return bounds.width / bounds.height
}

test('新节点按类型选中默认比例，切换模型后仍优先使用默认比例', async ({ page }, testInfo) => {
  const { api, estimates } = await installModelCanvas(page)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const panel = page.locator('[data-canvas-node-panel]')
  const create = async (kind: '图片' | '视频') => {
    await page.getByRole('button', { name: '添加节点', exact: true }).click()
    await page
      .getByRole('menu', { name: '创建或添加节点' })
      .getByRole('menuitem', { name: new RegExp(`^${kind}节点`) })
      .click()
    await expect(panel).toBeVisible()
  }
  const chooseModel = async (name: string) => {
    await openModelPicker(page, panel.locator('[aria-haspopup="listbox"]'))
    await page
      .getByRole('listbox', { name: '生成模型列表' })
      .getByRole('option', { name: new RegExp(name) })
      .click()
  }
  await create('图片')
  await expect(panel.getByRole('button', { name: /^16:9/ })).toBeVisible()
  await expect.poll(() => selectedCardRatio(page, 'image')).toBeCloseTo(16 / 9, 2)
  await chooseModel('仅方形模型')
  await expect(panel.getByRole('button', { name: /^1:1/ })).toBeVisible()
  await chooseModel('开放比例图片模型')
  await expect(panel.getByRole('button', { name: /^16:9/ })).toBeVisible()
  await panel.getByRole('textbox').fill('海面上的灯塔')
  await expect.poll(() => estimates.at(-1)).toMatchObject({ model_version_id: 43, params: { aspect_ratio: '16:9' } })
  await page.screenshot({ path: testInfo.outputPath('image-landscape-default.png') })
  await chooseModel('像素尺寸图片模型')
  await expect(panel.getByRole('button', { name: /^2048x1152/ })).toBeVisible()
  await expect.poll(() => estimates.at(-1)).toMatchObject({ model_version_id: 44, params: { size: '2048x1152' } })
  await page.screenshot({ path: testInfo.outputPath('image-landscape-pixel-size-default.png') })

  await create('视频')
  await expect(panel.getByRole('button', { name: /全能参考.*9:16/ })).toBeVisible()
  await expect.poll(() => selectedCardRatio(page, 'video')).toBeCloseTo(9 / 16, 2)
  await chooseModel('宽屏视频模型')
  await expect(panel.getByRole('button', { name: /全能参考.*21:9/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('supported-ratio-fallback.png') })
  await chooseModel('开放比例视频模型')
  await expect(panel.getByRole('button', { name: /全能参考.*9:16/ })).toBeVisible()
  await panel.getByRole('textbox').fill('镜头从海面缓慢抬升到灯塔')
  await expect.poll(() => estimates.at(-1)).toMatchObject({ model_version_id: 55, params: { aspect_ratio: '9:16' } })
  await page.screenshot({ path: testInfo.outputPath('video-portrait-default.png') })
  expect(pageErrors).toEqual([])
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})

test('从文本节点创建视频时也默认选中竖屏比例', async ({ page }, testInfo) => {
  const text = '镜头沿着雨后的石板路向前移动。'
  const { api, estimates } = await installModelCanvas(page, [
    {
      element_id: 'story',
      kind: 'node',
      payload: {
        id: 'story',
        type: 'text',
        position: { x: 120, y: 120 },
        data: { kind: 'text', text },
      },
    },
  ])
  const panel = page.locator('[data-canvas-node-panel]')
  await page.locator('.react-flow__node[data-id="story"]').click()
  await panel.getByRole('button', { name: '创建视频节点' }).click()
  await expect(panel.getByRole('button', { name: /全能参考.*9:16/ })).toBeVisible()
  await expect.poll(() => selectedCardRatio(page, 'video')).toBeCloseTo(9 / 16, 2)
  await expect.poll(() => estimates.at(-1)).toMatchObject({ params: { ratio: '9:16' }, prompt: text })
  await page.screenshot({ path: testInfo.outputPath('text-to-video-portrait-default.png') })
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})

test('从已有视频拉出新节点时保留模型和时长，并选中竖屏比例', async ({ page }, testInfo) => {
  const { api, estimates } = await installModelCanvas(page, [videoNode('来源视频', 53, 120)])
  const source = page.locator('.react-flow__node[data-id="来源视频"]')
  await source.hover()
  const handle = source.locator('.canvas-handle-icon--right')
  await expect(handle).toBeVisible()
  const bounds = await handle.boundingBox()
  if (!bounds) throw new Error('没有找到来源视频的输出端点')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(980, 360, { steps: 12 })
  await page.mouse.up()
  await page
    .locator('.canvas-add-menu')
    .getByRole('button', { name: /^视频节点/ })
    .click()
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  const panel = page.locator('[data-canvas-node-panel]')
  await expect(panel.getByRole('button', { name: 'Seedance 2.5 Flash' })).toBeVisible()
  await expect(panel.getByRole('button', { name: /全能参考.*9:16.*10秒/ })).toBeVisible()
  await expect.poll(() => selectedCardRatio(page, 'video')).toBeCloseTo(9 / 16, 2)
  await expect
    .poll(() => estimates.at(-1))
    .toMatchObject({ model_version_id: 53, params: { ratio: '9:16', duration: 10 } })
  await page.screenshot({ path: testInfo.outputPath('connected-video-portrait-default.png') })
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})

test('粘贴视频保留原模型和参数，目录缺少原模型时须手动重选', async ({ page }, testInfo) => {
  const { api, estimates } = await installModelCanvas(page, [
    videoNode('可用视频', 53, 120),
    videoNode('已下架视频', 99, 550),
  ])
  const panel = page.locator('[data-canvas-node-panel]')
  const pasteNode = async (id: string, count: number) => {
    await page.locator('.react-flow__pane').click({ position: { x: 28, y: 330 } })
    await expect(panel).toHaveCount(0)
    const source = page.locator(`.react-flow__node[data-id="${id}"]`)
    await source.click()
    await expect(source).toHaveClass(/\bselected\b/)
    await page.locator('.canvas-view').focus()
    await page.keyboard.press('Control+c')
    await page.mouse.move(1180, count === 3 ? 300 : 535)
    await page.keyboard.press('Control+v')
    await page.getByRole('button', { name: /^只含当前节点/ }).click()
    await expect(page.locator('.react-flow__node-video')).toHaveCount(count)
  }

  await pasteNode('可用视频', 3)
  await expect(panel.getByRole('button', { name: 'Seedance 2.5 Flash' })).toBeVisible()
  await expect(panel.getByRole('button', { name: /全能参考.*4:3.*10/ })).toBeVisible()
  await expect
    .poll(() => estimates.at(-1))
    .toMatchObject({
      model_version_id: 53,
      params: { ratio: '4:3', duration: 10 },
      prompt: expect.stringContaining('保持镜头内人物和道具的位置'),
    })

  await pasteNode('已下架视频', 4)
  await expect(panel.getByRole('button', { name: '模型 #99' })).toBeVisible()
  await expect(panel.getByText(/模型 #99暂不可用/)).toBeVisible()
  await expect(panel.locator('[data-canvas-generate]')).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('pasted-unavailable-model.png') })
  await openModelPicker(page, panel.getByRole('button', { name: '模型 #99' }))
  await page.getByRole('option', { name: /宽屏视频模型/ }).click()
  await expect(panel.getByRole('button', { name: '宽屏视频模型' })).toBeVisible()
  await expect.poll(() => estimates.at(-1)).toMatchObject({ model_version_id: 54 })
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
