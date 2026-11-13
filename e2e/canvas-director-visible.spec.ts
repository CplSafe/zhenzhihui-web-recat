import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`画布暂不展示 DoDo Agent ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/canvases/110**', (route) => {
      const url = new URL(route.request().url())
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
          : { id: 110, title: '测试画布', status: 'active', revision: 1 },
      })
    })
    let agentRequests = 0
    await page.route('**/agent-studio/**', (route) => {
      agentRequests++
      return route.abort()
    })
    await page.goto('/canvas/110')
    await expect(page.getByText('点击下方「+」创建新节点')).toBeVisible()
    await expect(page.getByRole('button', { name: '打开 DoDo Agent' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'DoDo Agent' })).toHaveCount(0)
    expect(agentRequests).toBe(0)
    await page.screenshot({ path: testInfo.outputPath(`canvas-agent-${width}.png`), animations: 'disabled' })
  })
}
