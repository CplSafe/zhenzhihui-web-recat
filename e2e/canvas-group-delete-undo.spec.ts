import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('分组多选创建节点后删除只移除新节点连线，快捷键立即可用且可撤销', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  let revision = 1
  await page.route('**/api/v1/canvases/129**', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: ++revision } })
    const url = new URL(route.request().url())
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements:
              Number(url.searchParams.get('after_revision')) > 0
                ? []
                : [
                    ...['a', 'b', 'c'].map((id, index) => ({
                      element_id: id,
                      kind: 'node',
                      op: 'upsert',
                      payload: {
                        id,
                        type: 'text',
                        position: { x: 100 + index * 340, y: 140 },
                        style: { width: 250, height: 180 },
                        data: { kind: 'text', title: id.toUpperCase(), text: `来源 ${id}`, groupId: 'source-group' },
                      },
                    })),
                    {
                      element_id: 'unrelated-target',
                      kind: 'node',
                      op: 'upsert',
                      payload: {
                        id: 'unrelated-target',
                        type: 'text',
                        position: { x: 1250, y: 150 },
                        style: { width: 250, height: 180 },
                        data: { kind: 'text', title: '既有目标', text: '与新节点无关' },
                      },
                    },
                    {
                      element_id: 'existing-edge',
                      kind: 'edge',
                      op: 'upsert',
                      payload: {
                        id: 'existing-edge',
                        source: 'a',
                        target: 'unrelated-target',
                        sourceHandle: 'a-right-source',
                        targetHandle: 'unrelated-target-left-target',
                      },
                    },
                  ],
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 129, title: '分组删除撤销回归', status: 'active', revision },
    })
  })

  await page.goto('/canvas/129')
  const nodes = page.locator('.react-flow__node')
  const edges = page.locator('.react-flow__edge')
  await expect(nodes).toHaveCount(4)
  await expect(edges).toHaveCount(1)
  await page.locator('.react-flow__node[data-id="a"]').click({ position: { x: 80, y: 80 } })
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(3)
  await page.getByRole('button', { name: '从所选节点创建下游节点' }).click()
  const menu = page.locator('.canvas-add-menu')
  await menu.getByRole('button', { name: /^文本生成/ }).click()

  await expect(nodes).toHaveCount(5)
  await expect(edges).toHaveCount(4)
  await expect(page.locator('.canvas-view')).toBeFocused()
  // 新节点创建后不重新点击画布，Delete 应只删除新节点及其三条输入线。
  await page.keyboard.press('Delete')
  await expect(nodes).toHaveCount(4)
  await expect(edges).toHaveCount(1)
  await expect(edges).toHaveAttribute('data-id', 'existing-edge')

  // 删除操作本身一步撤销，恢复新节点与其输入线，既有右侧连线始终保留。
  await page.keyboard.press('Control+z')
  await expect(nodes).toHaveCount(5)
  await expect(edges).toHaveCount(4)
  await expect(page.locator('.react-flow__edge[data-id="existing-edge"]')).toHaveCount(1)
  // 历史快照不恢复选择态；重新选择新节点后验证 Backspace 的默认别名。
  await nodes.last().click({ position: { x: 60, y: 60 } })
  await page.keyboard.press('Backspace')
  await expect(nodes).toHaveCount(4)
  await expect(edges).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(nodes).toHaveCount(5)
  await expect(edges).toHaveCount(4)
  await page.keyboard.press('Control+Shift+z')
  await expect(nodes).toHaveCount(4)
  await expect(edges).toHaveCount(1)
  expectNoUnexpectedApi(api)
})
