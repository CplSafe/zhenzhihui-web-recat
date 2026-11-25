import { expect, test, type Locator, type Page } from '@playwright/test'
import { waitForCanvasViewportToSettle } from './fixtures/canvas-viewport'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 640 },
  { width: 390, height: 640 },
]
const scenarios = [
  { kind: 'image', name: '58% 缩放下的图片' },
  { kind: 'video', name: '视频' },
  { kind: 'audio', name: '音频' },
] as const
const prompt = '布局检查'
const modelName = '面板布局测试模型'

async function expectControlHit(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 0.99 })
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const { x, y, width, height } = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(x + width / 2, y + height / 2))
      }),
    )
    .toBe(true)
}

async function zoomCanvasAroundNode(page: Page, node: Locator, target: number) {
  const viewport = page.locator('.react-flow__viewport')
  const canvas = page.locator('.react-flow')
  const readZoom = () => viewport.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)
  const bounds = await node.boundingBox()
  if (!bounds) throw new Error('缩放目标节点不可见')
  const clientX = bounds.x + bounds.width / 2
  const clientY = bounds.y + bounds.height / 2
  // Match the wheel zoom limit while exercising the canvas's wheel handler.
  for (let step = 0; step < 32; step++) {
    const current = await readZoom()
    if (Math.abs(target - current) < 0.0001) break
    const next = Math.max(current / 1.11, Math.min(target, current * 1.11))
    await canvas.dispatchEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: Math.log2(current / next) / 0.002,
      clientX,
      clientY,
    })
    await expect.poll(readZoom).toBeCloseTo(next, 4)
  }
  await expect.poll(readZoom).toBeCloseTo(target, 3)
}

