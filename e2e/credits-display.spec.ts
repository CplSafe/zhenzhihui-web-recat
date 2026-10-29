import { expect, test } from '@playwright/test'
import {
  expectNoUnexpectedApi,
  installStrictAuthenticatedApp,
  waitForScopedApiResponse,
  WORKSPACE_ID,
} from './fixtures/strict-authenticated-app'

test('积分明细只展示原始积分，会员及充值保留人民币', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/billing/wallet?**', (route) =>
    route.fulfill({ json: { available: 1234.5, balance: 1234.5, frozen: 13.25 } }),
  )
  await page.route('**/api/v1/billing/credit-ledgers?**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 1,
            kind: 'consume',
            amount: -13.25,
            balance_after: 1234.5,
            reason: '图片生成消耗',
            created_at: '2026-10-27T00:00:00Z',
          },
        ],
        total: 1,
      },
    }),
  )
  await page.route('**/api/v1/billing/credit-packages', (route) =>
    route.fulfill({ json: [{ id: 1, name: '测试积分包', amount_cents: 1990, credits: 1000 }] }),
  )
  const ready = waitForScopedApiResponse(page, {
    method: 'GET',
    path: '/api/v1/billing/credit-ledgers',
    workspaceId: WORKSPACE_ID,
  })
  await page.goto('/credits')
  await ready
  const content = page.locator('.credits__content')
  await expect(content.getByRole('heading', { name: '积分明细' })).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.credits__card-v').first()).toHaveText('1,234.5积分')
  await expect(page.locator('.credits__card-v').nth(1)).toHaveText('13.25积分')
  await expect(content.getByRole('columnheader')).toHaveCount(5)
  await expect(content.getByRole('cell', { name: '-13.25', exact: true })).toBeVisible()
  await expect(content).not.toContainText(/人民币|折合|[¥￥]|0\.02 元/)
  await page.screenshot({ path: testInfo.outputPath('credits-desktop.png') })
  await page.setViewportSize({ width: 700, height: 800 })
  await expect(page.locator('.app-sidebar')).not.toBeInViewport()
  await expect(content.getByRole('cell', { name: '-13.25', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('credits-narrow.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '充值积分', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '会员中心', exact: true })
  await dialog.getByRole('button', { name: '积分充值', exact: true }).click()
  await expect(dialog.locator('.mc-card-price')).toContainText('￥19.9')
  await expect(dialog.locator('.mc-card-credits')).toContainText('1,000积分')
  await expect(dialog).not.toContainText(/1积分≈|1 积分 =/)
  await page.screenshot({ path: testInfo.outputPath('recharge-rmb.png') })
  await dialog.getByRole('button', { name: '团队版', exact: true }).click()
  await expect(dialog.locator('.mc-card-price')).toContainText('￥1')
  await page.screenshot({ path: testInfo.outputPath('membership-rmb.png') })
  expect(api.paidTaskSubmissions).toBe(0)
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})
