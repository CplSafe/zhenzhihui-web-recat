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
        if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
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
      const nodeA = nodes.and(page.locator('[data-id="A"]'))
      const nodeB = nodes.and(page.locator('[data-id="B"]'))
      await expect(nodes).toHaveCount(2)
      if (grouped) {
        await nodeA.click({ position: { x: 60, y: 60 } })
      } else {
        // 框选同时选中两个节点，避免单选期间的编辑面板盖住另一个节点。
        await expect(nodeA).toBeInViewport()
        await expect(nodeB).toBeInViewport()
        const [a, b] = await Promise.all([nodeA.boundingBox(), nodeB.boundingBox()])
        if (!a || !b) throw new Error('待框选节点不可见')
        const startX = Math.max(8, Math.min(a.x, b.x) - 12)
        const startY = Math.max(8, Math.min(a.y, b.y) - 24)
        const endX = Math.min(width - 8, Math.max(a.x + a.width, b.x + b.width) + 12)
        const endY = Math.min(836, Math.max(a.y + a.height, b.y + b.height) + 12)
        await page.keyboard.down('Shift')
        await page.mouse.move(startX, startY)
        await page.mouse.down()
        await page.mouse.move(endX, endY, { steps: 8 })
        await page.mouse.up()
        await page.keyboard.up('Shift')
      }
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
      await expect(nodeA).toHaveClass(/(?:^|\s)selected(?:\s|$)/)
      await expect(nodeB).toHaveClass(/(?:^|\s)selected(?:\s|$)/)
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
      const viewport = page.locator('.react-flow__viewport')
      const viewBeforeCreation = await viewport.getAttribute('style')
      await menu.getByRole('button', { name: /^视频制作/ }).click()
      await expect(nodes).toHaveCount(3)
      await expect(page.locator('.react-flow__edge')).toHaveCount(2)
      await expect(page.getByText('图片 2/30')).toBeVisible()
      await expect(page.getByText('视频 0/10')).toBeVisible()
      await expect(page.getByText('音频 0/10')).toBeVisible()
      const panel = page.locator('.canvas-panel-area')
      await expect(panel).toBeVisible()
      await expect.poll(() => viewport.getAttribute('style')).not.toBe(viewBeforeCreation)
      await expect
        .poll(() =>
          viewport.evaluate(
            (element) =>
              new Promise<boolean>((resolve) => {
                const before = element.getAttribute('style')
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve(element.getAttribute('style') === before)),
                )
              }),
          ),
        )
        .toBe(true)
      const newVideo = page.locator('.react-flow__node-video')
      const [videoBox, panelBox] = await Promise.all([newVideo.boundingBox(), panel.boundingBox()])
      if (!videoBox || !panelBox) throw new Error('新建视频节点和编辑面板应当存在')
      expect(panelBox.x + panelBox.width / 2).toBeCloseTo(videoBox.x + videoBox.width / 2, 0)
      expect(panelBox.y - videoBox.y - videoBox.height).toBeCloseTo(24, 0)

      // 面板保留节点位置，手动平移给完整面板留出空间。
      const dx = Math.round(width / 2 - (panelBox.x + panelBox.width / 2))
      const dy = Math.round(Math.max(8, Math.min(panelBox.y, 844 - panelBox.height - 48)) - panelBox.y)
      const startX = dx < 0 ? width - 24 : 24
      const startY = 105 + Math.max(0, -dy)
      await page.mouse.move(startX, startY)
      await page.mouse.down({ button: 'middle' })
      await page.mouse.move(startX + dx, startY + dy, { steps: 8 })
      await page.mouse.up({ button: 'middle' })
      await expect(panel).toBeInViewport({ ratio: 0.99 })
      const prompt = panel.getByRole('textbox')
      await prompt.click()
      await prompt.fill('从批量选中的节点制作视频')
      await expect(prompt).toHaveText('从批量选中的节点制作视频')
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
