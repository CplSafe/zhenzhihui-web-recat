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
    let agentRequests = 0
    const mutations: string[] = []
    await page.route('**/agent-studio/**', (route) => {
      agentRequests++
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (request.method() !== 'GET') {
        mutations.push(path)
        return route.abort()
      }
      if (path.endsWith('/api/bootstrap')) return route.fulfill({ json: { ready: true } })
      if (path.endsWith('/api/state')) {
        expect(request.headers()['x-agent-workspace-id']).toBe('21')
        expect(request.headers()['x-agent-canvas-id']).toBe('110')
        return route.fulfill({ json: { connected: true, workspace_id: 21, session_scope: 'test', runs: [] } })
      }
      if (path.endsWith('/api/catalog'))
        return route.fulfill({
          json: {
            models: [
              {
                id: 29,
                model: 'banana-pro',
                display_name: 'Nano Banana Pro (Google)',
                operation_codes: ['image.text_to_image'],
              },
              { id: 18, model: 'seedance-2.5', display_name: 'Seedance 2.5', operation_codes: ['video.generate'] },
            ],
            planning_model: { id: 52, model: 'gpt-5.6-terra', operation_codes: ['agent.chat'] },
            skills: [],
          },
        })
      return route.abort()
    })
    await page.goto('/canvas/110')
    await expect(page.getByText('点击下方「+」创建新节点')).toBeVisible()
    await expect(page.getByRole('button', { name: '打开 DoDo Agent' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'DoDo Agent' })).toHaveCount(0)
    expect(agentRequests).toBe(0)
    await page.getByRole('button', { name: '打开 DoDo Agent' }).click()
    const agent = page.getByRole('region', { name: 'DoDo Agent' })
    await expect(agent).toBeVisible()
    await expect(agent.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled()
    const input = agent.getByRole('textbox', { name: '创作要求' })
    await input.fill('保留画布草稿')
    await expect(agent.getByRole('button', { name: '发送创作要求' })).toBeEnabled()
    await agent.getByRole('button', { name: '收起 DoDo Agent' }).click()
    await expect(agent).toBeHidden()
    await page.getByRole('button', { name: '打开 DoDo Agent' }).click()
    await expect(input).toHaveValue('保留画布草稿')
    expect(mutations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`canvas-agent-${width}.png`), animations: 'disabled' })
  })
}
