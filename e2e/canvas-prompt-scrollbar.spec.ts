import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const viewports = [
  { width: 1440, height: 900 },
  { width: 390, height: 640 },
]

for (const viewport of viewports) {
  test(`长提示词滚动条 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await installStrictAuthenticatedApp(page)
    const wheelMode = viewport.width === 1440 ? 'zoom' : 'pan'
    await page.addInitScript(
      (wheelMode) => localStorage.setItem('zzh_canvas_preferences', JSON.stringify({ wheelMode })),
      wheelMode,
    )
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
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
                        type: 'video',
                        position: { x: 300, y: 250 },
                        style: { width: 320, height: 240 },
                        data: { kind: 'video', prompt: '一段需要编辑的长提示词' },
                      },
                    },
                  ],
                  sync_revision: 1,
                  history_floor_revision: 0,
                  has_more: false,
                }
              : { id: 119, title: '提示词编辑检查', revision: 1 },
      }),
    )
    await page.route('**/api/v1/canvases/119/node-locks**', (route) =>
      route.fulfill({ json: { granted: true, nodes: {} } }),
    )
    await page.goto('/canvas/119')
    const node = page.locator('.react-flow__node[data-id="source"]')
    await node.click()
    const panel = page.locator('[data-canvas-node-panel]')
    const editor = panel.getByRole('textbox')
    const canvasViewport = page.locator('.react-flow__viewport')
    const transform = () => canvasViewport.evaluate((element) => getComputedStyle(element).transform)
    const zoom = () => canvasViewport.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)
    const scrollTop = () => editor.evaluate((element) => element.scrollTop)
    const wheelAndWait = async (deltaY: number) => {
      const wheelReceived = page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            window.addEventListener(
              'wheel',
              () => requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              {
                capture: true,
                once: true,
              },
            ),
          ),
      )
      await page.mouse.wheel(0, deltaY)
      await wheelReceived
    }
    const expectCanvasWheel = async () => {
      const before = await transform()
      const beforeZoom = await zoom()
      await wheelAndWait(42)
      await expect.poll(transform).not.toBe(before)
      if (wheelMode === 'zoom') expect(await zoom()).toBeLessThan(beforeZoom)
      else expect(await zoom()).toBe(beforeZoom)
    }
    await expect(editor).toBeVisible()
    await expect(editor).not.toBeFocused()
    await panel.locator('[data-canvas-node-panel-actions]').getByText('—', { exact: true }).hover()
    await expectCanvasWheel()
    await expect(node).toHaveClass(/selected/)
    // Native typing and controlled Enter insertions must keep the active caret visible.
    await editor.fill('')
    for (let line = 0; line < 12; line += 1) {
      await editor.pressSequentially(`画面描述${line}`)
      await editor.press('Enter')
    }
    const caretVisible = () =>
      editor.evaluate((element) => {
        const selection = window.getSelection()!
        const range = selection.getRangeAt(0).cloneRange()
        range.collapse(false)
        let caret = range.getBoundingClientRect()
        if (!caret.height) caret = element.querySelector('[data-caret-end]')!.getBoundingClientRect()
        const bounds = element.getBoundingClientRect()
        return caret.height > 0 && caret.top >= bounds.top - 1 && caret.bottom <= bounds.bottom + 1
      })
    await expect.poll(caretVisible).toBe(true)
    await expect.poll(() => editor.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await editor.press('Control+Home')
    await editor.press('Enter')
    await expect.poll(caretVisible).toBe(true)
    await expect.poll(() => editor.evaluate((element) => element.scrollTop)).toBeLessThan(24)
    await editor.press('Control+End')
    await editor.pressSequentially('末尾继续输入')
    await expect.poll(caretVisible).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('caret-follow.png'), caret: 'initial' })
    const longPrompt = Array.from(
      { length: 30 },
      (_, index) => `第${index + 1}行：视频画面与人物动作的详细描述。`,
    ).join('')
    await editor.fill(longPrompt)
    await expect.poll(() => editor.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await editor.blur()
    await expect(editor).not.toBeFocused()
    await editor.evaluate((element) => {
      element.scrollTop = 0
    })
    await editor.hover()
    await expectCanvasWheel()
    expect(await scrollTop()).toBe(0)

    await editor.click()
    await expect(editor).toBeFocused()
    await editor.evaluate((element) => {
      element.scrollTop = 0
    })
    const beforePromptScroll = await transform()
    await wheelAndWait(120)
    await expect.poll(scrollTop).toBeGreaterThan(0)
    expect(await transform()).toBe(beforePromptScroll)
    const panelContent = panel.locator('[data-canvas-node-panel-body]')
    const bodyScrollTop = () => panelContent.evaluate((element) => element.scrollTop)
    const beforeBoundaryScroll = await bodyScrollTop()
    for (const boundary of ['top', 'bottom'] as const) {
      const boundaryScroll = await editor.evaluate((element, boundary) => {
        element.scrollTop = boundary === 'top' ? 0 : element.scrollHeight
        return element.scrollTop
      }, boundary)
      await wheelAndWait(boundary === 'top' ? -120 : 120)
      expect(await scrollTop()).toBe(boundaryScroll)
      expect(await bodyScrollTop()).toBe(beforeBoundaryScroll)
      expect(await transform()).toBe(beforePromptScroll)
    }
    await expect(editor).toHaveText(longPrompt)
    await page.screenshot({ path: testInfo.outputPath('long-prompt-scrollbar.png') })
    await page.locator('.react-flow__pane').hover({ position: { x: 20, y: 160 } })
    await expect(editor).toBeFocused()
    await expectCanvasWheel()
    await expect(node).toHaveClass(/selected/)
    if (viewport.width === 390) {
      const panelBox = (await panelContent.boundingBox())!
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewport.height)
      const panelLabel = panel.getByText('请选择模型以查看素材限制')
      await panelLabel.click()
      await expect(panelContent).toBeFocused()
      await panelContent.evaluate((element) => {
        element.scrollTop = 0
      })
      await panelLabel.hover()
      const beforePanelScroll = await transform()
      await page.mouse.wheel(0, 600)
      await expect.poll(() => panelContent.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      expect(await transform()).toBe(beforePanelScroll)
      const expandBox = (await panel.getByTitle('放大输入框').boundingBox())!
      expect(expandBox.y + expandBox.height).toBeLessThanOrEqual(viewport.height)
      await page.screenshot({ path: testInfo.outputPath('panel-bottom.png') })
    }
    await panel.getByTitle('放大输入框').click()
    const dialog = page.getByRole('dialog', { name: '编辑提示词' })
    await expect(dialog.getByRole('textbox')).toHaveText(longPrompt)
    await page.keyboard.press('Escape')
    await expect(panel).toBeVisible()
  })
}

for (const viewport of viewports) {
  test(`视频参考素材和长提示词可滚动，底部制作操作完整可点 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    const videoModel = {
      id: 121,
      display_name: '视频制作测试模型',
      operation_codes: ['video.generate'],
      input_constraints: {
        'video.generate': {
          roles: [
            { role: 'reference_image', max_count: 9 },
            { role: 'audio', max_count: 2 },
          ],
        },
      },
      params_schema: { fields: [{ name: 'duration', display_name: '时长', options: [5, 10], default: 5 }] },
    }
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: {
          items: [
            videoModel,
            ...Array.from({ length: 15 }, (_, index) => ({
              ...videoModel,
              id: videoModel.id + index + 1,
              display_name: `备用视频模型 ${index + 1}`,
            })),
          ],
        },
      }),
    )
    await page.route('**/api/v1/ai/tasks/estimate-cost', (route) =>
      route.fulfill({ json: { estimated_cost: 10, balance: 1000, can_afford: true } }),
    )
    const references = [
      ...Array.from({ length: 7 }, (_, index) => ({ kind: 'image', title: `场景参考 ${index + 1}` })),
      { kind: 'audio', title: '角色甲旁白' },
      { kind: 'audio', title: '角色乙旁白' },
    ].map((reference, index) => ({ ...reference, id: `ref-${index}`, assetId: 800 + index }))
    const prompt = Array.from(
      { length: 20 },
      (_, index) => `第 ${index + 1} 个镜头，说明人物动作、对话、环境、画面构图与镜头变化。`,
    ).join('\n')
    const elements = [
      {
        element_id: 'video',
        kind: 'node',
        payload: {
          id: 'video',
          type: 'video',
          position: { x: 575, y: 170 },
          style: { width: 320, height: 250 },
          data: { kind: 'video', title: '视频制作', modelVersionId: 121, videoMode: 'auto', prompt },
        },
      },
      ...references.map(({ id, kind, title, assetId }, index) => ({
        element_id: id,
        kind: 'node',
        payload: {
          id,
          type: kind,
          position: { x: 50 + (index % 2) * 190, y: 30 + Math.floor(index / 2) * 98 },
          style: { width: 170, height: 86 },
          data: {
            kind,
            title,
            assetId,
            assetWorkspaceId: WORKSPACE_ID,
            resultUrl: kind === 'image' ? '/t1test.png' : '/t1test.mp4?fixture=audio',
            ...(kind === 'audio' ? { audio: { durationSec: 2, inSec: 0, outSec: 2 } } : {}),
          },
        },
      })),
      ...references.map(({ id }, slotIndex) => ({
        element_id: `edge-${id}`,
        kind: 'edge',
        payload: { id: `edge-${id}`, source: id, target: 'video', data: { slotIndex } },
      })),
    ]
    await page.route(/\/api\/v1\/canvases\/242(?:\/(?:elements|node-locks|members))?(?:\?.*)?$/, (route) => {
      const { pathname, searchParams } = new URL(route.request().url())
      if (pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
      if (pathname.endsWith('/members')) {
        return route.fulfill({
          json: { creator_id: 7, can_manage: true, member_user_ids: [], members_restricted: false },
        })
      }
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
      if (pathname.endsWith('/elements')) {
        return route.fulfill({
          json: {
            elements: Number(searchParams.get('after_revision')) > 0 ? [] : elements,
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          },
        })
      }
      return route.fulfill({ json: { id: 242, title: '视频面板底部检查', revision: 1 } })
    })

    await page.goto('/canvas/242')
    const node = page.locator('.react-flow__node[data-id="video"]')
    await expect(node).toBeInViewport()
    const nodeBox = (await node.boundingBox())!
    const targetCenter = viewport.height / 2
    const delta = targetCenter - nodeBox.y - nodeBox.height / 2
    const dragY = delta >= 0 ? 90 : viewport.height - 90
    await page.mouse.move(viewport.width - 30, dragY)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(viewport.width - 30, dragY + delta, { steps: 8 })
    await page.mouse.up({ button: 'middle' })
    await expect
      .poll(async () => {
        const box = (await node.boundingBox())!
        return Math.abs(box.y + box.height / 2 - targetCenter)
      })
      .toBeLessThan(4)
    const transform = () =>
      page.locator('.react-flow__viewport').evaluate((element) => getComputedStyle(element).transform)
    const beforeSelection = await transform()
    await node.locator('.canvas-node-header').click()

    const panel = page.locator('[data-canvas-node-panel]')
    const body = panel.locator('[data-canvas-node-panel-body]')
    const footer = panel.locator('[data-canvas-node-panel-actions]')
    const model = footer.getByRole('button', { name: '视频制作测试模型', exact: true })
    const parameters = footer.getByRole('button', { name: /5秒/ })
    const style = footer.getByRole('button', { name: '风格库' })
    const make = footer.locator('[data-canvas-generate]')
    await expect(panel.getByRole('textbox')).toHaveAttribute('data-value', prompt)
    await expect(panel.getByRole('button', { name: '删除图片参考', exact: true })).toHaveCount(7)
    await expect(panel.getByRole('button', { name: '删除音频参考', exact: true })).toHaveCount(2)
    await expect(make).toBeEnabled()

    const expectFooterAccessible = async () => {
      await expect(footer).toBeInViewport({ ratio: 0.99 })
      for (const button of [model, parameters, style, make]) {
        await expect(button).toBeInViewport({ ratio: 0.99 })
        await expect
          .poll(() =>
            button.evaluate((element) => {
              const bounds = element.getBoundingClientRect()
              const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
              return element.contains(target)
            }),
          )
          .toBe(true)
      }
    }
    await expectFooterAccessible()
    const hoverBody = async () => {
      const bodyBounds = (await body.boundingBox())!
      await page.mouse.move(bodyBounds.x + 4, bodyBounds.y + bodyBounds.height / 2)
    }
    const bodyScroll = () => body.evaluate((element) => element.scrollTop)
    await expect(body).not.toBeFocused()
    await expect.poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await hoverBody()
    await page.mouse.wheel(0, 40)
    await expect.poll(transform).not.toBe(beforeSelection)
    expect(await bodyScroll()).toBe(0)
    await hoverBody()
    await page.mouse.wheel(0, -40)
    await expect.poll(transform).toBe(beforeSelection)

    await body.focus()
    await expect(body).toBeFocused()
    const initialFooterBounds = await footer.boundingBox()
    await hoverBody()
    await page.mouse.wheel(0, 500)
    await expect.poll(bodyScroll).toBeGreaterThan(0)
    await expectFooterAccessible()
    expect(await footer.boundingBox()).toEqual(initialFooterBounds)
    expect(await transform()).toBe(beforeSelection)
    await page.screenshot({ path: testInfo.outputPath('video-panel-footer.png') })

    const modelBounds = (await model.boundingBox())!
    await page.mouse.click(modelBounds.x + modelBounds.width / 2, modelBounds.y + modelBounds.height / 2)
    const menu = page.getByRole('listbox', { name: '生成模型列表' })
    await expect(menu).toBeVisible()
    await menu.evaluate((element) => {
      element.scrollTop = 0
    })
    await menu.hover()
    await page.mouse.wheel(0, 400)
    await expect.poll(() => menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    expect(await transform()).toBe(beforeSelection)

    if (viewport.width === 1440) {
      await test.step('44% 缩放下空提示词错误不会撑出横向滚动条', async () => {
        await menu.getByRole('option', { name: /视频制作测试模型/ }).click()
        await expect(menu).toBeHidden()
        const flow = page.locator('.react-flow')
        const readZoom = () =>
          flow
            .locator('.react-flow__viewport')
            .evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)
        const nodeBounds = (await node.boundingBox())!
        const targetZoom = 0.44
        for (let step = 0; step < 20; step++) {
          const current = await readZoom()
          if (Math.abs(current - targetZoom) < 0.0001) break
          const next = Math.max(current / 1.11, Math.min(targetZoom, current * 1.11))
          await flow.dispatchEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: Math.log2(current / next) / 0.002,
            clientX: nodeBounds.x + nodeBounds.width / 2,
            clientY: nodeBounds.y + nodeBounds.height / 2,
          })
          await expect.poll(readZoom).toBeCloseTo(next, 4)
        }
        await expect.poll(readZoom).toBeCloseTo(targetZoom, 3)

        const at44Percent = await transform()
        const promptField = panel.getByRole('textbox')
        await promptField.fill('')
        const error = panel
          .getByRole('alert')
          .filter({ hasText: '请输入视频描述后再生成；仅连接图片或音频仍需要文字描述' })
        await expect(error).toBeVisible()
        await error.scrollIntoViewIfNeeded()
        await expect(make).toBeDisabled()
        await expect
          .poll(() => body.evaluate((element) => element.scrollWidth - element.clientWidth))
          .toBeLessThanOrEqual(0)
        await expect(body).toHaveCSS('overflow-x', 'hidden')
        await expectFooterAccessible()
        expect(await transform()).toBe(at44Percent)
        await page.screenshot({ path: testInfo.outputPath('video-panel-empty-prompt-44-percent.png') })

        await model.click()
        await expect(menu).toBeVisible()
        await menu.getByRole('option', { name: /视频制作测试模型/ }).click()
        await expect(menu).toBeHidden()
        await promptField.fill('沿用参考素材继续制作')
        await expect(error).toBeHidden()
        await expect(make).toBeEnabled()
        expect(await transform()).toBe(at44Percent)
      })
    }
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
