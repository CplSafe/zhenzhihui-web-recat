import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 900]) {
  test(`Ctrl 组合键连线、副本和撤销，旧默认升级并保留输入焦点 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
    await page.addInitScript(() =>
      localStorage.setItem(
        'zzh_canvas_preferences',
        JSON.stringify({
          wheelMode: 'pan',
          shortcuts: { connect: 'L', duplicate: 'Shift+D', add: 'N', fitView: '1' },
        }),
      ),
    )
    let revision = 1
    const mutations: Array<{ kind: string; payload?: { source?: string; target?: string } }> = []
    await page.route('**/api/v1/canvases/128**', (route) => {
      if (route.request().method() === 'PATCH') {
        mutations.push(...(route.request().postDataJSON().mutations || []))
        return route.fulfill({ json: { revision: ++revision, sync_revision: revision } })
      }
      const url = new URL(route.request().url())
      if (Number(url.searchParams.get('after_revision')) > 0) {
        return route.fulfill({
          json: { elements: [], sync_revision: revision, history_floor_revision: 0, has_more: false },
        })
      }
      return route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? {
              elements: ['A', 'B'].map((id, index) => ({
                element_id: id,
                kind: 'node',
                op: 'upsert',
                payload: {
                  id,
                  type: 'text',
                  position: { x: 100 + index * 400, y: 100 },
                  style: { width: 250, height: 180 },
                  data: { kind: 'text', title: id, text: `节点${id}` },
                },
              })),
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 128, title: '组合键回归', revision },
      })
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/canvas/128')
    const root = page.locator('.canvas-view')
    const nodes = page.locator('.react-flow__node')
    const edges = page.locator('.react-flow__edge')
    await expect(nodes).toHaveCount(2)
    await root.focus()
    await page.keyboard.press('Control+a')
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
    await page.keyboard.press('l')
    await expect(edges).toHaveCount(1)
    await page.keyboard.press('Control+l')
    await expect(edges).toHaveCount(1)
    await expect
      .poll(() => mutations.some((m) => m.kind === 'edge' && m.payload?.source === 'A' && m.payload.target === 'B'))
      .toBe(true)
    await page.keyboard.press('Control+d')
    await expect(nodes).toHaveCount(4)
    // 截图约定：Ctrl+D 同时复制选中节点之间的连线。
    await expect(edges).toHaveCount(2)
    await page.keyboard.press('Control+z')
    await expect(nodes).toHaveCount(2)
    await expect(edges).toHaveCount(1)
    await page.keyboard.press('Control+z')
    await expect(edges).toHaveCount(0)
    await page.keyboard.press('Control+Shift+z')
    await expect(edges).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath(`ctrl-shortcuts-${width}.png`) })
    await page.keyboard.press('Shift+/')
    const help = page.getByRole('dialog', { name: '画布快捷键' })
    await expect(help.getByText('Ctrl + L', { exact: true })).toBeVisible()
    await expect(help.getByText('L', { exact: true })).toBeVisible()
    await expect(help.getByText('Ctrl + D', { exact: true })).toBeVisible()
    await expect(help.getByText('Tab', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`ctrl-shortcuts-help-${width}.png`) })
    await page.keyboard.press('Escape')
    await nodes.first().locator('.canvas-node-body').dblclick()
    const editor = nodes.first().locator('textarea')
    await expect(editor).toBeFocused()
    await editor.fill('编辑中')
    await page.keyboard.press('Tab')
    await expect(page.locator('.canvas-context-menu')).toHaveCount(0)
    // Tab 在输入框中正常切换焦点，编辑器失焦提交内容，不触发新建菜单。
    await expect(editor).toHaveCount(0)
    await expect(nodes.first().locator('.canvas-node-prompt')).toHaveText('编辑中')
    await expect(page.locator('.canvas-view')).not.toBeFocused()
    await page.locator('.react-flow__pane').click({ position: { x: width - 50, y: 180 } })
    await expect(page.locator('[data-canvas-node-panel]')).toHaveCount(0)
    await page.getByRole('button', { name: '画布设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '画布设置', exact: true })
    for (const label of [
      '生成当前节点',
      '撤销',
      '重做',
      '成组',
      '解组',
      '画布节点搜索',
      '删除节点和连线',
      '时间线：播放 / 暂停',
      '时间线：分割',
      '时间线：波纹删除',
      '时间线：上一帧',
      '时间线：下一帧',
      '滚轮缩放画布',
    ]) {
      const button = settings.getByRole('button', { name: `修改${label}快捷键`, exact: true })
      await button.scrollIntoViewIfNeeded()
      await expect(button).toBeVisible()
    }
    for (const [label, keys] of [
      ['画布节点搜索', 'Control+k'],
      ['撤销', 'Control+u'],
      ['重做', 'Control+Shift+u'],
      ['成组', 'Control+j'],
      ['解组', 'Control+Shift+j'],
      ['删除节点和连线', 'Control+Backspace'],
    ]) {
      await settings.getByRole('button', { name: `修改${label}快捷键`, exact: true }).click()
      await page.keyboard.press(keys)
    }
    const wheelShortcut = settings.getByRole('button', { name: '修改滚轮缩放画布快捷键', exact: true })
    await wheelShortcut.click()
    await wheelShortcut.hover()
    await page.keyboard.down('Alt')
    await page.mouse.wheel(0, -100)
    await page.keyboard.up('Alt')
    await expect(wheelShortcut).toContainText('Alt + 滚轮')
    await page.screenshot({ path: testInfo.outputPath(`settings-shortcuts-${width}.png`) })
    await settings.getByRole('button', { name: '关闭', exact: true }).click()
    await root.focus()
    const viewport = page.locator('.react-flow__viewport')
    const scale = () => viewport.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)
    const beforeScale = await scale()
    await page.mouse.move(width - 50, 180)
    await page.keyboard.down('Alt')
    await page.mouse.wheel(0, -100)
    await page.keyboard.up('Alt')
    await expect.poll(scale).toBeGreaterThan(beforeScale)
    await page.keyboard.press('Control+k')
    await expect(page.getByPlaceholder('搜索分组、节点名称或提示词')).toBeVisible()
    await page.keyboard.press('Escape')
    await root.focus()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+j')
    await expect(page.getByRole('button', { name: '解组', exact: true })).toBeVisible()
    await page.keyboard.press('Control+Shift+j')
    await expect(page.getByRole('button', { name: '打组', exact: true })).toBeVisible()
    await page.keyboard.press('Control+d')
    await expect(nodes).toHaveCount(4)
    await page.keyboard.press('Control+z')
    await expect(nodes).toHaveCount(4)
    await page.keyboard.press('Control+u')
    await expect(nodes).toHaveCount(2)
    await page.keyboard.press('Control+Shift+u')
    await expect(nodes).toHaveCount(4)
    await page.keyboard.press('Control+a')
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(4)
    // 撤销/重做快照不恢复选择；显式全选后验证自定义删除。
    await root.focus()
    await page.keyboard.press('Control+Backspace')
    await expect(nodes).toHaveCount(0)
    expect(api.paidTaskSubmissions).toBe(0)
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