for (const { kind, name, viewport } of scenarios.flatMap((scenario) =>
  viewports.map((viewport) => ({ ...scenario, viewport })),
)) {
  test(`选中靠近屏幕下沿的${name}时保持画布位置 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    if (kind !== 'audio') {
      await page.route('**/api/v1/ai/models**', (route) =>
        route.fulfill({
          json: {
            items: [
              {
                id: 141,
                display_name: modelName,
                capability: kind,
                operation_codes: [kind === 'image' ? 'image.text_to_image' : 'video.generate'],
              },
            ],
          },
        }),
      )
      await page.route('**/api/v1/ai/tasks/estimate-cost', (route) =>
        route.fulfill({ json: { estimated_cost: 10, balance: 1000, can_afford: true } }),
      )
    }
    await page.route('**/api/v1/canvases/119**', (route) =>
      route.fulfill({
        json:
          route.request().method() === 'PATCH'
            ? { sync_revision: 2 }
            : new URL(route.request().url()).pathname.endsWith('/elements')
              ? {
                  elements: [
                    {
                      element_id: 'source',
                      kind: 'node',
                      payload: {
                        id: 'source',
                        type: kind,
                        position: { x: 300, y: 250 },
                        style: { width: 200, height: 160 },
                        data: {
                          kind,
                          title: '画布位置检查',
                          prompt,
                          ...(kind !== 'audio' ? { modelVersionId: 141 } : {}),
                          ...(kind === 'video' ? { videoMode: 'auto' } : {}),
                        },
                      },
                    },
                  ],
                  sync_revision: 1,
                  history_floor_revision: 0,
                  has_more: false,
                }
              : { id: 119, title: '面板位置检查', revision: 1 },
      }),
    )
    await page.route('**/api/v1/canvases/119/node-locks**', (route) =>
      route.fulfill({ json: { granted: true, nodes: {} } }),
    )
    await page.goto('/canvas/119')
    const node = page.locator('.react-flow__node[data-id="source"]')
    const canvasViewport = page.locator('.react-flow__viewport')
    await expect(node).toBeInViewport()
    const creationDock = page.locator('[data-canvas-floating-toolbar]')
    const viewControls = page.getByRole('toolbar', { name: '画布视图控制', exact: true })
    await expect(creationDock).toBeVisible()
    await expect(viewControls).toBeVisible()
    const creationBox = (await creationDock.boundingBox())!
    await waitForCanvasViewportToSettle(canvasViewport)
    if (kind === 'image') await zoomCanvasAroundNode(page, node, 0.58)

    const original = (await node.boundingBox())!
    // 此处只考查底部，先把节点移到能容纳完整面板的横向位置。
    const deltaX = kind === 'audio' ? 0 : viewport.width / 2 - (original.x + original.width / 2)
    const deltaY = viewport.height - 65 - original.y - original.height
    const dragX = deltaX < 0 ? viewport.width - 20 : 20
    const dragY = deltaY > 0 ? 105 : viewport.height - 105
    await page.mouse.move(dragX, dragY)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(dragX + deltaX, dragY + deltaY, { steps: 8 })
    await page.mouse.up({ button: 'middle' })
    await expect
      .poll(async () => {
        const box = (await node.boundingBox())!
        return Math.abs(box.y + box.height - (viewport.height - 65))
      })
      .toBeLessThan(4)

    const transform = await canvasViewport.evaluate((element) => {
      const before = element.getAttribute('style')
      const changes: Array<string | null> = []
      const observer = new MutationObserver(() => changes.push(element.getAttribute('style')))
      observer.observe(element, { attributes: true, attributeFilter: ['style'] })
      ;(element as HTMLElement & { viewportChanges?: Array<string | null> }).viewportChanges = changes
      return before
    })
    await node.locator('.canvas-node-header').click()
    const editor = page.locator(kind === 'audio' ? '.canvas-audio-panel' : '[data-canvas-node-panel]')
    await expect(editor).toBeVisible()
    const expectUnmovedViewport = async () => {
      expect(await canvasViewport.getAttribute('style')).toBe(transform)
      const changes = await canvasViewport.evaluate(
        (element) => (element as HTMLElement & { viewportChanges?: Array<string | null> }).viewportChanges,
      )
      expect(changes?.every((value) => value === transform)).toBe(true)
    }
    if (kind !== 'audio') {
      const [edgeNode, cropped] = await Promise.all([node.boundingBox(), editor.boundingBox()])
      if (!edgeNode || !cropped) throw new Error('下沿节点与面板应当存在')
      expect(cropped.y - edgeNode.y - edgeNode.height).toBeCloseTo(24, 0)
      expect(cropped.y + cropped.height).toBeGreaterThan(viewport.height + 20)
      await expect(editor).toBeInViewport({ ratio: 0.01 })
      await expect
        .poll(() =>
          editor.evaluate((element) => {
            const { left, top, width } = element.getBoundingClientRect()
            const visiblePointY = (top + window.innerHeight) / 2
            return element.contains(document.elementFromPoint(left + width / 4, visiblePointY))
          }),
        )
        .toBe(true)
      await expectUnmovedViewport()
      await page.screenshot({ path: testInfo.outputPath('node-panel-no-pan.png') })

      // 手动平移到足够操作完整面板的位置，同时保留与底部工具条的重叠。
      const distance = Math.round(cropped.y + cropped.height - (viewport.height - 16))
      const panX = viewport.width - 20
      await page.mouse.move(panX, 105 + distance)
      await page.mouse.down({ button: 'middle' })
      await page.mouse.move(panX, 105, { steps: 8 })
      await page.mouse.up({ button: 'middle' })
      await expect(editor).toBeInViewport({ ratio: 0.99 })
      expect((await editor.boundingBox())?.height).toBeCloseTo(cropped.height, 0)
    }
    const field = editor.getByRole('textbox', kind === 'audio' ? { name: '配音文案或音乐描述' } : {})
    if (kind === 'audio') await expect(field).toHaveValue(prompt)
    else await expect(field).toHaveText(prompt)
    await field.click()
    await field.fill('面板仍可编辑')
    if (kind === 'audio') await expect(field).toHaveValue('面板仍可编辑')
    else await expect(field).toHaveText('面板仍可编辑')
    const nodeBox = (await node.boundingBox())!
    const panelBox = (await editor.boundingBox())!
    if (kind !== 'audio') {
      await expect(editor).toBeInViewport({ ratio: 0.99 })
      const footer = editor.locator('[data-canvas-node-panel-actions]')
      const generate = footer.locator('[data-canvas-generate]')
      await expect(footer).toBeInViewport({ ratio: 0.99 })
      await expect(generate).toBeEnabled()
      await expectControlHit(footer.getByRole('button', { name: modelName, exact: true }))
      await expectControlHit(generate)
      const editorBottom = panelBox.y + panelBox.height
      // 面板可覆盖下方工具条，但编辑器本身留在视口内。
      expect(editorBottom).toBeGreaterThan(nodeBox.y)
      expect(panelBox.x).toBeLessThan(creationBox.x + creationBox.width)
      expect(panelBox.x + panelBox.width).toBeGreaterThan(creationBox.x)
      expect(editorBottom).toBeGreaterThan(creationBox.y + 10)
      expect(editorBottom).toBeLessThanOrEqual(viewport.height + 1)
      const navigation = page.locator('[aria-label="画布导航"]')
      await expect(navigation).toBeVisible()
      const navBox = (await navigation.boundingBox())!
      if (panelBox.x < navBox.x + navBox.width && panelBox.x + panelBox.width > navBox.x) {
        expect(panelBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height - 1)
        await expectControlHit(navigation.getByRole('button', { name: '返回无限画布', exact: true }))
        await expectControlHit(navigation.getByRole('status'))
      }
    }
    if (kind === 'audio') {
      expect(panelBox.y).toBeGreaterThanOrEqual(0)
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(nodeBox.y + 1)
      const toolbar = page.getByRole('toolbar', { name: '节点操作', exact: true })
      await expect(toolbar).toBeVisible()
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual((await toolbar.boundingBox())!.y)
      await expectUnmovedViewport()
      await page.screenshot({ path: testInfo.outputPath('node-panel-no-pan.png') })
    }
    if (kind === 'video') {
      expect(panelBox.x).toBeGreaterThanOrEqual(0)
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(viewport.width)
      if (viewport.width === 1440) await expect(editor).toHaveCSS('width', '680px')
    }
    if (kind === 'video' && viewport.width === 1440) {
      await test.step('从面板空白处开始平移', async () => {
        const passiveLabel = editor.getByText(/^图片 \d+\/\d+$/, { exact: true })
        const hand = page.getByRole('button', { name: '拖动', exact: true })
        const canvasX = () =>
          canvasViewport.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41)

        for (const button of ['middle', 'left'] as const) {
          if (button === 'left') {
            await page.getByRole('button', { name: '置顶画布工具栏', exact: true }).click()
            await hand.click()
            await expect(hand).toHaveAttribute('aria-pressed', 'true')
          }
          await passiveLabel.hover()
          const bounds = (await passiveLabel.boundingBox())!
          const x = bounds.x + bounds.width / 2
          const y = bounds.y + bounds.height / 2
          const before = await canvasX()
          await page.mouse.move(x, y)
          await page.mouse.down({ button })
          await page.mouse.move(x + 60, y, { steps: 8 })
          await page.mouse.up({ button })
          await expect.poll(canvasX).toBeCloseTo(before + 60, 0)
          await page.mouse.move(x + 80, y)
          expect(await canvasX()).toBeCloseTo(before + 60, 0)
          await expect(editor).toBeVisible()
        }
        await page.screenshot({ path: testInfo.outputPath('panel-background-pan.png') })
      })
    }
    if (kind === 'image' && viewport.width === 390) {
      const reveal = page.getByRole('button', { name: '置顶画布工具栏', exact: true })
      await expectControlHit(reveal)
      await reveal.click()
      await expectControlHit(creationDock.getByRole('button', { name: '添加节点', exact: true }))
      await field.click()
      await expectControlHit(reveal)
    }

    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}

test('编辑面板和工具条各自随节点裁切，返回视口后保留草稿', async ({ page }, testInfo) => {
  test.setTimeout(75_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 141,
            display_name: modelName,
            capability: 'image',
            operation_codes: ['image.text_to_image', 'image.image_to_image'],
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/assets/12391/download?**', (route) =>
    route.fulfill({ contentType: 'image/png', path: 'public/t1test.png' }),
  )
  let revision = 1
  await page.route(/\/api\/v1\/canvases\/231(?:\/(?:elements|members|node-locks))?(?:\?.*)?$/, (route) => {
    const { pathname, searchParams } = new URL(route.request().url())
    const method = route.request().method()
    if (pathname.endsWith('/members') && method === 'GET') {
      return route.fulfill({
        json: { creator_id: 7, can_manage: true, member_user_ids: [], members_restricted: false },
      })
    }
    if (pathname.endsWith('/node-locks') && method === 'POST') {
      const { nodes } = route.request().postDataJSON() as { nodes: string[] }
      const holders = Object.fromEntries(nodes.map((id) => [id, [{ user_id: 7, name: 'E2E 用户', editing: true }]]))
      if (nodes.includes('result')) holders.reference = [{ user_id: 7, name: 'E2E 用户', editing: false }]
      return route.fulfill({ json: { granted: true, nodes: holders } })
    }
    if (pathname.endsWith('/elements') && method === 'PATCH') {
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    if (pathname.endsWith('/elements') && method === 'GET') {
      return route.fulfill({
        json: {
          elements:
            Number(searchParams.get('after_revision')) > 0
              ? []
              : [
                  {
                    element_id: 'reference',
                    kind: 'node',
                    payload: {
                      id: 'reference',
                      type: 'image',
                      position: { x: 20, y: 220 },
                      style: { width: 216, height: 162 },
                      data: { kind: 'image', title: '参考原图', assetId: 12391, assetWorkspaceId: WORKSPACE_ID },
                    },
                  },
                  {
                    element_id: 'result',
                    kind: 'node',
                    payload: {
                      id: 'result',
                      type: 'image',
                      position: { x: 390, y: 220 },
                      style: { width: 216, height: 162 },
                      data: { kind: 'image', title: '编辑结果', prompt, modelVersionId: 141 },
                    },
                  },
                  {
                    element_id: 'reference-to-result',
                    kind: 'edge',
                    payload: {
                      id: 'reference-to-result',
                      source: 'reference',
                      target: 'result',
                      sourceHandle: 'reference-right-source',
                      targetHandle: 'result-left-target',
                      data: { slotIndex: 0 },
                    },
                  },
                ],
          sync_revision: revision,
          history_floor_revision: 0,
          has_more: false,
        },
      })
    }
    if (pathname.endsWith('/231') && method === 'GET') {
      return route.fulfill({ json: { id: 231, title: '编辑面板持续跟随', revision } })
    }
    return route.fallback()
  })

  await page.goto('/canvas/231')
  const node = page.locator('.react-flow__node[data-id="result"]')
  const reference = page.locator('.react-flow__node[data-id="reference"]')
  const viewport = page.locator('.react-flow__viewport')
  const editor = page.locator('[data-canvas-node-panel]')
  const field = editor.getByRole('textbox')
  const referenceCount = editor.getByRole('status').filter({ hasText: /^图片参考线 1\// })
  const model = editor.getByRole('button', { name: modelName, exact: true })
  const modelMenu = page.getByRole('listbox', { name: '生成模型列表' })
  const generate = editor.locator('[data-canvas-generate]')
  const nodeToolbar = page.getByRole('toolbar', { name: '节点操作', exact: true })
  const selectedClass = /(?:^|\s)selected(?:\s|$)/
  const draft = '保留正在编辑的提示词'
  const offscreenDraft = '节点离屏时输入并保留的提示词'
  const readZoom = () => viewport.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)

  const pan = async (dx: number, dy = 0) => {
    const x = dx >= 0 ? 190 : 1250
    const y = dy >= 0 ? 105 : Math.max(135, 25 - dy)
    await page.mouse.move(x, y)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(x + dx, y + dy, { steps: 12 })
    await page.mouse.up({ button: 'middle' })
  }
  const expectBelow = async () => {
    await expect
      .poll(async () => {
        const [nodeBox, panelBox] = await Promise.all([node.boundingBox(), editor.boundingBox()])
        if (!nodeBox || !panelBox) return Infinity
        return Math.abs(panelBox.y - (nodeBox.y + nodeBox.height) - 24)
      })
      .toBeLessThan(1)
  }
  const expectAttachedBelow = async () => {
    await expect(editor).toBeVisible()
    await expect
      .poll(async () => {
        const [nodeBox, panelBox] = await Promise.all([node.boundingBox(), editor.boundingBox()])
        if (!nodeBox || !panelBox) return Infinity
        return Math.abs(panelBox.x + panelBox.width / 2 - (nodeBox.x + nodeBox.width / 2))
      })
      .toBeLessThan(1)
    await expectBelow()
  }
  const dragWhileHeld = async (item: Locator, dx: number, dy: number, assertDuringDrag: () => Promise<void>) => {
    const body = (await item.locator('.canvas-node-body').boundingBox())!
    const before = (await item.boundingBox())!
    const x = body.x + body.width * 0.7
    const y = body.y + body.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    try {
      await page.mouse.move(x + dx, y + dy, { steps: 8 })
      await expect
        .poll(async () => Math.abs(((await item.boundingBox())?.x ?? before.x) - before.x))
        .toBeGreaterThan(20)
      await assertDuringDrag()
    } finally {
      await page.mouse.up()
    }
  }

  await expect(node).toBeInViewport()
  await page.getByRole('button', { name: /当前缩放 .*点击回到 100%/ }).click()
  await expect.poll(readZoom).toBe(1)
  await waitForCanvasViewportToSettle(viewport)
  const initial = (await node.boundingBox())!
  await pan(730 - initial.x - initial.width / 2, 205 - initial.y)
  await node.locator('.canvas-node-header').click()
  await expect(node.getByText('编辑中', { exact: true })).toBeVisible()
  await expect(reference.getByText('引用中', { exact: true })).toBeVisible()
  await expect(referenceCount).toBeVisible()
  await expect(editor.getByTitle('点击预览素材，点击名称插入引用')).toBeVisible()
  await expect(model).toBeVisible()
  await expect(field).toHaveText(prompt)
  await field.fill(draft)
  await expectAttachedBelow()
  const editorSize = (await editor.boundingBox())!
  const expectFullSizeEditor = async () => {
    await expect
      .poll(async () => {
        const size = await editor.boundingBox()
        if (!size) return Infinity
        return Math.max(Math.abs(size.width - editorSize.width), Math.abs(size.height - editorSize.height))
      })
      .toBeLessThan(1)
  }

  await test.step('鼠标未松开时，完整的编辑面板跟随当前节点', async () => {
    await model.click()
    await expect(modelMenu).toBeVisible()
    const canvasTransform = await viewport.getAttribute('style')
    await dragWhileHeld(node, 75, 40, async () => {
      await expectAttachedBelow()
      await expect(modelMenu).toBeHidden()
      await expect(field).toHaveText(draft)
      await expect(referenceCount).toBeVisible()
      await expect(model).toBeVisible()
      expect(await viewport.getAttribute('style')).toBe(canvasTransform)
      await page.screenshot({ path: testInfo.outputPath('editor-while-node-is-dragging.png') })
    })
    await expectAttachedBelow()
  })

  await test.step('拖动引用节点时，编辑面板留在当前节点', async () => {
    const nodeBefore = await node.boundingBox()
    await dragWhileHeld(reference, -45, -65, async () => {
      await expect(node).toHaveClass(selectedClass)
      await expect(reference).not.toHaveClass(selectedClass)
      await expect(node.getByText('编辑中', { exact: true })).toBeVisible()
      await expect(reference.getByText('引用中', { exact: true })).toBeVisible()
      await expect(field).toHaveText(draft)
      await expectAttachedBelow()
      expect(await node.boundingBox()).toEqual(nodeBefore)
    })
    await expect(node).toHaveClass(selectedClass)
    await expect(reference).not.toHaveClass(selectedClass)
    await expectAttachedBelow()
    await expect(field).toHaveText(draft)
  })

  await test.step('面板保持原尺寸，并可切换与底部工具条的前后顺序', async () => {
    const toolbar = page.locator('[data-canvas-floating-toolbar]')
    const [fullPanel, dock] = await Promise.all([editor.boundingBox(), toolbar.boundingBox()])
    if (!fullPanel || !dock) throw new Error('编辑面板和底部工具条应当可见')
    const moveDown = Math.round(1000 - 16 - (fullPanel.y + fullPanel.height))
    expect(moveDown).toBeGreaterThan(120)
    await pan(0, moveDown)
    await expect(node).toBeInViewport()
    await expect(editor).toBeInViewport({ ratio: 0.99 })
    await expectFullSizeEditor()
    await expectAttachedBelow()
    const anchoredPanel = (await editor.boundingBox())!
    expect(anchoredPanel.y + anchoredPanel.height).toBeCloseTo(984, 0)
    expect(dock.y).toBeLessThan(anchoredPanel.y + anchoredPanel.height)
    await expectControlHit(field)
    await expectControlHit(model)
    await expectControlHit(generate)
    await expect(generate).toBeEnabled()

    const hand = toolbar.getByRole('button', { name: '拖动', exact: true })
    const reveal = page.getByRole('button', { name: '置顶画布工具栏', exact: true })
    const foreground = (side: 'upper' | 'middle' = 'upper') =>
      hand.evaluate((button, side) => {
        const { x, y, width, height } = button.getBoundingClientRect()
        const hit = document.elementFromPoint(x + width / 2, side === 'upper' ? y + 8 : y + height / 2)
        if (hit?.closest('[data-canvas-node-panel]')) return 'editor'
        if (hit?.closest('[data-canvas-floating-toolbar]')) return 'toolbar'
        return null
      }, side)
    await expect.poll(() => foreground()).toBe('editor')
    await expect.poll(() => foreground('middle')).toBe('editor')
    await expectControlHit(reveal)
    await page.screenshot({ path: testInfo.outputPath('full-editor-at-bottom-edge.png') })

    const handBox = (await hand.boundingBox())!
    await reveal.click()
    await expect.poll(() => foreground()).toBe('toolbar')
    await expect(reveal).toBeHidden()
    await hand.click()
    await expect(hand).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => foreground()).toBe('toolbar')
    await page.screenshot({ path: testInfo.outputPath('toolbar-above-overlapping-editor.png') })
    await hand.click()
    await expect(hand).toHaveAttribute('aria-pressed', 'false')
    await field.click()
    await expect(field).toBeFocused()
    await expect.poll(() => foreground()).toBe('editor')

    await hand.focus()
    await expect(hand).toBeFocused()
    await expect.poll(() => foreground()).toBe('toolbar')
    await field.click()
    await expect.poll(() => foreground()).toBe('editor')
    await expectFullSizeEditor()

    const rename = nodeToolbar.getByRole('button', { name: '重命名节点', exact: true })
    const layer = (locator: Locator) => locator.evaluate((element) => Number(getComputedStyle(element).zIndex))
    const editorLayer = await layer(page.locator('.canvas-panel-area'))
    await rename.focus()
    await expect(rename).toBeFocused()
    await expect.poll(() => layer(nodeToolbar)).toBeGreaterThan(editorLayer)
    await field.click()
    await expect.poll(() => layer(nodeToolbar)).toBeLessThan(editorLayer)

    await pan(0, -moveDown)
    await expectAttachedBelow()
    await expect(field).toHaveText(draft)

    const partialMoveDown = Math.round(handBox.y + handBox.height / 3 - (fullPanel.y + fullPanel.height))
    await pan(0, partialMoveDown)
    await expectAttachedBelow()
    await expect(reveal).toBeHidden()
    await expect.poll(() => foreground()).toBe('editor')
    await expect.poll(() => foreground('middle')).toBe('toolbar')
    await hand.click()
    await expect(hand).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => foreground()).toBe('toolbar')
    await hand.click()
    await expect(hand).toHaveAttribute('aria-pressed', 'false')
    await field.click()
    await expect.poll(() => foreground()).toBe('editor')
    await pan(0, -partialMoveDown)
    await expectAttachedBelow()
  })

  type OverlayBox = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>
  const expectProjectedOverlay = async (overlay: Locator, baseline: OverlayBox, dx: number, dy: number) => {
    const { width, height } = baseline
    const x = baseline.x + dx
    const y = baseline.y + dy
    if (x >= 1440 || x + width <= 0 || y >= 1000 || y + height <= 0) {
      await expect(overlay).not.toBeInViewport()
      await expect(overlay).toBeHidden()
      return
    }
    await expect(overlay).toBeInViewport()
    await expect(overlay).toBeVisible()
    await expect
      .poll(async () => {
        const bounds = await overlay.boundingBox()
        if (!bounds) return Infinity
        return Math.max(
          Math.abs(bounds.x - x),
          Math.abs(bounds.y - y),
          Math.abs(bounds.width - width),
          Math.abs(bounds.height - height),
        )
      })
      .toBeLessThan(1)
  }

  await test.step('节点离屏后仍按各自的矩形显示，返回后草稿保留', async () => {
    await expect(field).toHaveText(draft)
    const before = (await node.boundingBox())!
    const panelBefore = (await editor.boundingBox())!
    const toolbarBefore = (await nodeToolbar.boundingBox())!
    const exits = [
      { edge: 'top', dx: 0, dy: Math.round(-before.y - before.height - 3) },
      { edge: 'right', dx: Math.round(1440 - before.x + 3), dy: 0 },
      { edge: 'left', dx: Math.round(-before.x - before.width - 3), dy: 0 },
      { edge: 'bottom', dx: 0, dy: Math.round(1000 - before.y + 3) },
    ] as const
    for (const { edge, dx, dy } of exits) {
      await pan(dx, dy)
      await expect(node).not.toBeInViewport()
      const moved = (await node.boundingBox())!
      expect(moved.x - before.x).toBeCloseTo(dx, 0)
      expect(moved.y - before.y).toBeCloseTo(dy, 0)
      await expectProjectedOverlay(editor, panelBefore, dx, dy)
      await expectProjectedOverlay(nodeToolbar, toolbarBefore, dx, dy)
      if (edge === 'top') {
        await expect(field).toHaveText(draft)
        await expectControlHit(field)
        await field.click()
        await field.fill(offscreenDraft)
        await expect(node).not.toBeInViewport()
      }
      if (edge === 'bottom') {
        await expectControlHit(nodeToolbar.getByRole('button', { name: '重命名节点', exact: true }))
      } else {
        await expect(field).toHaveText(offscreenDraft)
      }
      await page.screenshot({ path: testInfo.outputPath(`overlays-follow-with-node-offscreen-${edge}.png`) })
      await pan(-dx, -dy)
      await expect(node).toBeInViewport()
      await expectAttachedBelow()
      await expectFullSizeEditor()
      await expect(nodeToolbar).toBeVisible()
      await expect(field).toHaveText(offscreenDraft)
      await expect(referenceCount).toBeVisible()
    }
    await expectControlHit(field)
    await expectControlHit(model)
    await expectControlHit(generate)
    await expect(generate).toBeEnabled()
  })

  await test.step('画布缩放跨过旧的紧凑阈值时，编辑面板宽高保持不变', async () => {
    for (const zoom of [0.3, 0.18, 0.09, 1]) {
      await zoomCanvasAroundNode(page, node, zoom)
      await expectAttachedBelow()
      await expectFullSizeEditor()
      await expectControlHit(field)
      await expectControlHit(model)
      await expectControlHit(generate)
      if (zoom === 0.18) {
        await page.screenshot({ path: testInfo.outputPath('full-editor-at-18-percent-zoom.png') })
        const nodeAtZoom = (await node.boundingBox())!
        const initialCenter = nodeAtZoom.x + nodeAtZoom.width / 2
        const initialPanelTop = (await editor.boundingBox())!.y
        const panNodeCenterTo = async (center: number) => {
          const bounds = (await node.boundingBox())!
          await pan(Math.round(center - (bounds.x + bounds.width / 2)))
        }
        await panNodeCenterTo(1440 - editorSize.width / 2 - 6)
        await expectAttachedBelow()
        await expectFullSizeEditor()
        const fittingPanel = (await editor.boundingBox())!
        expect(1440 - fittingPanel.x - fittingPanel.width).toBeGreaterThan(0)
        expect(1440 - fittingPanel.x - fittingPanel.width).toBeLessThan(10)
        await page.screenshot({ path: testInfo.outputPath('centered-editor-near-right-edge-at-low-zoom.png') })

        await pan(125)
        await expect(node).toBeInViewport({ ratio: 0.99 })
        await expectAttachedBelow()
        await expectFullSizeEditor()
        const overflowingPanel = (await editor.boundingBox())!
        expect(overflowingPanel.x + overflowingPanel.width).toBeGreaterThan(1440)
        expect(overflowingPanel.y).toBeCloseTo(initialPanelTop, 0)
        await page.screenshot({ path: testInfo.outputPath('editor-clips-with-visible-node-on-right.png') })

        for (const edge of ['right', 'left'] as const) {
          const partialCenter = edge === 'right' ? 1440 + nodeAtZoom.width / 2 - 16 : 16 - nodeAtZoom.width / 2
          await panNodeCenterTo(partialCenter)
          await expect(node).toBeInViewport()
          await expectAttachedBelow()
          await expectFullSizeEditor()
          const [partialNode, clippedPanel] = await Promise.all([node.boundingBox(), editor.boundingBox()])
          if (!partialNode || !clippedPanel) throw new Error('节点部分在视口内时仍应存在编辑面板')
          await expect(nodeToolbar).toBeVisible()
          const center = partialNode.x + partialNode.width / 2
          if (edge === 'right') {
            expect(center).toBeGreaterThan(1440)
            expect(clippedPanel.x + clippedPanel.width).toBeGreaterThan(1440)
          } else {
            expect(center).toBeLessThan(0)
            expect(clippedPanel.x).toBeLessThan(0)
          }
          expect(clippedPanel.y).toBeCloseTo(initialPanelTop, 0)
          await expect
            .poll(() =>
              editor.evaluate((element) => {
                const { left, right, top, height } = element.getBoundingClientRect()
                const visibleCenter = (Math.max(0, left) + Math.min(window.innerWidth, right)) / 2
                return element.contains(document.elementFromPoint(visibleCenter, top + height / 2))
              }),
            )
            .toBe(true)
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440)
          expect(await page.evaluate(() => window.scrollX)).toBe(0)
          await page.screenshot({ path: testInfo.outputPath(`editor-centers-on-partial-node-at-${edge}.png`) })

          await panNodeCenterTo(initialCenter)
          await expectAttachedBelow()
        }
      }
      if (zoom === 0.09) {
        await test.step('9% 缩放下，浮层保持各自的裁切边界，返回时恢复', async () => {
          const normal = (await node.boundingBox())!
          const normalPanel = (await editor.boundingBox())!
          const normalToolbar = (await nodeToolbar.boundingBox())!
          expect(normal.y - normalToolbar.y - normalToolbar.height).toBeCloseTo(42, 0)
          const moveNodeTo = async (x: number, y: number) => {
            const bounds = (await node.boundingBox())!
            const dx = Math.round(x - bounds.x)
            const dy = Math.round(y - bounds.y)
            if (dy) await pan(0, dy)
            if (dx) await pan(dx)
          }
          const expectOverlaysAtNodePosition = async () => {
            const bounds = (await node.boundingBox())!
            const dx = bounds.x - normal.x
            const dy = bounds.y - normal.y
            await expectProjectedOverlay(editor, normalPanel, dx, dy)
            await expectProjectedOverlay(nodeToolbar, normalToolbar, dx, dy)
          }

          // 节点仍在视口内时，工具条可以自然越过顶部并被裁切。
          await moveNodeTo(normal.x, normal.y - normalToolbar.y - normalToolbar.height / 2)
          await expectAttachedBelow()
          await expectOverlaysAtNodePosition()
          const croppedToolbar = (await nodeToolbar.boundingBox())!
          expect(croppedToolbar.y).toBeLessThan(0)
          expect(croppedToolbar.y + croppedToolbar.height).toBeGreaterThan(0)
          await expect(nodeToolbar).toBeInViewport()
          await page.screenshot({ path: testInfo.outputPath('node-toolbar-cropped-at-top.png') })
          await moveNodeTo(normal.x, normal.y)

          const slivers = [
            { edge: 'left', x: 3 - normal.width, y: normal.y, leaveX: -6, leaveY: 0 },
            { edge: 'right', x: 1437, y: normal.y, leaveX: 6, leaveY: 0 },
            { edge: 'top', x: 1180, y: 3 - normal.height, leaveX: 0, leaveY: -6 },
            { edge: 'bottom', x: 220, y: 997, leaveX: 0, leaveY: 6 },
          ] as const
          for (const { edge, x, y, leaveX, leaveY } of slivers) {
            await moveNodeTo(x, y)
            await expect(node).toBeInViewport()
            const visibleNode = (await node.boundingBox())!
            const sliver = {
              left: visibleNode.x + visibleNode.width,
              right: 1440 - visibleNode.x,
              top: visibleNode.y + visibleNode.height,
              bottom: 1000 - visibleNode.y,
            }[edge]
            expect(sliver).toBeGreaterThan(2)
            expect(sliver).toBeLessThan(4)
            await expectOverlaysAtNodePosition()
            if (edge === 'left' || edge === 'right') {
              const toolbar = (await nodeToolbar.boundingBox())!
              const clippedPanel = (await editor.boundingBox())!
              const left = edge === 'left'
              expect(left ? clippedPanel.x : 1440 - clippedPanel.x - clippedPanel.width).toBeLessThan(0)
              expect(left ? toolbar.x : 1440 - toolbar.x - toolbar.width).toBeLessThan(0)
              await expect(editor).toBeInViewport()
              await expect(nodeToolbar).toBeInViewport()
            }
            await page.screenshot({ path: testInfo.outputPath(`overlays-follow-node-sliver-at-${edge}.png`) })

            await pan(leaveX, leaveY)
            await expect(node).not.toBeInViewport()
            await expectOverlaysAtNodePosition()
            if (edge === 'left' || edge === 'right') {
              await expect(editor).toBeInViewport()
              await expect(nodeToolbar).toBeInViewport()
            }
            await page.screenshot({ path: testInfo.outputPath(`remaining-overlay-after-${edge}-sliver-exits.png`) })

            const fartherX = leaveX * 80
            const fartherY = leaveY * 75
            await pan(fartherX, fartherY)
            await expect(editor).toBeHidden()
            await expect(nodeToolbar).toBeHidden()

            await pan(-fartherX, -fartherY)
            await moveNodeTo(normal.x, normal.y)
            await expectAttachedBelow()
            await expectOverlaysAtNodePosition()
            await expect(nodeToolbar).toBeVisible()
            await expect(field).toHaveText(offscreenDraft)
          }
        })
      }
    }
    await expect(field).toHaveText(offscreenDraft)
  })

  await reference.locator('.canvas-node-header').click()
  await expect(reference.getByText('编辑中', { exact: true })).toBeVisible()
  await node.locator('.canvas-node-header').click()
  await expect(field).toHaveText(offscreenDraft)
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
