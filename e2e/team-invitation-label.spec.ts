import { expect, test, type Page } from '@playwright/test'
import {
  expectNoUnexpectedApi,
  installStrictAuthenticatedApp,
  PERSONAL_WORKSPACE_ID,
  PERSONAL_WORKSPACE_NAME,
  TEAM_WORKSPACE_NAME,
  WORKSPACE_ID,
} from './fixtures/strict-authenticated-app'

async function installTeamMemberApp(page: Page, role: 'admin' | 'member') {
  const api = await installStrictAuthenticatedApp(page)
  const team = {
    id: WORKSPACE_ID,
    name: TEAM_WORKSPACE_NAME,
    type: 'team',
    owner_user_id: 41,
    status: 'active',
  }
  const workspaces = [
    {
      id: PERSONAL_WORKSPACE_ID,
      name: PERSONAL_WORKSPACE_NAME,
      type: 'personal',
      owner_user_id: 7,
      status: 'active',
    },
    team,
  ]
  await page.addInitScript(() => {
    localStorage.setItem('zzh_guide_seen_home_u7', '1')
    localStorage.setItem('zzh_guide_seen_smart_u7', '1')
  })
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: { code: 0, data: { workspace: team, workspaces, expires_in: 3600 } } }),
  )
  await page.route('**/api/v1/workspaces', (route) => {
    expect(route.request().method()).toBe('GET')
    return route.fulfill({ json: { code: 0, data: workspaces } })
  })
  await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/members`, (route) => {
    expect(route.request().method()).toBe('GET')
    return route.fulfill({
      json: [
        { user_id: team.owner_user_id, workspace_id: WORKSPACE_ID, nickname: '团队所有者', role: 'owner' },
        { user_id: 7, workspace_id: WORKSPACE_ID, nickname: 'E2E 用户', role },
      ],
    })
  })
  return api
}

test('当前团队的管理员可以生成并复制邀请码', async ({ page }, testInfo) => {
  const api = await installTeamMemberApp(page, 'admin')
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => sessionStorage.setItem('e2e_team_invitation_clipboard', value),
      },
    })
  })
  const inviteCode = 'CODE1234'
  const invitationRequests: string[] = []
  await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/invitations**`, (route) => {
    const method = route.request().method()
    invitationRequests.push(method)
    if (method === 'GET') return route.fulfill({ json: [] })
    expect(method).toBe('POST')
    return route.fulfill({ json: { id: 1, code: inviteCode, expires_at: '2099-01-01T00:00:00Z' } })
  })

  await page.goto('/hot-copy')
  await page.locator('.apptop__user-btn').click()
  await page.getByRole('button', { name: '邀请成员（当前团队）' }).click()
  const dialog = page.getByRole('dialog', { name: '团队管理' })
  await expect(dialog.getByText('暂无邀请码')).toBeVisible()
  await dialog.getByRole('button', { name: '生成邀请码', exact: true }).click()
  await expect(dialog.getByText('CODE 1234', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '复制邀请码', exact: true }).click()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('e2e_team_invitation_clipboard'))).toBe(inviteCode)
  expect(invitationRequests).toContain('GET')
  expect(invitationRequests.filter((method) => method === 'POST')).toHaveLength(1)
  await page.screenshot({ path: testInfo.outputPath('team-admin-invitation.png') })
  expectNoUnexpectedApi(api)
})

test('当前团队的普通成员查看成员时不会请求邀请码', async ({ page }, testInfo) => {
  const api = await installTeamMemberApp(page, 'member')

  await page.goto('/hot-copy')
  await page.locator('.apptop__user-btn').click()
  await page.getByRole('button', { name: '团队成员', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '团队管理' })
  await expect(dialog.getByText('团队所有者', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '生成邀请码', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('team-member-list.png') })
  expectNoUnexpectedApi(api)
})

