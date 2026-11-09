import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`剧本创意入口顺序和导航 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({ json: { code: 0, data: { profile: { real_name: '测试创作者' }, workflow_synced: true } } }),
    )
    await page.route('**/api/v1/student-applications**', (route) =>
      route.fulfill({ json: { code: 0, data: { items: [], total: 0 } } }),
    )
    await page.goto('/script-ideas')
    await expect(page.locator('.si-entries h2')).toHaveText(['修改入驻信息', '提交创意', '我的创意'])
    await expect(page.getByRole('button', { name: '新建创意' })).toBeEnabled()
    await expect(page.getByRole('button', { name: '查看列表' })).toBeEnabled()
    expect(await page.locator('.home__content').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`entries-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '新建创意' }).click()
    await expect(page).toHaveURL(/\/script-ideas\/new$/)
    await expect(page.getByRole('heading', { name: '填写提交创意' })).toBeVisible()
    await page.goto('/script-ideas')
    await page.getByRole('button', { name: '查看列表' }).click()
    await expect(page).toHaveURL(/\/script-ideas\/list$/)
    await expect(page.getByRole('heading', { name: '我的创意' })).toBeVisible()
    expectNoUnexpectedApi(api)
  })
}
