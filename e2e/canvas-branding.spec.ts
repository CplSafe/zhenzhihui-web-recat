import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`漫剧制作隐藏品牌并保留返回与云端保存状态 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/canvases/142**', (route) => {
      const url = new URL(route.request().url())
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
          : { id: 142, title: '品牌验收画布', revision: 1, status: 'active' },
      })
    })

    await page.goto('/canvas/142')
    const navigation = page.locator('.canvas-navigation')
    await expect(page.getByRole('button', { name: '返回画布列表' })).toBeVisible()
    await expect(navigation.getByText('豆豆同学', { exact: true })).toHaveCount(0)
    await expect(navigation.locator('img')).toHaveCount(0)
    await expect(navigation).toContainText('已保存到云端')
    await page.screenshot({ path: testInfo.outputPath('canvas-branding.png') })
    expectNoUnexpectedApi(api)
  })
}