test('邀请码为空时生成，生成成功后可重新生成', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.addInitScript(() => {
    localStorage.setItem('zzh_guide_seen_home_u7', '1')
    localStorage.setItem('zzh_guide_seen_smart_u7', '1')
  })
  let invitation: { id: number; code: string; expires_at: string } | null = null
  let creates = 0
  await page.route('**/api/v1/workspaces/21/invitations**', async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({ json: invitation ? [invitation] : [] })
    } else if (method === 'POST') {
      creates += 1
      invitation = { id: creates, code: `CODE000${creates}`, expires_at: '2099-01-01T00:00:00Z' }
      await route.fulfill({ json: invitation })
    } else if (method === 'DELETE') {
      await route.fulfill({ json: {} })
    } else {
      throw new Error(`Unexpected invitation request: ${method}`)
    }
  })
  await page.goto('/hot-copy')
  await page.locator('.apptop__user-btn').click()
  await page.getByRole('button', { name: '邀请成员（当前团队）' }).click()
  const dialog = page.getByRole('dialog', { name: '团队管理' })
  await expect(dialog.getByText('暂无邀请码')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '生成邀请码' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('before-generation.png') })
  await dialog.getByRole('button', { name: '生成邀请码' }).click()
  await expect(dialog.getByRole('button', { name: '重新生成' })).toBeVisible()
  await expect(dialog.getByText('CODE 0001')).toBeVisible()
  await dialog.getByRole('button', { name: '重新生成' }).click()
  await expect(dialog.getByText('CODE 0002')).toBeVisible()
  expect(creates).toBe(2)
  expectNoUnexpectedApi(api)
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 720 },
]) {
  test(`团队成员较多时可滚动至末行，邀请与搜索区保持可见（${viewport.width}px）`, async ({ page }, testInfo) => {
    const api = await installStrictAuthenticatedApp(page)
    await page.setViewportSize(viewport)
    await page.addInitScript(() => {
      localStorage.setItem('zzh_guide_seen_home_u7', '1')
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
    })
    const lastMember = '末位管理员'
    await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/members`, (route) => {
      expect(route.request().method()).toBe('GET')
      const members = Array.from({ length: 36 }, (_, index) => ({
        user_id: index + 7,
        workspace_id: WORKSPACE_ID,
        nickname: index === 0 ? 'E2E 用户' : index === 35 ? lastMember : `滚动验证成员 ${index}`,
        role: index === 0 ? 'owner' : index === 35 ? 'admin' : 'member',
      }))
      return route.fulfill({ json: members })
    })
    await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/invitations**`, (route) => {
      expect(route.request().method()).toBe('GET')
      return route.fulfill({ json: [] })
    })

    await page.goto('/hot-copy')
    await page.locator('.apptop__user-btn').click()
    await page.getByRole('button', { name: '邀请成员（当前团队）' }).click()
    const dialog = page.getByRole('dialog', { name: '团队管理' })
    const list = dialog.locator('.tm-members')
    const lastRow = list.locator('.tm-member').filter({ hasText: lastMember })
    const back = dialog.getByRole('button', { name: '返回' })
    const search = dialog.getByPlaceholder('搜索成员昵称、账号...')
    const invite = dialog.getByRole('button', { name: '生成邀请码' })
    await expect(list.getByText('滚动验证成员 1', { exact: true })).toBeInViewport()
    await expect(lastRow).toBeAttached()
    await expect(lastRow).not.toBeInViewport()
    await expect(invite).toBeInViewport()
    await expect(search).toBeInViewport()
    await expect(back).toBeInViewport()

    await list.hover({ position: { x: 20, y: 20 } })
    await page.mouse.wheel(0, 4000)
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect(lastRow).toBeInViewport()
    await expect(list.getByText('滚动验证成员 1', { exact: true })).not.toBeInViewport()
    await expect(invite).toBeInViewport()
    await expect(search).toBeInViewport()
    await expect(back).toBeInViewport()

    await lastRow.getByRole('button', { name: '更多操作' }).click()
    const actions = page.getByLabel('成员操作', { exact: true })
    await expect(actions.getByRole('button', { name: '取消管理员' })).toBeInViewport()
    await expect(actions.getByRole('button', { name: '移出团队' })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath(`team-members-scrolled-${viewport.width}.png`) })
    expectNoUnexpectedApi(api)
  })
}
