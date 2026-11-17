import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const CANVAS_ID = 110
const FILE_NAME = 'canvas-agent-drop.png'
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=',
  'base64',
)

async function openCanvasAgent(page: Page, uploadAttachment: (route: Route) => Promise<void>) {
  await page.setViewportSize({ width: 1440, height: 960 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/v1/canvases/${CANVAS_ID}**`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const url = new URL(route.request().url())
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: CANVAS_ID, title: '画布与 Agent 拖放回归', status: 'active', revision: 1 },
    })
  })
  const unexpectedAgentRequests: string[] = []
  await page.route('**/agent-studio/**', (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    const key = `${request.method()} ${pathname}`
    switch (key) {
      case 'GET /agent-studio/':
        return route.fulfill({ body: 'Agent mock' })
      case 'GET /agent-studio/api/state':
        return route.fulfill({
          json: { connected: true, workspace_id: WORKSPACE_ID, session_scope: 'drag-e2e', runs: [] },
        })
      case 'GET /agent-studio/api/catalog':
        return route.fulfill({ json: { models: [], skills: [] } })
      case 'POST /agent-studio/api/attachments':
        expect(new URL(request.url()).searchParams.get('name')).toBe(FILE_NAME)
        expect(request.headers()['x-agent-workspace-id']).toBe(String(WORKSPACE_ID))
        expect(request.headers()['x-agent-canvas-id']).toBe(String(CANVAS_ID))
        return uploadAttachment(route)
      default:
        unexpectedAgentRequests.push(key)
        return route.fulfill({ status: 500, json: { message: 'Unexpected Agent request' } })
    }
  })
  await page.goto(`/canvas/${CANVAS_ID}`)
  await page.getByRole('button', { name: '打开 DoDo Agent' }).click()
  const agent = page.getByRole('region', { name: 'DoDo Agent' })
  const prompt = agent.getByRole('textbox', { name: '创作要求' })
  await expect(prompt).toBeEnabled()
  return { api, unexpectedAgentRequests, agent, prompt }
}

async function pointIn(locator: Locator, horizontal = 0.5) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('无法定位拖放目标')
  return { x: Math.round(box.x + box.width * horizontal), y: Math.round(box.y + box.height / 2) }
}

test('本地文件在画布与 Agent 之间移动时始终只由当前落点处理', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '原生文件拖放事件由 Chromium CDP 提供')
  let attachmentPosts = 0
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const { api, unexpectedAgentRequests, agent, prompt } = await openCanvasAgent(page, (route) => {
    attachmentPosts++
    return route.fulfill({ json: { id: 'mock-attachment' } })
  })
  const filePath = testInfo.outputPath(FILE_NAME)
  await writeFile(filePath, PNG_BYTES)
  const session = await page.context().newCDPSession(page)
  const drag = (type: 'dragEnter' | 'dragOver' | 'drop' | 'dragCancel', point: { x: number; y: number }) =>
    session.send('Input.dispatchDragEvent', {
      type,
      ...point,
      data: { items: [], files: [filePath], dragOperationsMask: 1 },
    })
  const canvasPoint = await pointIn(page.locator('.react-flow__pane'), 0.25)
  const agentPoint = await pointIn(prompt)
  const headerPoint = await pointIn(agent.getByRole('button', { name: '新对话', exact: true }))
  const canvasHint = page.getByText('松开即可添加到画布', { exact: true })

  await drag('dragEnter', canvasPoint)
  await drag('dragOver', canvasPoint)
  await expect(canvasHint).toBeVisible()
  await drag('dragOver', agentPoint)
  await expect(canvasHint).toBeHidden()
  await drag('dragOver', canvasPoint)
  await expect(canvasHint).toBeVisible()
  await drag('dragCancel', canvasPoint)
  await page.mouse.move(canvasPoint.x + 1, canvasPoint.y)
  await expect(canvasHint).toBeHidden()
  expect(attachmentPosts).toBe(0)

  await drag('dragEnter', canvasPoint)
  await drag('dragOver', canvasPoint)
  await expect(canvasHint).toBeVisible()
  await drag('dragOver', headerPoint)
  await expect(canvasHint).toBeHidden()
  await drag('drop', headerPoint)
  await expect(page).toHaveURL(`/canvas/${CANVAS_ID}`)
  await expect(prompt).toBeEnabled()
  expect(page.context().pages()).toHaveLength(1)
  expect(attachmentPosts).toBe(0)

  await agent.getByRole('button', { name: '上传图片或剧本' }).click()
  const picker = page.getByRole('dialog', { name: '添加附件' })
  const pickerPoint = await pointIn(picker.getByRole('button', { name: '本地上传' }))
  await drag('dragEnter', canvasPoint)
  await drag('dragOver', canvasPoint)
  await expect(canvasHint).toBeVisible()
  await drag('dragOver', pickerPoint)
  await expect(canvasHint).toBeHidden()
  await drag('drop', pickerPoint)
  await expect(page).toHaveURL(`/canvas/${CANVAS_ID}`)
  expect(attachmentPosts).toBe(0)
  await picker.getByRole('button', { name: '关闭选择' }).click()

  await drag('dragEnter', canvasPoint)
  await drag('dragOver', canvasPoint)
  await expect(canvasHint).toBeVisible()
  await drag('dragOver', agentPoint)
  await expect(canvasHint).toBeHidden()
  await drag('drop', agentPoint)
  await expect(agent.getByRole('button', { name: `移除 ${FILE_NAME}` })).toBeVisible()
  expect(attachmentPosts).toBe(1)
  await expect(canvasHint).toBeHidden()
  await expect(page.locator('.react-flow__node')).toHaveCount(0)

  const viewport = page.locator('.react-flow__viewport')
  const position = () => viewport.evaluate((element) => getComputedStyle(element).transform)
  const previousPosition = await position()
  await page.mouse.move(canvasPoint.x, canvasPoint.y)
  await page.mouse.wheel(0, -180)
  await expect.poll(position).not.toBe(previousPosition)
  await prompt.fill('文件拖放后可以继续输入')
  await expect(prompt).toHaveValue('文件拖放后可以继续输入')
  await page.screenshot({ path: testInfo.outputPath('agent-file-drop.png'), animations: 'disabled' })
  expect(pageErrors).toEqual([])
  expect(unexpectedAgentRequests).toEqual([])
  expectNoUnexpectedApi(api)
})

test('Agent 附件上传超时后恢复输入并允许用户重新添加文件', async ({ page }, testInfo) => {
  await page.clock.install()
  let attachmentPosts = 0
  const { api, unexpectedAgentRequests, agent, prompt } = await openCanvasAgent(page, async (route) => {
    attachmentPosts++
    // 首次请求始终不返回，直到页面自己的截止时间取消它。
    if (attachmentPosts === 1) return
    await route.fulfill({ json: { id: 'mock-retry-attachment' } })
  })
  const fileInput = agent.locator('input[type="file"]')
  const file = { name: FILE_NAME, mimeType: 'image/png', buffer: PNG_BYTES }
  await prompt.fill('保留这段创作要求')
  await fileInput.setInputFiles(file)
  await expect.poll(() => attachmentPosts).toBe(1)
  await expect(prompt).toBeDisabled()

  await page.clock.fastForward(120_001)
  await expect(page.getByText('附件上传超时，请检查网络后重新添加未上传的文件。', { exact: true })).toBeVisible()
  await expect(prompt).toBeEnabled()
  await expect(prompt).toHaveValue('保留这段创作要求')
  expect(attachmentPosts).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('agent-attachment-timeout.png'), animations: 'disabled' })

  await fileInput.setInputFiles(file)
  await expect(agent.getByRole('button', { name: `移除 ${FILE_NAME}` })).toBeVisible()
  await expect(prompt).toBeEnabled()
  expect(attachmentPosts).toBe(2)
  expect(unexpectedAgentRequests).toEqual([])
  expectNoUnexpectedApi(api)
})
