import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`剧本创意首页保留主入口并移除阶段说明 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const api = await installStrictAuthenticatedApp(page)
    let joined = false
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            profile: joined ? { real_name: '测试创作者', phone: '13800000000', school: '测试学校' } : null,
            agreement_version: '',
            originality_version: '',
            workflow_synced: joined,
          },
        },
      }),
    )
    await page.route('**/api/v1/student-applications?**', (route) =>
      route.fulfill({ json: { code: 0, data: { items: [], total: 0 } } }),
    )
    await page.goto('/script-ideas')
    await expect(page.getByRole('heading', { name: '剧本创意', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '立即入驻' })).toBeVisible()
    await expect(page.getByRole('button', { name: '查看列表' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '新建创意' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '← 返回' })).toHaveCount(0)
    await expect(page.getByText('创意征集中')).toHaveCount(0)
    await expect(page.getByText('第一次使用？先填写申请人信息。')).toHaveCount(0)
    await expect(page.getByText('不同阶段，交不同的内容')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '查看填写规范' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '查看完善剧本' })).toHaveCount(0)
    expect(await page.locator('.home__content').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`home-${viewport.width}.png`), fullPage: true })
    joined = true
    await page.reload()
    await expect(page.getByRole('button', { name: '查看 / 修改' })).toBeVisible()
    await expect(page.getByRole('button', { name: '查看列表' })).toBeEnabled()
    await expect(page.getByRole('button', { name: '新建创意' })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath(`home-joined-${viewport.width}.png`), fullPage: true })
    await page.getByRole('button', { name: '查看列表' }).click()
    await expect(page).toHaveURL(/\/script-ideas\/list$/)
    await page.goto('/script-ideas')
    await expect(page.getByRole('button', { name: '新建创意' })).toBeEnabled()
    await page.getByRole('button', { name: '新建创意' }).click()
    await expect(page).toHaveURL(/\/script-ideas\/new$/)
    await expect(page.getByRole('button', { name: '← 返回' })).toBeVisible()
    expectNoUnexpectedApi(api)
  })
}
