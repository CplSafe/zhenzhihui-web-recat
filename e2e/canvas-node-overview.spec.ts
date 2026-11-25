import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('画布缩放时编辑面板保持屏幕尺寸，节点工具栏继续适配', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const viewportSize = { width: 1440, height: 900 }
  await page.setViewportSize(viewportSize)
  const api = await installStrictAuthenticatedApp(page)
  const originalPrompt = [
    '全局浏览时选中参考图片',
    '一条近海的弯路延伸到山脚。',
    '晨雾散开，礁石上泛起阳光。',
    '道路旁的杂草随风轻轻晃动。',
    '远处的山脊逐渐被云层遮住。',
    '保留画面中冷暖色彩的层次。',
  ].join('\n')
  const editedPrompt = '缩小和恢复后都保留这段提示词'
  const modelName = '图像总览测试模型'
  await page.route('**/api/v1/ai/tools**', (route) =>
    route.fulfill({
      json: {
        data: ['image.multi_angle', 'image.relight', 'image.panorama'].map((code) => ({
          code,
          display_name: code,
          execution: 'prompt_workflow',
          operation_code: code,
          model_version_ids: [71],
          version: 1,
        })),
      },
    }),
  )
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        items: [{ id: 71, display_name: modelName, capability: 'image', operation_codes: ['image.text_to_image'] }],
      },
    }),
  )
  let revision = 1
  let savedPrompt = originalPrompt
  const image = {
    element_id: 'overview-image',
    kind: 'node',
    payload: {
      id: 'overview-image',
      type: 'image',
      position: { x: 300, y: 180 },
      style: { width: 320, height: 240 },
      data: {
        kind: 'image',
        title: '总览图片',
        prompt: originalPrompt,
        modelVersionId: 71,
        assetId: 501,
        assetWorkspaceId: WORKSPACE_ID,
        resultUrl: '/t1test.png',
        resultHistory: [{ assetId: 501, kind: 'image', resultUrl: '/t1test.png' }],
      },
    },
  }
  await page.route(/\/api\/v1\/canvases\/245(?:\/(?:elements|node-locks|members))?(?:\?.*)?$/, (route) => {
    const { pathname, searchParams } = new URL(route.request().url())
    if (pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
    if (pathname.endsWith('/members')) {
      return route.fulfill({
        json: { creator_id: 7, can_manage: true, member_user_ids: [], members_restricted: false },
      })
    }
    if (route.request().method() === 'PATCH') {
      const { mutations } = route.request().postDataJSON() as {
        mutations: { element_id: string; payload?: { data?: { prompt?: string } } }[]
      }
      const prompt = mutations.find((mutation) => mutation.element_id === image.element_id)?.payload?.data?.prompt
      if (typeof prompt === 'string') savedPrompt = prompt
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    if (pathname.endsWith('/elements')) {
      return route.fulfill({
        json: {
          elements: Number(searchParams.get('after_revision')) > 0 ? [] : [image],
          sync_revision: revision,
          history_floor_revision: 0,
          has_more: false,
        },
      })
    }
    return route.fulfill({ json: { id: 245, title: '低倍率节点交互', revision } })
  })
  await page.route('**/api/v1/assets/501/download?**', (route) =>
    route.fulfill({ path: 'public/t1test.png', contentType: 'image/png' }),
  )

  await page.goto('/canvas/245')
  const flow = page.locator('.react-flow')
  const node = flow.locator('.react-flow__node[data-id="overview-image"]')
  const viewport = flow.locator('.react-flow__viewport')
  const toolbar = page.getByRole('toolbar', { name: '节点操作', exact: true })
  const panelArea = page.locator('.canvas-panel-area')
  const panel = panelArea.locator('[data-canvas-node-panel]')
  const editor = panel.getByRole('textbox')
  const model = panel.getByRole('button', { name: modelName, exact: true })
  const make = panel.locator('[data-canvas-generate]')
  const editAtOverview = page.getByRole('button', { name: '放大编辑', exact: true })
  const menu = page.getByRole('listbox', { name: '生成模型列表' })
  const readZoom = () => viewport.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)
  const viewportStyle = () => viewport.evaluate((element) => getComputedStyle(element).transform)
  const zoomTo = async (target: number) => {
    const bounds = (await node.boundingBox())!
    const clientX = bounds.x + bounds.width / 2
    const clientY = bounds.y + bounds.height / 2
    // Wheel zoom limits each event to a small step, so approach the target around the same node center.
    for (let step = 0; step < 30; step++) {
      const current = await readZoom()
      if (Math.abs(target - current) < 0.0001) break
      const next = Math.max(current / 1.11, Math.min(target, current * 1.11))
      await flow.dispatchEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaMode: 0,
        deltaY: Math.log2(current / next) / 0.002,
        clientX,
        clientY,
      })
      await expect.poll(readZoom).toBeCloseTo(next, 4)
    }
    await expect.poll(readZoom).toBeCloseTo(target, 3)
    await expect(node).toBeInViewport()
  }
  const expectEditor = async (prompt: string) => {
    await expect(node).toHaveClass(/selected/)
    await expect(toolbar).toBeVisible()
    await expect(editor).toHaveAttribute('data-value', prompt)
    await expect(editor).toBeVisible()
    await expect(panelArea).toBeInViewport({ ratio: 0.99 })
    await expect(model).toBeInViewport({ ratio: 0.99 })
    await expect(make).toBeInViewport({ ratio: 0.99 })
    await expect(make).toBeEnabled()
    await expect(editAtOverview).toHaveCount(0)
  }
  const editorSizes = async () =>
    Promise.all(
      [panel, editor, model, make].map(async (item) => {
        const { width, height } = (await item.boundingBox())!
        return [width, height]
      }),
    )
  const expectEditorSizes = async (baseline: number[][]) => {
    await expect
      .poll(async () => {
        const current = await editorSizes()
        return Math.max(
          ...current.flatMap((size, index) => size.map((value, dim) => Math.abs(value - baseline[index][dim]))),
        )
      })
      .toBeLessThanOrEqual(1)
  }

  await expect(node).toBeInViewport()
  await zoomTo(1)
  const nodeBox = (await node.boundingBox())!
  // Leave room underneath the node at each zoom so only the editor's scale is being compared.
  const panX = viewportSize.width - 30
  const panY = viewportSize.height / 2
  const offsetY = 235 - nodeBox.y - nodeBox.height / 2
  await page.mouse.move(panX, panY)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(panX, panY + offsetY, { steps: 8 })
  await page.mouse.up({ button: 'middle' })
  const beforeSelection = await viewportStyle()
  await node.locator('.canvas-node-body').click()
  await expectEditor(originalPrompt)
  expect(await viewportStyle()).toBe(beforeSelection)
  const originalSizes = await editorSizes()
  const fullToolbarWidth = (await toolbar.boundingBox())!.width

  await zoomTo(0.08)
  await expectEditor(originalPrompt)
  await expectEditorSizes(originalSizes)
  await expect(toolbar).toHaveAttribute('data-toolbar-density', 'compact')
  expect((await toolbar.boundingBox())!.width).toBeLessThan(fullToolbarWidth)
  const compactViewport = await viewportStyle()
  await page.screenshot({ path: testInfo.outputPath('node-overview-8-percent.png') })

  const moreActions = toolbar.getByRole('button', { name: '更多', exact: true })
  const actionMenu = page.getByRole('menu', { name: '更多节点操作', exact: true })
  await moreActions.click()
  await expect(actionMenu).toBeInViewport()
  await expect(actionMenu.getByRole('menuitem', { name: /多角度|打光|全景/ }).first()).toBeVisible()
  await moreActions.click()
  await expect(actionMenu).toBeHidden()

  await editor.click()
  await expect(editor).toBeFocused()
  await editor.fill(editedPrompt)
  await expect(editor).toHaveAttribute('data-value', editedPrompt)
  await expect.poll(() => savedPrompt).toBe(editedPrompt)
  await model.click()
  await expect(menu).toBeInViewport()
  await menu.getByRole('option', { name: new RegExp(modelName) }).click()
  await expect(menu).toBeHidden()
  expect(await viewportStyle()).toBe(compactViewport)
  const editedSizes = await editorSizes()

  await zoomTo(0.25)
  await expectEditor(editedPrompt)
  await expectEditorSizes(editedSizes)
  await expect(toolbar).toHaveAttribute('data-toolbar-density', 'reduced')
  await page.screenshot({ path: testInfo.outputPath('node-overview-25-percent.png') })

  await zoomTo(1)
  await expectEditor(editedPrompt)
  await expectEditorSizes(editedSizes)
  await expect(toolbar).toHaveAttribute('data-toolbar-density', 'normal')
  await page.screenshot({ path: testInfo.outputPath('node-overview-100-percent.png') })

  const beforeDeselect = await viewportStyle()
  await flow.locator('.react-flow__pane').click({ position: { x: 130, y: 180 } })
  await expect(node).not.toHaveClass(/selected/)
  await expect(toolbar).toBeHidden()
  await expect(panelArea).toBeHidden()
  expect(await viewportStyle()).toBe(beforeDeselect)
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
