import { expect, test, type Page } from '@playwright/test'
import { waitForCanvasViewportToSettle } from './fixtures/canvas-viewport'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

async function mockStoryboardModels(page: Page, initialQuote?: Promise<void>) {
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: [
        {
          id: 9601,
          enabled: true,
          display_name: 'E2E 分镜文本模型',
          operation_codes: ['responses.multimodal'],
        },
      ],
    }),
  )
  await page.route('**/api/v1/ai/tasks/estimate-cost', async (route) => {
    if (initialQuote && !route.request().postDataJSON()?.prompt) await initialQuote
    await route.fulfill({ json: { estimated_cost: 8, balance: 9000, can_afford: true } })
  })
}

test('文本节点快速重复提交只创建一次任务且提示词可恢复', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await mockStoryboardModels(page)

  let revision = 1
  const elements = new Map<string, any>()
  const mutationsBeforeSubmit: any[][] = []
  await page.route('**/api/v1/canvases/160**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/node-locks')) {
      await route.fulfill({ json: { granted: true, nodes: {} } })
      return
    }
    if (route.request().method() === 'PATCH') {
      const mutations = route.request().postDataJSON().mutations || []
      mutationsBeforeSubmit.push(mutations)
      for (const mutation of mutations) {
        if (mutation.op === 'delete') elements.delete(mutation.element_id)
        else elements.set(mutation.element_id, mutation)
      }
      await route.fulfill({ json: { sync_revision: ++revision } })
      return
    }
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: Number(url.searchParams.get('after_revision') || 0) > 0 ? [] : [...elements.values()],
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 160, title: '分镜提示词提交保存', status: 'active', revision },
    })
  })
  let submittedPrompt = ''
  let submitCount = 0
  await page.route('**/api/v1/ai/responses**', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    submitCount += 1
    submittedPrompt = String(route.request().postDataJSON().prompt || '')
    // 保持提交请求在途，确保第二次点击撞上异步请求窗口。
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.fulfill({ status: 400, json: { message: '模拟拒绝生成，确保不会产生真实任务' } })
  })

  await page.goto('/canvas/160')
  const pane = page.locator('.react-flow__pane')
  await pane.click({ button: 'right', position: { x: 520, y: 320 } })
  await page.locator('.canvas-context-menu').getByRole('button', { name: '文本节点', exact: true }).click()
  const node = page.locator('.react-flow__node.selected')
  await expect(node).toBeVisible()
  await node.click()
  const panel = page.locator('[data-canvas-node-panel]')
  await expect(panel).toBeVisible()
  const prompt = panel.getByRole('textbox', { name: '输入视频主题、场景、风格和时长，生成分镜提示词...' })
  await expect(prompt).toBeEditable()
  const latestPrompt = '刷新验证专用提示词：清晨海边，镜头缓慢推进，人物从画面左侧走向阳光。'
  await prompt.fill(latestPrompt)
  await expect(prompt).toHaveText(latestPrompt)
  await expect(panel.getByRole('button', { name: '生成分镜', exact: true })).toBeEnabled()
  const generateButton = panel.getByRole('button', { name: '生成分镜', exact: true })
  await generateButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await expect.poll(() => submittedPrompt).toContain(latestPrompt)
  await expect.poll(() => submitCount).toBe(1)
  expect(mutationsBeforeSubmit.length).toBeGreaterThan(0)
  expect(JSON.stringify(mutationsBeforeSubmit)).toContain(latestPrompt)
  await page.screenshot({ path: testInfo.outputPath('prompt-saved-before-submit.png') })

  await page.reload()
  const restoredNode = page.locator('.react-flow__node').first()
  await expect(restoredNode).toBeVisible()
  await restoredNode.click()
  await expect(prompt).toHaveText(latestPrompt)
  expect(pageErrors).toEqual([])
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})

