import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('文本节点提交分镜前先持久化最新提示词，刷新后仍可恢复', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
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
  await page.route('**/api/v1/ai/tasks/estimate-cost', (route) =>
    route.fulfill({ json: { estimated_cost: 8, balance: 9000, can_afford: true } }),
  )

  let revision = 1
  const elements = new Map<string, any>()
  const mutationsBeforeSubmit: any[][] = []
  await page.route('**/api/v1/canvases/160**', async (route) => {
    const url = new URL(route.request().url())
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
  await page.route('**/api/v1/ai/responses**', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    submittedPrompt = String(route.request().postDataJSON().prompt || '')
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
  const prompt = panel.getByPlaceholder('输入视频主题、场景、风格和时长，生成分镜提示词...')
  const latestPrompt = '刷新验证专用提示词：清晨海边，镜头缓慢推进，人物从画面左侧走向阳光。'
  await prompt.fill(latestPrompt)
  await expect(panel.getByRole('button', { name: '生成分镜', exact: true })).toBeEnabled()
  await panel.getByRole('button', { name: '生成分镜', exact: true }).click()
  await expect.poll(() => submittedPrompt).toContain(latestPrompt)
  expect(mutationsBeforeSubmit.length).toBeGreaterThan(0)
  expect(JSON.stringify(mutationsBeforeSubmit)).toContain(latestPrompt)
  await page.screenshot({ path: testInfo.outputPath('prompt-saved-before-submit.png') })

  await page.reload()
  const restoredNode = page.locator('.react-flow__node').first()
  await expect(restoredNode).toBeVisible()
  await restoredNode.click()
  const restoredPrompt = page
    .locator('[data-canvas-node-panel]')
    .getByPlaceholder('输入视频主题、场景、风格和时长，生成分镜提示词...')
  await expect(restoredPrompt).toHaveValue(latestPrompt)
  expect(pageErrors).toEqual([])
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
