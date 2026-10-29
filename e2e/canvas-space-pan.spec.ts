import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const panKey of ['Space', 'p']) {
  test(`按住${panKey}平移，松键恢复节点拖动，输入框保持正常编辑`, async ({ page }, testInfo) => {
    const api = await installStrictAuthenticatedApp(page)
    if (panKey !== 'Space')
      await page.addInitScript(() =>
        localStorage.setItem(
          'zzh_canvas_preferences',
          JSON.stringify({ shortcutsVersion: 3, shortcuts: { panHold: 'P' } }),
        ),
      )
    await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    let revision = 1
    await page.route('**/api/v1/canvases/126**', (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({ json: { revision: ++revision, sync_revision: revision } })
      }
      return route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? {
              elements: [
                {
                  element_id: 'text',
                  kind: 'node',
                  op: 'upsert',
                  payload: {
                    id: 'text',
                    type: 'text',
                    position: { x: 100, y: 100 },
                    style: { width: 300, height: 220 },
                    data: { kind: 'text', title: '空格拖动测试', text: '测试内容' },
                  },
                },
              ],
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 126, title: '空格抓手回归', revision },
      })
    })
    await page.goto('/canvas/126')
    const root = page.locator('.canvas-view')
    const node = page.locator('.react-flow__node[data-id="text"]')
    const viewport = page.locator('.react-flow__viewport')
    const hint = page.locator('.canvas-interaction-hint')
    const position = () => node.evaluate((el) => (el as HTMLElement).style.transform)
    const view = () => viewport.evaluate((el) => (el as HTMLElement).style.transform)
    await expect(node).toBeVisible()
    await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('100')
    await expect.poll(() => viewport.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)).toBe(1)
    const drag = async (selector: string) => {
      const box = await page.locator(selector).first().boundingBox()
      if (!box) throw new Error('拖动目标不可见')
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + 65, y + 35, { steps: 8 })
      await page.mouse.up()
    }
    await root.focus()
    await page.keyboard.press('h')
    await expect(hint).toContainText('已切换到抓手工具')
    await expect(hint).toContainText('选择工具')
    await page.keyboard.press('v')
    await expect(hint).toContainText('已切换到选择工具')
    const initialPosition = await position()
    for (const selector of ['.canvas-node-body', '.react-flow__handle']) {
      const before = await view()
      await page.keyboard.down(panKey)
      await expect(root).toHaveClass(/is-space-panning/)
      await expect(hint).toContainText('松开')
      await drag(selector)
      await expect.poll(view).not.toEqual(before)
      expect(await position()).toBe(initialPosition)
      await page.keyboard.up(panKey)
      await expect(root).not.toHaveClass(/is-space-panning/)
    }
    await drag('.canvas-node-body')
    await expect.poll(position).not.toEqual(initialPosition)
    // 选中节点后编辑面板会自动调整视口；以节点坐标变化和撤销验证恢复了节点拖动。
    await root.focus()
    await page.keyboard.press('Control+z')
    await expect.poll(position).toEqual(initialPosition)

    await node.locator('.canvas-node-body').dblclick()
    const editor = node.locator('textarea')
    await expect(editor).toBeFocused()
    await editor.fill('hello')
    await page.keyboard.press('End')
    await page.keyboard.press('Space')
    await expect(editor).toHaveValue('hello ')
    await expect(root).not.toHaveClass(/is-space-panning/)
    await root.focus()
    await page.keyboard.down(panKey)
    await expect(root).toHaveClass(/is-space-panning/)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(root).not.toHaveClass(/is-space-panning/)
    await page.keyboard.up(panKey)
    await page.screenshot({ path: testInfo.outputPath('space-pan-desktop.png') })
    await page.setViewportSize({ width: 760, height: 800 })
    await page.getByRole('button', { name: '复位视图', exact: true }).click()
    await expect
      .poll(async () => {
        const box = await node.boundingBox()
        return box ? Math.abs(box.x + box.width / 2 - 380) : Infinity
      })
      .toBeLessThan(5)
    await root.focus()
    const narrowBefore = await view()
    await page.keyboard.down(panKey)
    await drag('.canvas-node-body')
    await expect.poll(view).not.toEqual(narrowBefore)
    await page.screenshot({ path: testInfo.outputPath('space-pan-narrow.png') })
    await page.keyboard.up(panKey)
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
