import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('创意列表通过服务端搜索并显示真实申请', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({ json: { code: 0, data: { profile: null, workflow_synced: false } } }),
  )
  await page.route('**/api/v1/student-applications?**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q')
    return route.fulfill({
      json: {
        code: 0,
        data: {
          items:
            q === '不存在'
              ? []
              : [
                  { id: 123, name: '张三', state: 'submitted', title: '示例剧', review_status: 'under_review' },
                  { id: 124, state: 'submitted' },
                ],
          total: q === '不存在' ? 0 : 2,
          stats: { submitted: 2, under_review: 1 },
        },
      },
    })
  })
  await page.route('**/api/v1/student-applications/123', (route) =>
    route.fulfill({
      json: { code: 0, data: { application: { id: 123, state: 'submitted' }, progress_available: false } },
    }),
  )
  await page.route('**/api/v1/student-applications/124', (route) =>
    route.fulfill({
      json: { code: 0, data: { application: { id: 124, state: 'submitted' }, progress_available: false } },
    }),
  )
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/script-ideas/list?view=demo')
    await expect(page.getByText('示例剧')).toBeVisible()
    await expect(page.locator('.si-list-row').filter({ hasText: '创意申请' }).locator('strong')).toHaveText('创意申请')
    await page.getByPlaceholder('剧名、姓名、学校或申请编号').fill('不存在')
    await expect(page.getByText('没有匹配的申请。')).toBeVisible()
    await page.getByRole('button', { name: '重置' }).click()
    await expect(page.getByText('示例剧')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`script-list-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: /创意申请/ }).click()
  await expect(page).toHaveURL(/\/script-ideas\/124$/)
  expectNoUnexpectedApi(api)
})
