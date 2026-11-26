import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

const redeemPath = '/api/v1/invitations/redeem'
const refreshPath = '/api/v1/auth/refresh'
const workspacePath = '/api/v1/workspaces'
const boundaries = ['account-change', 'logout'] as const
const scenarios = boundaries.flatMap((kind) => [200, 401].map((status) => ({ kind, status })))

for (const { kind, status } of scenarios) {
  const switchedAccount = kind === 'account-change'
  test(`另一个标签页${switchedAccount ? '换号' : '退出登录'}后忽略迟到的邀请码响应 ${status}`, async ({
    page,
  }, testInfo) => {
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => localStorage.setItem('zzh_guide_seen_home_u7', '1'))
    await page.route('**/api/v1/banners?slug=*', (route) => route.fulfill({ json: { code: 0, data: [] } }))
    let releaseResponse!: () => void
    const pendingResponse = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    let redemptionCount = 0
    let refreshCount = 0
    await page.route(`**${redeemPath}`, async (route) => {
      redemptionCount++
      expect(route.request().method()).toBe('POST')
      expect(route.request().postDataJSON()).toEqual({ code: 'ISOLATION-CHECK' })
      await pendingResponse
      return route.fulfill({
        status,
        json:
          status === 200
            ? { code: 0, data: { Workspace: { id: 725, name: '旧会话的团队', type: 'team' } } }
            : { code: 10101, code_string: 'UNAUTHORIZED' },
      })
    })
    await page.route(`**${refreshPath}`, (route) => {
      refreshCount++
      return route.fulfill({ status: 401, json: { code: 10101, code_string: 'UNAUTHORIZED' } })
    })

    await page.goto('/hot-copy')
    await page.locator('.apptop__user-btn').click()
    await page.getByRole('button', { name: '加入团队', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '加入新团队' })
    await dialog.getByLabel('邀请码').fill('ISOLATION-CHECK')
    await dialog.getByRole('button', { name: '确认加入' }).click()
    await expect(dialog.getByRole('button', { name: '加入中...' })).toBeDisabled()
    await expect.poll(() => redemptionCount).toBe(1)
    const redemptionResponse = page.waitForResponse((response) => new URL(response.url()).pathname === redeemPath)
    const draftKey = 'smart_create_draft_v1_u7_ws1'
    await page.evaluate((key) => localStorage.setItem(key, '{"workspaceId":1}'), draftKey)

    const peer = await page.context().newPage()
    let workspaceReadCount = 0
    try {
      await peer.route('**/e2e-auth-peer', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Auth boundary fixture</title>' }),
      )
      await peer.goto(new URL('/e2e-auth-peer', page.url()).href)
      await peer.evaluate((peerKind) => {
        const boundary = `${peerKind}:e2e-isolation`
        const accountChange = peerKind === 'account-change'
        if (accountChange) localStorage.setItem('zzh_has_auth_session', '1')
        else localStorage.removeItem('zzh_has_auth_session')
        localStorage.setItem('zzh.auth.request-boundary.v1', boundary)
        localStorage.setItem(
          'zzh.auth.logout-event.v1',
          JSON.stringify({
            userId: '7',
            nonce: 'peer-logout-event',
            requestBoundary: accountChange ? 'logout:previous' : boundary,
          }),
        )
      }, kind)
      await expect(page).toHaveURL(/\/welcome$/)
      await expect(dialog).toBeHidden()
      workspaceReadCount = api.seen.filter(({ path }) => path === workspacePath).length
    } finally {
      releaseResponse()
      await peer.close()
    }

    await (await redemptionResponse).finished()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('textbox', { name: '邀请码' })).toHaveCount(0)
    expect(redemptionCount).toBe(1)
    expect(refreshCount).toBe(0)
    expect(api.seen.filter(({ path }) => path === workspacePath).length).toBe(workspaceReadCount)
    await expect(page.getByText('已加入团队空间', { exact: true })).toHaveCount(0)
    await expect(page.getByText('旧会话的团队', { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('zzh_has_auth_session'))).toBe(switchedAccount ? '1' : null)
    expect(await page.evaluate((key) => localStorage.getItem(key), draftKey)).toBe(
      switchedAccount ? '{"workspaceId":1}' : null,
    )
    expect(await page.evaluate(() => localStorage.getItem('zzh.logout-draft-write-barrier.v1.7'))).toBe(
      switchedAccount ? null : '1',
    )
    await page.screenshot({ path: testInfo.outputPath(`auth-isolation-${kind}-${status}.png`) })
    expectNoUnexpectedApi(api)
  })
}

test('换号边界发布后，迟到的头像响应不会继续修改昵称', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => localStorage.setItem('zzh_guide_seen_home_u7', '1'))
  await page.route('**/api/v1/credit-requests/context', (route) =>
    route.fulfill({ json: { code: 0, data: { superior: null, workspaces: [] } } }),
  )
  let releaseAvatar!: () => void
  const pendingAvatar = new Promise<void>((resolve) => {
    releaseAvatar = resolve
  })
  let avatarRequests = 0
  let nicknameRequests = 0
  await page.route('**/api/v1/me/avatar', async (route) => {
    avatarRequests++
    await pendingAvatar
    return route.fulfill({ json: { code: 0, data: { avatar_url: '/old-avatar.png' } } })
  })
  await page.route('**/api/v1/me/profile', (route) => {
    nicknameRequests++
    return route.fulfill({ json: { code: 0, data: {} } })
  })

  await page.goto('/hot-copy')
  await page.locator('.apptop__user-btn').waitFor({ state: 'visible' })
  const menu = page.getByRole('button', { name: '打开菜单' })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('menuitem', { name: '个人中心' }).click()
  const dialog = page.getByRole('dialog', { name: '个人中心' })
  await dialog.getByRole('textbox', { name: '昵称' }).fill('旧账号昵称')
  await dialog.getByLabel('上传头像文件').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  try {
    await expect.poll(() => avatarRequests).toBe(1)
    await page.evaluate(() => localStorage.setItem('zzh.auth.request-boundary.v1', 'account-change:profile-isolation'))
  } finally {
    releaseAvatar()
  }

  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
  expect(nicknameRequests).toBe(0)
  await expect(page.getByText('保存成功', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('auth-isolation-profile.png') })
  expectNoUnexpectedApi(api)
})
