import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const wallet of [{ balance: 1234.5 }, { available: 0, balance: 1234.5 }]) {
  test(`画布与会员中心积分一致 ${JSON.stringify(wallet)}`, async ({ page }, testInfo) => {
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/billing/wallet?**', (route) => route.fulfill({ json: wallet }))
    await page.route('**/api/v1/billing/credit-packages', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/canvases/142**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
          : { id: 142, title: '积分显示验收', revision: 1, status: 'active' },
      }),
    )
    const display = 'available' in wallet ? '0' : '1,234.5'
    await page.goto('/canvas/142')
    const balance = page.getByRole('button', { name: `剩余积分：${display}`, exact: true })
    await expect(balance).toBeVisible()
    await balance.click()
    const dialog = page.getByRole('dialog', { name: '会员中心', exact: true })
    await expect(dialog).toContainText(`当前积分余额:${display}`)
    await page.screenshot({ path: testInfo.outputPath('member-wallet.png') })
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await page.reload()
    await expect(balance).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('canvas-wallet-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '画布操作', exact: true }).click()
    await expect(balance).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('canvas-wallet-mobile.png') })
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
