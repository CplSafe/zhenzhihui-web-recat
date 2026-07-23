import { expect, test, type Page } from '@playwright/test'
import {
  PERSONAL_WORKSPACE_ID,
  PERSONAL_WORKSPACE_NAME,
  SECOND_TEAM_WORKSPACE_ID,
  SECOND_TEAM_WORKSPACE_NAME,
  SMART_PROJECT_ID,
  HOT_COPY_PROJECT_ID,
  TEAM_WORKSPACE_NAME,
  WORKSPACE_ID,
  expectNoUnexpectedApi,
  expectScopedRequest,
  installStrictAuthenticatedApp,
  type StrictApiState,
} from './fixtures/strict-authenticated-app'

async function switchWorkspaceThroughUi(page: Page, workspaceName: string) {
  await page.getByRole('button', { name: /E2E 用户/ }).click()
  const userPanel = page.getByRole('dialog', { name: '用户面板' })
  await expect(userPanel).toBeVisible()
  await userPanel.getByRole('button', { name: workspaceName, exact: true }).click()
}

async function waitForEditorStartupRequests(api: StrictApiState, workspaceId: number) {
  await expect
    .poll(
      () =>
        api.seen.filter((request) => request.path === '/api/v1/ai/models' && request.workspaceId === workspaceId)
          .length,
      { message: `编辑器未完成空间 ${workspaceId} 的模型能力初始化` },
    )
    .toBeGreaterThanOrEqual(2)
}

function expectPostSwitchScope(api: StrictApiState, requestIndex: number, targetWorkspaceId: number) {
  const requestsAfterClickStarted = api.seen.slice(requestIndex)
  const firstTargetRequestIndex = requestsAfterClickStarted.findIndex(
    (request) => request.workspaceId === targetWorkspaceId,
  )
  expect(firstTargetRequestIndex, `切换后没有出现目标空间 ${targetWorkspaceId} 的请求`).toBeGreaterThanOrEqual(0)

  const wrongScope = requestsAfterClickStarted.slice(firstTargetRequestIndex).filter((request) => {
    if (!request.workspaceId || request.workspaceId === targetWorkspaceId) return false
    // The source editor is deliberately unmounted before the global workspace
    // changes, so its final revision read + draft write must keep the source scope.
    const isSourceDraftFlush =
      request.path.startsWith('/api/v1/creative/projects/') &&
      ((request.method === 'GET' && !request.path.endsWith('/draft')) ||
        (request.method === 'PUT' && request.path.endsWith('/draft')))
    return !isSourceDraftFlush
  })
  expect(wrongScope, `切换后的请求串入了旧空间：${JSON.stringify(wrongScope, null, 2)}`).toEqual([])
}