for (const viewportSize of [
  { width: 1440, height: 1000 },
  { width: 390, height: 640 },
]) {
  test(`文本提示词输入和清空时面板与底栏位置不变 ${viewportSize.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewportSize)
    const api = await installStrictAuthenticatedApp(page)
    let releaseEmptyQuote!: () => void
    const emptyQuote = new Promise<void>((resolve) => {
      releaseEmptyQuote = resolve
    })
    await mockStoryboardModels(page, emptyQuote)
    let revision = 1
    await page.route('**/api/v1/canvases/161**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
      if (!url.pathname.endsWith('/elements')) {
        return route.fulfill({ json: { id: 161, title: '分镜编辑面板高度', status: 'active', revision } })
      }
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: ++revision } })
      const draft = {
        element_id: 'storyboard',
        kind: 'node',
        payload: {
          id: 'storyboard',
          type: 'text',
          position: { x: 100, y: 100 },
          style: { width: 160, height: 118 },
          data: { kind: 'text', modelVersionId: 9601 },
        },
      }
      return route.fulfill({
        json: {
          elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [draft],
          sync_revision: revision,
          history_floor_revision: 0,
          has_more: false,
        },
      })
    })

    await page.goto('/canvas/161')
    const node = page.locator('.react-flow__node[data-id="storyboard"]')
    const canvasViewport = page.locator('.react-flow__viewport')
    await expect(node).toBeInViewport()
    await waitForCanvasViewportToSettle(canvasViewport)
    if (viewportSize.width < 600) {
      const box = (await node.boundingBox())!
      const deltaY = Math.round(180 - box.y - box.height)
      await page.mouse.move(28, 330)
      await page.mouse.down({ button: 'middle' })
      await page.mouse.move(28, 330 + deltaY, { steps: 8 })
      await page.mouse.up({ button: 'middle' })
      await expect
        .poll(async () => {
          const bounds = (await node.boundingBox())!
          return Math.abs(bounds.y + bounds.height - 180)
        })
        .toBeLessThan(1)
    }
    await node.click()

    const panel = page.locator('[data-canvas-node-panel]')
    const field = panel.getByRole('textbox', { name: '输入视频主题、场景、风格和时长，生成分镜提示词...' })
    const validation = panel.getByRole('alert').filter({ hasText: '请输入视频创作需求后再生成分镜' })
    const generate = panel.getByRole('button', { name: '生成分镜', exact: true })
    const footer = panel.locator('[data-canvas-node-panel-actions]')
    const quote = footer.getByText('预计消耗：8 积分', { exact: true })
    const readLayout = async () => {
      const [frame, actions, button] = await Promise.all([
        panel.boundingBox(),
        footer.boundingBox(),
        generate.boundingBox(),
      ])
      if (!frame || !actions || !button) throw new Error('分镜编辑面板和底栏应当可见')
      return [frame.x, frame.y, frame.height, actions.y, actions.height, button.y, button.height]
    }

    await expect(validation).toBeVisible()
    await expect(generate).toBeDisabled()
    await field.focus()
    await expect(generate).toBeInViewport({ ratio: 0.95 })
    const initial = await test.step('记录空输入等待报价时的位置', async () => {
      try {
        await expect(footer.getByText('…', { exact: true })).toBeVisible()
        return await readLayout()
      } finally {
        releaseEmptyQuote()
      }
    })
    const transform = await canvasViewport.getAttribute('style')
    const expectUnchangedLayout = async () => {
      await expect
        .poll(async () => Math.max(...(await readLayout()).map((value, index) => Math.abs(value - initial[index]))))
        .toBeLessThan(1)
      expect(await canvasViewport.getAttribute('style')).toBe(transform)
    }
    await expect(quote).toBeVisible()
    await expectUnchangedLayout()
    await page.screenshot({ path: testInfo.outputPath('empty-storyboard-prompt.png'), caret: 'initial' })

    await field.pressSequentially('清晨的海边')
    await expect(field).toHaveText('清晨的海边')
    await expect(validation).toBeHidden()
    await expect(generate).toBeEnabled()
    await expectUnchangedLayout()
    await page.screenshot({ path: testInfo.outputPath('typed-storyboard-prompt.png'), caret: 'initial' })

    const longPrompt = Array.from({ length: 24 }, (_, index) => `第${index + 1}行描述镜头中的人物与场景。`).join('\n')
    await field.fill(longPrompt)
    await expect.poll(() => field.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await field.press('Control+End')
    await expect.poll(() => field.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expectUnchangedLayout()

    await field.fill('')
    await expect(validation).toBeVisible()
    await expect(generate).toBeDisabled()
    await expectUnchangedLayout()
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
