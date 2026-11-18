import { expect, test, type Locator } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const CANVAS_ID = 110

async function expectSeparate(first: Locator, second: Locator) {
  await expect
    .poll(async () => {
      const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()])
      return Boolean(
        a && b && (a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y),
      )
    })
    .toBe(true)
}

for (const width of [1440, 760]) {
  test(`打开 Agent 后点击新建视频节点可同时添加引用和使用节点操作 (${width}px)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route(`**/api/v1/canvases/${CANVAS_ID}**`, (route) => {
      const { pathname } = new URL(route.request().url())
      return route.fulfill({
        json:
          route.request().method() === 'PATCH'
            ? { revision: 2, sync_revision: 2 }
            : pathname.endsWith('/elements')
              ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
              : { id: CANVAS_ID, title: 'Agent 与节点操作', status: 'active', revision: 1 },
      })
    })
    const unexpectedAgentRequests: string[] = []
    await page.route('**/agent-studio/**', (route) => {
      const request = route.request()
      const key = `${request.method()} ${new URL(request.url()).pathname}`
      switch (key) {
        case 'GET /agent-studio/':
          return route.fulfill({ body: 'Agent mock' })
        case 'GET /agent-studio/api/bootstrap':
          return route.fulfill({ json: { ready: true } })
        case 'GET /agent-studio/api/state':
          return route.fulfill({
            json: { connected: true, workspace_id: WORKSPACE_ID, session_scope: 'node-operations', runs: [] },
          })
        case 'GET /agent-studio/api/catalog':
          return route.fulfill({ json: { models: [], skills: [] } })
        default:
          unexpectedAgentRequests.push(key)
          return route.abort()
      }
    })

    await page.goto(`/canvas/${CANVAS_ID}`)
    await page.getByRole('button', { name: '打开 DoDo Agent' }).click()
    const agent = page.getByRole('region', { name: 'DoDo Agent' })
    const agentPrompt = agent.getByRole('textbox', { name: '创作要求' })
    await expect(agentPrompt).toBeEnabled()
    await agentPrompt.fill('保留这段 Agent 草稿')

    const pane = page.locator('.react-flow__pane')
    const blankPoint = { x: 52, y: 150 }
    await pane.click({ button: 'right', position: { x: Math.round(width * 0.78), y: 170 } })
    await page.locator('.canvas-context-menu').getByRole('button', { name: '视频节点', exact: true }).click()
    const node = page.locator('.react-flow__node')
    await expect(node).toHaveCount(1)

    const editor = page.locator('[data-canvas-node-panel]')
    const toolbar = page.getByRole('toolbar', { name: '节点操作' })
    const reference = agent.getByRole('button', { name: /^移除引用 / })
    await pane.click({ position: blankPoint })
    await expect(editor).toBeHidden()
    await expect(reference).toHaveCount(0)

    await node.locator('.canvas-node-body').click()
    await expect(reference).toHaveCount(1)
    await expect(toolbar).toBeVisible()
    await expect(editor).toBeVisible()
    await expectSeparate(editor, agent)
    await expectSeparate(toolbar, agent)
    await expectSeparate(toolbar, editor)

    const nodePrompt = editor.getByRole('textbox')
    await nodePrompt.click()
    await nodePrompt.fill('视频节点仍可编辑')
    await expect(nodePrompt).toHaveText('视频节点仍可编辑')
    const fileChooser = page.waitForEvent('filechooser')
    await toolbar.getByRole('button', { name: '上传素材' }).click()
    expect(await (await fileChooser).element().getAttribute('accept')).toContain('video/')
    await expect(agentPrompt).toHaveValue('保留这段 Agent 草稿')
    await agent.getByRole('button', { name: '上传图片或剧本' }).click({ trial: true })
    await page.screenshot({ path: testInfo.outputPath('agent-and-node-operations.png'), animations: 'disabled' })

    await pane.click({ position: blankPoint })
    await expect(editor).toBeHidden()
    await expect(toolbar).toBeHidden()
    await expect(reference).toHaveCount(1)
    await node.locator('.canvas-node-body').click()
    await expect(editor).toBeVisible()
    await expect(nodePrompt).toHaveText('视频节点仍可编辑')
    await expect(reference).toHaveCount(1)
    expect(unexpectedAgentRequests).toEqual([])
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
