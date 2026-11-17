import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

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
