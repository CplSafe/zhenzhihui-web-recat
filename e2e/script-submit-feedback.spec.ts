import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`剧本未确认原创时显示就近提示 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({ json: { code: 0, data: { profile: null, originality_version: 'o1', workflow_synced: false } } }),
    )
    let stagePosts = 0
    await page.route('**/api/v1/student-applications/95/stages', (route) => {
      stagePosts++
      return route.fulfill({ json: { code: 0, data: {} } })
    })
    await page.route('**/api/v1/student-applications/95', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 95, state: 'submitted', title: '示例', genre: '悬疑' },
            progress_available: true,
            workflow: {
              status: 1,
              flow_version: 5,
              structured: true,
              current_stage: 'script',
              review_status: stagePosts ? 'under_review' : 'awaiting_submission',
              stage: stagePosts ? 'waiting_review' : 'script',
              current_task: stagePosts
                ? null
                : {
                    task_id: 'script-95',
                    stage: 'script',
                    data: {
                      title_zh: '示例',
                      genre: '悬疑',
                      planned_episodes: 20,
                      duration_min_seconds: 60,
                      duration_max_seconds: 90,
                      first_paid_episode: 5,
                      act_outline: '第一幕',
                      attachments: [{ file_id: 8, file_name: '剧本.txt' }],
                    },
                  },
              versions: [],
              reviews: [],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas/95')
    const checkbox = page.getByRole('checkbox', { name: /我确认本剧本为原创/ })
    await expect(checkbox).not.toBeChecked()
    await page.getByRole('button', { name: '提交剧本' }).click()
    const error = page.locator('.si-submit-error')
    await expect(error).toHaveText('请勾选原创声明后提交。')
    expect(stagePosts).toBe(0)
    const dimensions = await checkbox.evaluate((input) => {
      const label = input.closest('label')!
      const a = input.getBoundingClientRect(),
        b = label.getBoundingClientRect()
      return { width: a.width, offset: a.left - b.left }
    })
    expect(dimensions.width).toBeLessThanOrEqual(20)
    expect(dimensions.offset).toBeLessThan(10)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(error).toHaveText('请勾选原创声明后提交。')
    await page.screenshot({ path: testInfo.outputPath('script-validation.png') })
    await checkbox.check()
    await expect(error).toHaveCount(0)
    await page.getByRole('button', { name: '提交剧本' }).click()
    await expect.poll(() => stagePosts).toBe(1)
    await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
    await expect.poll(() => page.locator('.home__content').evaluate((element) => element.scrollTop)).toBe(0)
  })
}
