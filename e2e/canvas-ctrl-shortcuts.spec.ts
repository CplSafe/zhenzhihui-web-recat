import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 900]) {
  test(`Ctrl 组合键连线、副本和撤销，旧默认升级并保留输入焦点 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
    await page.addInitScript(() => {
      if (location.pathname !== '/canvas/128') return
      localStorage.setItem(
        'zzh_canvas_preferences',
        JSON.stringify({
          wheelMode: 'pan',
          shortcuts: { connect: 'L', duplicate: 'Shift+D', add: 'N', fitView: '1' },
        }),
      )
    })
    const revisions = new Map([
      [128, 1],
      [129, 1],
    ])
    const mutations: Array<{ kind: string; payload?: { source?: string; target?: string } }> = []
    await page.route(/\/api\/v1\/canvases\/(128|129)(?:\/|\?|$)/, (route) => {
      const url = new URL(route.request().url())
      const id = Number(url.pathname.split('/')[4])
      let revision = revisions.get(id) ?? 1
      if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
      if (route.request().method() === 'PATCH') {
        mutations.push(...(route.request().postDataJSON().mutations || []))
        revisions.set(id, ++revision)
        return route.fulfill({ json: { revision, sync_revision: revision } })
      }
      if (Number(url.searchParams.get('after_revision')) > 0) {
        return route.fulfill({
          json: { elements: [], sync_revision: revision, history_floor_revision: 0, has_more: false },
        })
      }
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
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
          : { id, title: '组合键回归', revision },
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
    await expect(page.getByText('已保存到云端', { exact: true })).toBeVisible()
    // 新版工具栏不再提供设置入口，独立组件测试覆盖修改设置；这里验证浏览器读出的已保存键位。
    await page.evaluate(() => {
      localStorage.setItem(
        'zzh_canvas_preferences',
        JSON.stringify({
          wheelMode: 'pan',
          shortcutsVersion: 3,
          shortcuts: {
            search: 'Mod+K',
            undo: 'Mod+U',
            redo: 'Mod+Shift+U',
            group: 'Mod+J',
            ungroup: 'Mod+Shift+J',
            delete: 'Mod+Backspace',
            zoomWheel: 'Alt+Wheel',
          },
        }),
      )
    })
    await page.goto('/canvas/129')
    await expect(nodes).toHaveCount(2)
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
