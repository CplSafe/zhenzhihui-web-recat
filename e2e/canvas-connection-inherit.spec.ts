import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('图片和视频节点连线继承模型与参数并保存', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/assets/701/download**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#dbeafe"/></svg>',
    }),
  )
  await page.route('**/api/v1/ai/models**', (route) => {
    const op = new URL(route.request().url()).searchParams.get('operation_code') || ''
    const video = op === 'video.generate'
    const image = op.startsWith('image.')
    return route.fulfill({
      json: {
        items:
          video || image
            ? [
                {
                  id: video ? 52 : 42,
                  display_name: video ? '来源视频模型' : '来源图片模型',
                  capability: video ? 'video' : 'image',
                  operation_codes: [op],
                  input_constraints: { [op]: { roles: [{ role: video ? 'video' : 'reference_image', max_count: 5 }] } },
                  params_schema: {
                    fields: [
                      { name: 'duration', display_name: '时长', options: [5, 8], default: 5 },
                      { name: 'resolution', display_name: '分辨率', options: ['2K', '1080p'], default: '2K' },
                    ],
                  },
                },
                {
                  id: video ? 53 : 43,
                  display_name: '目标模型',
                  capability: video ? 'video' : 'image',
                  operation_codes: [op],
                },
              ]
            : [],
      },
    })
  })
  const items = [
    {
      id: 'image-source',
      kind: 'image',
      x: 50,
      y: 50,
      assetId: 701,
      modelVersionId: 42,
      params: { resolution: '2K', count: 2 },
      ratio: '4:3',
    },
    { id: 'image-target', kind: 'image', x: 550, y: 50, modelVersionId: 43, params: { count: 1 }, ratio: '1:1' },
    {
      id: 'video-source',
      kind: 'video',
      x: 50,
      y: 450,
      modelVersionId: 52,
      params: { duration: 8, resolution: '1080p' },
      ratio: '16:9',
      videoMode: 'full-ref',
    },
    { id: 'video-target', kind: 'video', x: 550, y: 450, modelVersionId: 53, params: { duration: 5 }, ratio: '9:16' },
  ]
  const elements = new Map(
    items.map(({ id, kind, x, y, ...data }) => [
      id,
      {
        element_id: id,
        kind: 'node',
        op: 'upsert',
        payload: { id, type: kind, position: { x, y }, style: { width: 220, height: 180 }, data: { kind, ...data } },
      },
    ]),
  )
  let revision = 1
  await page.route('**/api/v1/canvases/987**', async (route) => {
    if (route.request().method() === 'PATCH') {
      for (const item of route.request().postDataJSON().mutations || []) {
        if (item.op === 'delete') elements.delete(item.element_id)
        else elements.set(item.element_id, item)
      }
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    const url = new URL(route.request().url())
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [...elements.values()],
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 987, title: '连线继承配置', status: 'active', revision },
    })
  })
  await page.route('**/api/v1/canvases/987/node-locks**', (route) =>
    route.fulfill({ json: { granted: true, nodes: {} } }),
  )
  await page.goto('/canvas/987')
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  const imageSource = page.locator('.react-flow__node[data-id="image-source"]')
  await expect(imageSource.locator('.canvas-node-body img')).toHaveJSProperty('naturalWidth', 320)
  async function connect(source: string, target: string, checkPanel = false) {
    const node = page.locator(`.react-flow__node[data-id="${source}"]`)
    const targetNode = page.locator(`.react-flow__node[data-id="${target}"]`)
    const panel = page.locator('.canvas-panel-area')
    if (checkPanel) {
      await node.click()
      await expect(panel).toBeVisible()
    }
    await node.hover()
    const handle = node.locator('.canvas-handle-icon--right')
    await expect(handle).toBeVisible()
    const from = (await handle.boundingBox())!
    const to = (await targetNode.boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
    if (checkPanel) {
      await expect(panel).toHaveAttribute('aria-hidden', 'true')
      await expect(panel).toHaveCSS('visibility', 'hidden')
      await page.screenshot({ path: testInfo.outputPath('prompt-hidden-during-connection.png') })
    }
    await page.mouse.up()
    if (checkPanel) await expect(panel).toHaveCSS('visibility', 'visible')
    await expect(page.getByRole('group', { name: `Edge from ${source} to ${target}` })).toBeAttached()
  }
  await connect('image-source', 'image-target', true)
  await expect
    .poll(() => elements.get('image-target')?.payload.data)
    .toMatchObject({ modelVersionId: 42, params: { resolution: '2K', count: 2 }, ratio: '4:3' })
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 330 } })
  await connect('video-source', 'video-target')
  await expect
    .poll(() => elements.get('video-target')?.payload.data)
    .toMatchObject({
      modelVersionId: 52,
      params: { duration: 8, resolution: '1080p' },
      ratio: '16:9',
      videoMode: 'full-ref',
    })
  await page.locator('.react-flow__node[data-id="video-target"]').click()
  await expect(page.getByText('来源视频模型', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('inherited-config.png') })

  const target = page.locator('.react-flow__node[data-id="video-target"]')
  const targetY = (await target.boundingBox())!.y
  const panVertically = async (distance: number) => {
    await page.mouse.move(20, 420)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(20, 420 + distance, { steps: 8 })
    await page.mouse.up({ button: 'middle' })
  }
  // 完整面板在下沿会覆盖节点的一部分。先把节点平移到可操作的位置。
  await panVertically(-190)
  await expect.poll(async () => (await target.boundingBox())?.y).toBeCloseTo(targetY - 190, 0)
  await expect(page.getByText('来源视频模型', { exact: true }).first()).toBeVisible()
  await target.click({ button: 'right' })
  await page.getByRole('button', { name: '创建副本' }).hover()
  await expect(page.getByRole('menuitem')).toHaveText([
    /^只含当前节点/,
    '包含之前所有节点（仅连接原资产）',
    '包含之前所有节点',
  ])
  await page.screenshot({ path: testInfo.outputPath('duplicate-original-inputs-menu.png') })
  await page.getByRole('menuitem', { name: '包含之前所有节点（仅连接原资产）' }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(5)
  await expect
    .poll(() => {
      const copies = [...elements.values()].filter(
        (item) => item.kind === 'node' && !items.some((node) => node.id === item.element_id),
      )
      return copies.map((copy) => copy.payload.data)
    })
    .toEqual([
      expect.objectContaining({ kind: 'video', modelVersionId: 52, params: { duration: 8, resolution: '1080p' } }),
    ])
  const copied = [...elements.values()].find(
    (item) => item.kind === 'node' && !items.some((node) => node.id === item.element_id),
  )!
  expect(copied.payload.position.x).toBeGreaterThanOrEqual(550 + 220)
  await expect
    .poll(() => [...elements.values()].filter((item) => item.kind === 'edge').map((item) => item.payload))
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'video-source', target: 'video-target' }),
        expect.objectContaining({ source: 'video-source', target: copied.element_id }),
      ]),
    )
  await page.screenshot({ path: testInfo.outputPath('duplicate-with-original-inputs.png') })

  await panVertically(190)
  await expect.poll(async () => (await target.boundingBox())?.y).toBeCloseTo(targetY, 0)
  await imageSource.click()
  const panel = page.locator('.canvas-panel-area')
  await expect(panel).toBeVisible()
  const leftHandle = (await imageSource.locator('.canvas-handle-icon--left').boundingBox())!
  const pane = (await page.locator('.react-flow__pane').boundingBox())!
  await page.mouse.move(leftHandle.x + leftHandle.width / 2, leftHandle.y + leftHandle.height / 2)
  await page.mouse.down()
  await expect(panel).toBeVisible()
  await page.mouse.move(pane.x + pane.width * 0.14, pane.y + pane.height * 0.36, { steps: 12 })
  await expect(page.locator('.react-flow__connection')).toBeVisible()
  await expect(panel).toHaveCSS('visibility', 'hidden')
  await page.screenshot({ path: testInfo.outputPath('prompt-hidden-during-left-connection.png') })
  await page.mouse.up()
  const menu = page.locator('.canvas-add-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: '图片节点' }).click()
  const newImage = page.locator('.react-flow__node-image').last()
  await expect(page.locator('.react-flow__node-image')).toHaveCount(3)
  const newImageId = await newImage.getAttribute('data-id')
  await expect(page.getByRole('group', { name: `Edge from image-source to ${newImageId}` })).toBeAttached()
  await expect(panel).toBeVisible()
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