test.describe('创作页空间切换隔离', () => {
  for (const scenario of [
    {
      label: '个人→团队',
      sourceWorkspaceId: PERSONAL_WORKSPACE_ID,
      targetWorkspaceId: WORKSPACE_ID,
      targetWorkspaceName: TEAM_WORKSPACE_NAME,
      oldDescription: '个人空间独立智能草稿',
      oldShot: '个人空间独立分镜',
      oldProjectName: '个人空间智能项目',
    },
    {
      label: '团队→个人',
      sourceWorkspaceId: WORKSPACE_ID,
      targetWorkspaceId: PERSONAL_WORKSPACE_ID,
      targetWorkspaceName: PERSONAL_WORKSPACE_NAME,
      oldDescription: '刷新后应恢复的智能成片描述',
      oldShot: 'E2E 恢复分镜画面',
      oldProjectName: 'E2E 智能项目',
    },
  ]) {
    test(`智能成片 ${scenario.label} 清空旧项目草稿并落到空白入口`, async ({ page }) => {
      test.slow()
      const api = await installStrictAuthenticatedApp(page, {
        activeWorkspaceId: scenario.sourceWorkspaceId,
      })

      await page.goto(`/smart/${SMART_PROJECT_ID}`)
      await expect(page.getByText(scenario.oldDescription, { exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(scenario.oldShot, { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: scenario.oldProjectName })).toBeVisible()
      await waitForEditorStartupRequests(api, scenario.sourceWorkspaceId)
      const requestIndex = api.seen.length

      await switchWorkspaceThroughUi(page, scenario.targetWorkspaceName)

      await expect(page).toHaveURL(/\/smart$/)
      await expect(page.getByRole('heading', { name: '想打造什么样的爆款短视频？' })).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByText(scenario.oldDescription, { exact: true })).toHaveCount(0)
      await expect(page.getByText(scenario.oldShot, { exact: true })).toHaveCount(0)
      await expect(page.getByText(scenario.oldProjectName, { exact: false })).toHaveCount(0)
      expectScopedRequest(api, {
        method: 'GET',
        path: '/api/v1/billing/subscription',
        workspaceId: scenario.targetWorkspaceId,
      })
      expectPostSwitchScope(api, requestIndex, scenario.targetWorkspaceId)
      expect(api.paidTaskSubmissions).toBe(0)
      expectNoUnexpectedApi(api)
    })
  }

  for (const scenario of [
    {
      label: '个人→团队',
      sourceWorkspaceId: PERSONAL_WORKSPACE_ID,
      targetWorkspaceId: WORKSPACE_ID,
      targetWorkspaceName: TEAM_WORKSPACE_NAME,
      oldProjectName: '个人空间爆款项目',
    },
    {
      label: '团队→个人',
      sourceWorkspaceId: WORKSPACE_ID,
      targetWorkspaceId: PERSONAL_WORKSPACE_ID,
      targetWorkspaceName: PERSONAL_WORKSPACE_NAME,
      oldProjectName: 'E2E 爆款项目',
    },
  ]) {
    test(`爆款复制 ${scenario.label} 清空旧项目并落到空白入口`, async ({ page }) => {
      test.slow()
      const api = await installStrictAuthenticatedApp(page, {
        activeWorkspaceId: scenario.sourceWorkspaceId,
      })

      await page.goto(`/hot-copy/${HOT_COPY_PROJECT_ID}`)
      await expect(page.getByRole('button', { name: `项目 /${scenario.oldProjectName}` })).toBeVisible({
        timeout: 30_000,
      })
      await waitForEditorStartupRequests(api, scenario.sourceWorkspaceId)
      const requestIndex = api.seen.length

      await switchWorkspaceThroughUi(page, scenario.targetWorkspaceName)

      await expect(page).toHaveURL(/\/hot-copy$/)
      await expect(page.getByRole('heading', { name: '爆款作业直接抄,你的产品当主角!' })).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByText(scenario.oldProjectName, { exact: false })).toHaveCount(0)
      expectScopedRequest(api, {
        method: 'GET',
        path: '/api/v1/billing/subscription',
        workspaceId: scenario.targetWorkspaceId,
      })
      expectPostSwitchScope(api, requestIndex, scenario.targetWorkspaceId)
      expect(api.paidTaskSubmissions).toBe(0)
      expectNoUnexpectedApi(api)
    })
  }

  test('团队→团队保持项目路由但重新读取目标团队草稿', async ({ page }) => {
    test.slow()
    const api = await installStrictAuthenticatedApp(page, { activeWorkspaceId: WORKSPACE_ID })

    await page.goto(`/smart/${SMART_PROJECT_ID}`)
    await expect(page.getByText('刷新后应恢复的智能成片描述', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('E2E 恢复分镜画面', { exact: true })).toBeVisible()
    await waitForEditorStartupRequests(api, WORKSPACE_ID)
    const requestIndex = api.seen.length

    await switchWorkspaceThroughUi(page, SECOND_TEAM_WORKSPACE_NAME)

    await expect(page).toHaveURL(new RegExp(`/smart/${SMART_PROJECT_ID}$`))
    await expect(page.getByText('团队 B 独立智能草稿', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('团队 B 独立分镜', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '团队 B 智能项目' })).toBeVisible()
    await expect(page.getByText('刷新后应恢复的智能成片描述', { exact: true })).toHaveCount(0)
    await expect(page.getByText('E2E 恢复分镜画面', { exact: true })).toHaveCount(0)
    expectScopedRequest(api, {
      method: 'GET',
      path: `/api/v1/creative/projects/${SMART_PROJECT_ID}`,
      workspaceId: SECOND_TEAM_WORKSPACE_ID,
      projectId: SMART_PROJECT_ID,
    })
    expectPostSwitchScope(api, requestIndex, SECOND_TEAM_WORKSPACE_ID)
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
})
