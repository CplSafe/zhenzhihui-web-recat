import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('Agent 积分不足在对话提示，点击充值打开弹窗且不自动恢复', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page)
  await page.routeWebSocket('**/agent-studio/**', () => {})
  await page.addInitScript(() => {
    sessionStorage.setItem('dodo-conversation:' + JSON.stringify(['/agent-studio', 'credits-test', 110]), 'credit-run')
  })
  await page.route('**/api/v1/canvases/110**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 110, title: '余额提示测试', status: 'active', revision: 1 },
    }),
  )
  const mutations: string[] = []
  await page.route('**/agent-studio/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') {
      mutations.push(path)
      return route.abort()
    }
    if (path.endsWith('/api/bootstrap')) return route.fulfill({ json: { ready: true } })
    if (path.endsWith('/api/state'))
      return route.fulfill({
        json: {
          connected: true,
          workspace_id: 21,
          session_scope: 'credits-test',
          runs: [{ id: 'credit-run', title: '制作会话', status: 'error' }],
        },
      })
    if (path.endsWith('/api/catalog'))
      return route.fulfill({
        json: {
          models: [],
          skills: [],
          planning_model: { id: 52, model: 'GPT', operation_codes: ['agent.chat'] },
        },
      })
    if (path.endsWith('/api/runs/credit-run'))
      return route.fulfill({
        json: {
          id: 'credit-run',
          status: 'error',
          cursor: 1,
          events: [
            {
              id: 'credit',
              kind: 'error',
              text: 'Insufficient credits; top up the workspace balance before retrying.',
            },
          ],
        },
      })
    return route.abort()
  })
  await page.goto('/canvas/110')
  await page.getByRole('button', { name: '打开 DoDo Agent' }).click()
  const agent = page.getByRole('region', { name: 'DoDo Agent' })
  await expect(agent.getByLabel('积分不足提示')).toContainText('当前工作空间可用积分不足')
  await expect(agent.getByText(/Insufficient credits/)).toHaveCount(0)
  await agent.getByRole('button', { name: '去充值', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '会员中心', exact: true })
  await expect(modal).toBeVisible()
  await expect(modal.getByRole('button', { name: '积分充值', exact: true })).toHaveClass(/is-active/)
  await expect(modal.getByText('暂无可充值的积分包')).toBeVisible()
  expect(mutations).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('agent-credit-recharge.png') })
})
