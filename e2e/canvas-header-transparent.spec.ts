import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`画布顶部操作保持透明底和描边 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/canvases/142**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
          : { id: 142, title: '顶部操作验收', revision: 1, status: 'active' },
      }),
    )
    await page.goto('/canvas/142')
    const back = page.getByRole('button', { name: '返回无限画布' })
    const saved = page.locator('.canvas-save-status .creative-draft-save')
    await expect(saved).toHaveText('已保存到云端')
    if (width < 760) await page.getByRole('button', { name: '画布操作' }).click()
    const balance = page.getByRole('button', { name: /剩余积分/ })
    const tutorial = page.getByRole('button', { name: '操作教程' })
    await expect(page.getByRole('button', { name: '分享这块画布' })).toHaveCount(0)
    for (const control of [back, saved, balance, tutorial]) {
      await expect(control).toBeVisible()
      await expect(control).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(control).toHaveCSS('border-top-width', '1px')
    }
    await page.screenshot({ path: testInfo.outputPath('canvas-header-transparent.png') })
    await tutorial.click()
    await expect(page.getByTestId('tutorial-modal-mask')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '关闭' }).click()
    await expect(page.getByTestId('tutorial-modal-mask')).not.toBeVisible()
    expectNoUnexpectedApi(api)
  })
}
