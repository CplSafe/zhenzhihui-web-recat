import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`撤回创意后必填标记紧跟字段名 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({ json: { code: 0, data: { profile: null, originality_version: 'o1', workflow_synced: false } } }),
    )
    let withdrawn = false
    await page.route('**/api/v1/student-applications/91/withdraw', (route) => {
      withdrawn = true
      return route.fulfill({ json: { code: 0, data: {} } })
    })
    await page.route('**/api/v1/student-applications/91', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 91, state: 'submitted' },
            progress_available: true,
            workflow: {
              status: 1,
              flow_version: 5,
              structured: true,
              current_stage: 'creative',
              review_status: withdrawn ? 'withdrawn' : 'under_review',
              stage: withdrawn ? 'creative' : 'waiting_review',
              can_withdraw: !withdrawn,
              withdraw_task_id: 'withdraw-task',
              current_task: withdrawn ? { task_id: 'creative-next', stage: 'creative', data: {} } : null,
              versions: [],
              reviews: [],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas/91')
    await page.getByRole('button', { name: '撤回提交', exact: true }).click()
    await expect(page.getByRole('heading', { name: '已撤回' })).toBeVisible()
    await expect(page.locator('.si-approval')).toHaveCount(0)
    for (const name of ['申请人', '学校 / 机构', '联系电话', '剧名', '题材', '故事创意']) {
      const label = page.locator('.si-approved-fields > label').filter({ hasText: name })
      const positions = await label.evaluate((element) => {
        const text = element.querySelector('span')!.getBoundingClientRect()
        const star = element.querySelector('em')!.getBoundingClientRect()
        return { textTop: text.top, textBottom: text.bottom, starTop: star.top, starBottom: star.bottom }
      })
      expect(positions.starTop).toBeGreaterThanOrEqual(positions.textTop - 2)
      expect(positions.starBottom).toBeLessThanOrEqual(positions.textBottom + 2)
    }
    await page.screenshot({ path: testInfo.outputPath('creative-withdrawn.png'), fullPage: true })
  })
}
