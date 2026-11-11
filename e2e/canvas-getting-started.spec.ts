import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`空画布提示与节点创建删除 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    let revision = 1
    const saved = new Map<string, any>()
    await page.route('**/api/v1/canvases/142**', (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'PATCH') {
        for (const item of route.request().postDataJSON().mutations || []) {
          if (item.op === 'delete') saved.delete(item.element_id)
          else saved.set(item.element_id, item)
        }
        return route.fulfill({ json: { sync_revision: ++revision } })
      }
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [...saved.values()],
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 142, title: '开始创作验收', revision, status: 'active' },
      })
    })
    await page.goto('/canvas/142')
    await expect(page.getByRole('button', { name: /DoDo Agent/ })).toHaveCount(0)
    const hint = page.getByText('点击下方「+」创建新节点')
    await expect(hint).toBeVisible()
    await expect(page.getByRole('region', { name: '开始创作' })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`empty-${width}.png`) })
    await page.reload()
    await expect(hint).toBeVisible()
    await page.getByRole('button', { name: '添加节点' }).click()
    await page
      .getByRole('menu', { name: '创建或添加节点' })
      .getByRole('menuitem', { name: /文本节点/ })
      .click()
    await expect(page.locator('.react-flow__node')).toHaveCount(1)
    await expect(hint).toHaveCount(0)
    await page.locator('.react-flow__node').first().click()
    await page.keyboard.press('Delete')
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    await expect(hint).toBeVisible()
    expectNoUnexpectedApi(api)
  })
}
