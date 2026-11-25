import { expect, test, type Locator } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 760]) {
  test(`生成结果节点标题、重命名与关联控件 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    const originalImageTitle = '雨夜街口的蓝色霓虹灯下车窗积水倒影与远处撑伞行人的剪影'
    const titleAfterDoubleClick = '分镜一号：凌晨车站月台积水倒影与夜班列车抵达时的主体特写'
    const titleAfterToolbar = '图片定稿'
    let savedImage = { title: originalImageTitle, assetId: 701 }
    let revision = 1
    await page.route('**/api/v1/assets/701/{stream,download}**', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250"><rect width="250" height="250" fill="#dbeafe"/></svg>',
      }),
    )
    await page.route('**/api/v1/canvases/112**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'PATCH') {
        const { mutations } = route.request().postDataJSON() as {
          mutations?: { element_id: string; op: string; payload?: { data?: typeof savedImage } }[]
        }
        const imageData = mutations?.find((mutation) => mutation.element_id === 'image' && mutation.op === 'upsert')
          ?.payload?.data
        if (imageData) savedImage = imageData
        return route.fulfill({ json: { sync_revision: ++revision } })
      }
      const elements = ['image', 'video'].map((kind, index) => ({
        element_id: kind,
        kind: 'node',
        op: 'upsert',
        payload: {
          id: kind,
          type: kind,
          position: { x: 100 + index * 360, y: 100 },
          style: { width: 250, height: 250 },
          data: {
            kind,
            ...(kind === 'image' ? savedImage : { title: 'video生成结果', assetId: 701 }),
            taskStatus: 'succeeded',
            resultHistory: [{ assetId: 701 }],
          },
        },
      }))
      await route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : elements,
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 112, title: '节点标题验收', status: 'active', revision },
      })
    })
    await page.route('**/api/v1/canvases/112/node-locks**', (route) =>
      route.fulfill({ json: { granted: true, nodes: {} } }),
    )
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { items: [] } }))
    await page.goto('/canvas/112')
    const image = page.locator('.react-flow__node[data-id="image"]')
    const thumbnail = image.locator('.canvas-node-body img')
    const title = image.locator('.ie-display.canvas-node-header__label')
    await expect(page.locator('.canvas-node-header')).toHaveCount(2)
    await expect(title).toHaveText(originalImageTitle)
    await expect(thumbnail).toHaveJSProperty('naturalWidth', 250)
    await expect(page.locator('.canvas-node-header__label').filter({ hasText: 'video生成结果' })).toBeVisible()
    await expect(page.locator('.canvas-node-header__done')).toHaveCount(0)
    const viewport = page.locator('.react-flow__viewport')
    const flow = page.locator('.react-flow')
    const flowBox = await flow.boundingBox()
    if (!flowBox) throw new Error('画布缺少可视区域')
    const readZoom = () => viewport.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)
    for (let step = 0; step < 20; step++) {
      const zoom = await readZoom()
      if (zoom <= 0.2501) break
      await flow.dispatchEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaMode: 0,
        deltaY: Math.min(80, Math.log2(zoom / 0.25) / 0.002),
        clientX: flowBox.x + flowBox.width / 2,
        clientY: flowBox.y + flowBox.height / 2,
      })
      await expect.poll(readZoom).toBeLessThan(zoom)
    }
    await expect.poll(readZoom).toBeCloseTo(0.25, 2)
    const titleFontSize = await page
      .locator('.canvas-node-header__label')
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    expect(titleFontSize * 0.25).toBeCloseTo(12, 1)
    await page.screenshot({ path: testInfo.outputPath('node-titles-readable-at-25-percent.png') })
    await image.click()
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
    const toolbar = page.locator('[data-canvas-node-toolbar]')
    const panel = page.locator('.canvas-panel-area')
    const renameAction = toolbar.getByRole('button', { name: '重命名节点', exact: true })
    const centerX = (locator: Locator) =>
      locator.evaluate((element) => {
        const { left, width } = element.getBoundingClientRect()
        return left + width / 2
      })
    await expect(toolbar).toBeVisible()
    await expect(panel).toHaveCSS('visibility', 'visible')

    const rename = image.locator('input.canvas-node-header__label')
    const expectFullTitleSelection = async (currentTitle: string) => {
      await expect(rename).toBeFocused()
      await expect
        .poll(() =>
          rename.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd, element.value]),
        )
        .toEqual([0, currentTitle.length, currentTitle])
    }
    const replaceTitle = async (nextTitle: string) => {
      await page.keyboard.type(nextTitle)
      await expect(rename).toHaveValue(nextTitle)
      await page.keyboard.press('Enter')
      await expect(title).toHaveText(nextTitle)
      await expect.poll(() => savedImage).toMatchObject({ title: nextTitle, assetId: 701 })
    }
    expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    await title.dblclick()
    await expectFullTitleSelection(originalImageTitle)
    await replaceTitle(titleAfterDoubleClick)
    expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    await renameAction.click()
    await expectFullTitleSelection(titleAfterDoubleClick)
    await page.screenshot({ path: testInfo.outputPath('rename-title-selected.png') })
    await replaceTitle(titleAfterToolbar)

    const [nodeBounds, toolbarBounds, panelBounds] = await Promise.all([
      image.boundingBox(),
      toolbar.boundingBox(),
      panel.boundingBox(),
    ])
    if (!nodeBounds || !toolbarBounds || !panelBounds) throw new Error('缺少节点或浮层尺寸')
    const initialCenter = nodeBounds.x + nodeBounds.width / 2
    const edge = flowBox.x
    const horizontalPan = () =>
      viewport.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).e)
    const panToCenter = async (target: number) => {
      const delta = Math.round(target - (await centerX(image)))
      const startX = delta < 0 ? edge + flowBox.width - 24 : edge + 24
      const y = flowBox.y + flowBox.height * 0.22
      const before = await horizontalPan()
      await page.mouse.move(startX, y)
      await page.mouse.down({ button: 'middle' })
      await page.mouse.move(startX + delta, y, { steps: 10 })
      await page.mouse.up({ button: 'middle' })
      await expect.poll(horizontalPan).toBeCloseTo(before + delta, 0)
    }
    const expectAligned = async (overlay: Locator) => {
      await expect.poll(async () => Math.abs((await centerX(overlay)) - (await centerX(image)))).toBeLessThanOrEqual(1)
    }

    // 节点先移出左侧，两个浮层仍按自己的边界逐步裁切。
    const justOutside = edge - nodeBounds.width / 2 - 12
    const betweenOverlayEdges = edge - (toolbarBounds.width + panelBounds.width) / 4
    await panToCenter(justOutside)
    await expect(image).not.toBeInViewport()
    await expect(image).toHaveClass(/selected/)
    for (const overlay of [toolbar, panel]) {
      await expect(overlay).toBeInViewport()
      await expect(overlay).not.toBeInViewport({ ratio: 0.99 })
      await expectAligned(overlay)
    }
    await page.screenshot({ path: testInfo.outputPath('selected-node-offscreen-controls-clipped.png') })

    await panToCenter(betweenOverlayEdges)
    await expect(toolbar).not.toBeInViewport()
    await expect(toolbar).toBeHidden()
    await expect(panel).toBeInViewport()
    await expectAligned(panel)
    await page.screenshot({ path: testInfo.outputPath('selected-node-offscreen-only-editor-visible.png') })

    await panToCenter(edge - panelBounds.width / 2 - 12)
    for (const overlay of [toolbar, panel]) {
      await expect(overlay).not.toBeInViewport()
      await expect(overlay).toBeHidden()
    }

    // 把节点平移回来，确认两个浮层重新对齐节点且重命名结果仍在。
    await panToCenter(justOutside)
    await expect(toolbar).toBeInViewport()
    await expect(panel).toBeInViewport()
    await panToCenter(initialCenter)
    await expect(image).toBeInViewport()
    await expect(toolbar).toBeVisible()
    await expect(panel).toBeVisible()
    await expect(panel).toBeInViewport()
    await expectAligned(toolbar)
    await expectAligned(panel)
    await expect(title).toHaveText(titleAfterToolbar)
    await page.screenshot({ path: testInfo.outputPath('selected-node-back-in-view-controls-restored.png') })

    await page.reload()
    await expect(title).toHaveText(titleAfterToolbar)
    await expect(thumbnail).toHaveJSProperty('naturalWidth', 250)
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
