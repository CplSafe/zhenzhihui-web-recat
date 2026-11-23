import { expect, test } from '@playwright/test'
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
    const toolbar = page.getByRole('toolbar', { name: '节点操作', exact: true })
    const panel = page.locator('.canvas-panel-area')
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
    await toolbar.getByRole('button', { name: '重命名节点' }).click()
    await expectFullTitleSelection(titleAfterDoubleClick)
    await page.screenshot({ path: testInfo.outputPath('rename-title-selected.png') })
    await replaceTitle(titleAfterToolbar)

    // 平移画布，使选中节点完全离开可视区；关联工具栏和面板应随之隐藏。
    const paneBounds = await page.locator('.react-flow').boundingBox()
    if (!paneBounds) throw new Error('画布缺少可视区域')
    const dragY = paneBounds.y + paneBounds.height * 0.75
    await page.mouse.move(paneBounds.x + paneBounds.width - 24, dragY)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(paneBounds.x + 8, dragY, { steps: 10 })
    await page.mouse.up({ button: 'middle' })
    await expect(toolbar).toHaveCount(0)
    await expect(panel).toHaveCSS('visibility', 'hidden')
    await page.screenshot({ path: testInfo.outputPath('selected-node-offscreen-controls-hidden.png') })

    // 把视口平移回来，确认两组控件可以恢复。
    await page.mouse.move(paneBounds.x + 8, dragY)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(paneBounds.x + paneBounds.width - 24, dragY, { steps: 10 })
    await page.mouse.up({ button: 'middle' })
    await expect(toolbar).toBeVisible()
    await expect(panel).toHaveCSS('visibility', 'visible')

    await page.reload()
    await expect(title).toHaveText(titleAfterToolbar)
    await expect(thumbnail).toHaveJSProperty('naturalWidth', 250)
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
