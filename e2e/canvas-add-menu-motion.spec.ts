import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('点击画布加号展开节点创建菜单并保留创建操作', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/canvases/159**', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 159, title: '添加菜单动效验收', revision: 1 },
    })
  })
  await page.goto('/canvas/159')

  const trigger = page.getByRole('button', { name: '添加节点' })
  await expect(trigger).toBeVisible()
  const triggerBounds = await trigger.boundingBox()
  expect(triggerBounds).not.toBeNull()
  await trigger.click()

  const menu = page.getByRole('menu', { name: '创建或添加节点' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /文本节点/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /素材库/ })).toBeVisible()
  const menuBounds = await menu.boundingBox()
  expect(menuBounds).not.toBeNull()
  expect(menuBounds!.width).toBeGreaterThan(triggerBounds!.width * 3)
  expect(menuBounds!.height).toBeGreaterThan(triggerBounds!.height * 3)
  expect(menuBounds!.x).toBeLessThanOrEqual(triggerBounds!.x + 2)
  expect(Math.abs(menuBounds!.y + menuBounds!.height - (triggerBounds!.y + triggerBounds!.height))).toBeLessThan(3)
  await page.screenshot({ path: test.info().outputPath('canvas-add-menu-open.png') })

  await menu.getByRole('menuitem', { name: /文本节点/ }).click()
  await expect(menu).toHaveCount(0)
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  expectNoUnexpectedApi(api)
})
