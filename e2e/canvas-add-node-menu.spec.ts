import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

/**
 * 右键菜单的「添加节点」必须和左侧工具栏给出同一份类型清单。
 *
 * 锁的是用户实测反馈：右键菜单只有文本/图片/视频，漏了「视频剪辑」，
 * 于是时间线节点只能从左侧工具栏建——右键这条路看起来根本没有这个功能。
 * 顺带锁住尺寸：时间线卡片要按 460×400 建出来，不能落成默认的 250×250
 * 再靠「把过小的时间线撑大」的副作用事后补救。
 */
test('右键菜单能建出视频剪辑节点，且按时间线尺寸落位', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases/112**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 112, title: 'Add node menu', status: 'active', revision: 1 },
    })
  })

  await page.goto('/canvas/112')
  const pane = page.locator('.react-flow__pane')
  await expect(pane).toBeVisible()
  await expect(page.locator('.react-flow__node')).toHaveCount(0)

  await pane.click({ button: 'right', position: { x: 700, y: 420 } })
  const menu = page.locator('.canvas-context-menu')
  await expect(menu).toBeVisible()
  // 四种类型齐全，且与左侧工具栏同名同序
  await expect(menu.getByRole('button', { name: '文本节点' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '图片节点' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '视频节点' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '视频剪辑' })).toBeVisible()

  await menu.getByRole('button', { name: '视频剪辑' }).click()
  await expect(menu).toBeHidden()

  const node = page.locator('.react-flow__node')
  await expect(node).toHaveCount(1)
  // 尺寸写在节点内联样式上（React Flow 把 node.style 直接铺到包裹元素），不受画布缩放影响
  await expect(node).toHaveAttribute('style', /width:\s*460px/)
  await expect(node).toHaveAttribute('style', /height:\s*400px/)

  expectNoUnexpectedApi(api)
})
