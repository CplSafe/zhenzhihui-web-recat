import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`画布展示 DoDo Agent 并保留草稿 ${width}px`, async ({ page }, testInfo) => {
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
    await page.route('**/agent-studio/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/api/state')) {
        expect(route.request().headers()['x-agent-workspace-id']).toBe('21')
        expect(route.request().headers()['x-agent-canvas-id']).toBe('110')
        return route.fulfill({ json: { connected: true, workspace_id: 21, session_scope: 'test', runs: [] } })
      }
      if (path.endsWith('/api/catalog')) return route.fulfill({ json: { models: [], skills: [] } })
      return route.fulfill({ body: 'studio' })
    })
    await page.goto('/canvas/110')
    await page.getByRole('button', { name: '打开 DoDo Agent' }).click()
    const agent = page.getByRole('region', { name: 'DoDo Agent' })
    await expect(agent).toBeVisible()
    const input = agent.getByRole('textbox', { name: '创作要求' })
    await input.fill('保留画布草稿')
    await page.screenshot({ path: testInfo.outputPath(`canvas-agent-${width}.png`), animations: 'disabled' })
    await agent.getByRole('button', { name: '收起 DoDo Agent' }).click()
    await expect(agent).toBeHidden()
    await page.getByRole('button', { name: '打开 DoDo Agent' }).click()
    await expect(input).toHaveValue('保留画布草稿')
  })
}
