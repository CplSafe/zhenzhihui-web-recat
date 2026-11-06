import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  for (const grouped of [false, true]) {
    test(`拖拽${grouped ? '分组' : '多选'}加号创建视频 ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 })
      const api = await installStrictAuthenticatedApp(page)
      await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
      await page.route('**/api/v1/ai/models**', (route) =>
        route.fulfill({
          json: {
            items: [
              {
                id: 251,
                display_name: '测试模型 2.5',
                operation_codes: ['video.generate'],
                input_constraints: {
                  'video.generate': {
                    roles: [
                      { role: 'image', max_count: 30 },
                      { role: 'video', max_count: 10 },
                      { role: 'audio', max_count: 10 },
                    ],
                  },
                },
              },
            ],
          },
        }),
      )
      await page.route('**/api/v1/canvases/188**', async (route) => {
        if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
        const url = new URL(route.request().url())
        await route.fulfill({
          json: url.pathname.endsWith('/elements')
            ? {
                elements: ['A', 'B'].map((id, index) => ({
                  element_id: id,
                  kind: 'node',
                  op: 'upsert',
                  payload: {
                    id,
                    type: 'image',
                    position: { x: index * 300, y: 100 },
                    style: { width: 220, height: 200 },
                    data: {
                      kind: 'image',
                      title: id,
                      assetId: index + 801,
                      ...(grouped ? { groupId: 'group-1' } : {}),
                    },
                  },
                })),
                sync_revision: 1,
                history_floor_revision: 0,
                has_more: false,
              }
            : { id: 188, title: '批量拖拽验收', status: 'active', revision: 1 },
        })
      })
      await page.goto('/canvas/188')
      const nodes = page.locator('.react-flow__node')
      await expect(nodes).toHaveCount(2)
      if (grouped) {
        await page.locator('.react-flow__node[data-id="A"]').click({ position: { x: 60, y: 60 } })
      } else {
        for (const id of ['A', 'B'])
          await page
            .locator(`.react-flow__node[data-id="${id}"]`)
            .click({ position: { x: 40, y: 40 }, modifiers: ['Control'] })
      }
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
      const add = page.getByRole('button', { name: '从所选节点创建下游节点' })
      await expect(add).toBeVisible()
      const box = await add.boundingBox()
      if (!box) throw new Error('加号不可见')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      const x = Math.max(180, Math.min(width - 30, box.x + box.width / 2 + 120))
      const y = Math.max(150, box.y - 130)
      await page.mouse.move(x, y, { steps: 8 })
      await expect(page.locator('.canvas-selection-drag-line')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('dragging.png') })
      await page.mouse.up()
      const menu = page.locator('.canvas-add-menu')
      await expect(menu).toBeVisible()
      await expect(menu.getByRole('button', { name: /^视频制作/ })).toBeEnabled()
      await page.screenshot({ path: testInfo.outputPath('drag-menu.png') })
      await menu.getByRole('button', { name: /^视频制作/ }).click()
      await expect(nodes).toHaveCount(3)
      await expect(page.locator('.react-flow__edge')).toHaveCount(2)
      await expect(page.getByText('图片 2/30')).toBeVisible()
      await expect(page.getByText('视频 0/10')).toBeVisible()
      await expect(page.getByText('音频 0/10')).toBeVisible()
      const panel = page.locator('.canvas-panel-area')
      await expect(panel).toBeVisible()
      await expect
        .poll(async () => {
          const bounds = await panel.boundingBox()
          return Boolean(
            bounds &&
            bounds.x >= 0 &&
            bounds.x + bounds.width <= width &&
            bounds.y >= 0 &&
            bounds.y + bounds.height <= 844,
          )
        })
        .toBe(true)
      const prompt = panel.getByRole('textbox')
      await prompt.scrollIntoViewIfNeeded()
      await expect(prompt).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('video-created.png') })
      expect(api.paidTaskSubmissions).toBe(0)
      expectNoUnexpectedApi(api)
    })
  }
}

for (const width of [1440, 390]) {
  test(`分组拖到已有视频节点 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/canvases/189**', async (route) => {
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
      const url = new URL(route.request().url())
      const sources = ['A', 'B'].map((id, index) => ({
        element_id: id,
        kind: 'node',
        op: 'upsert',
        payload: {
          id,
          type: 'image',
          position: { x: index * 250, y: 100 },
          style: { width: 200, height: 200 },
          data: { kind: 'image', title: id, assetId: 801 + index, groupId: 'group-1' },
        },
      }))
      const target = {
        element_id: 'target',
        kind: 'node',
        op: 'upsert',
        payload: {
          id: 'target',
          type: 'video',
          position: { x: 750, y: 100 },
          style: { width: 220, height: 200 },
          data: { kind: 'video', title: '目标视频', videoMode: 'full-ref' },
        },
      }
      await route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: [...sources, target],
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 189, title: '批量拖拽连接验收', status: 'active', revision: 1 },
      })
    })
    await page.goto('/canvas/189')
    await expect(page.locator('.react-flow__node')).toHaveCount(3)
    await page.locator('.react-flow__node[data-id="A"]').click({ position: { x: 50, y: 50 } })
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
    const toolbar = page.getByRole('toolbar', { name: '已选中 2 个节点' })
    const toolbarBox = await toolbar.boundingBox()
    if (!toolbarBox) throw new Error('缺少批量工具条')
    expect(toolbarBox.x).toBeGreaterThanOrEqual(0)
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(width)
    const add = page.getByRole('button', { name: '从所选节点创建下游节点' })
    const source = await add.boundingBox()
    const target = await page.locator('.react-flow__node[data-id="target"]').boundingBox()
    if (!source || !target) throw new Error('节点不可见')
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByText('批量连接预览')).toBeVisible()
    await page.getByRole('button', { name: '连接 2 条' }).click()
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)
    await page.screenshot({ path: testInfo.outputPath('existing-target.png') })
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
