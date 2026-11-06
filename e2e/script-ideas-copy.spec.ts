import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`创意提交页不显示原型和内部说明 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            profile: { real_name: '测试创作者', phone: '13800000000', school: '测试学校' },
            workflow_synced: true,
          },
        },
      }),
    )
    await page.goto('/script-ideas/new')
    await expect(page.getByRole('heading', { name: '填写提交创意' })).toBeVisible()
    await expect(page.getByText('按原型体验四阶段流程')).toHaveCount(0)
    await expect(page.getByText('新建本机演示创意')).toHaveCount(0)
    await expect(page.getByText('把故事讲明白，提交完整文本。')).toHaveCount(0)
    await expect(page.getByText('附件将在提交时上传并关联申请')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /下载模板/ })).toBeVisible()
    await expect(page.getByText('申请人信息', { exact: true })).toBeVisible()
    expect(await page.locator('.home__content').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`submission-${width}.png`), fullPage: true })
    expectNoUnexpectedApi(api)
  })
}
