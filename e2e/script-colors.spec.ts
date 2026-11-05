import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`剧本创意使用项目青绿色 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            profile: { real_name: '测试', school: '学校', phone: '13800000000' },
            agreement_version: 'v1',
            originality_version: 'v1',
            workflow_synced: true,
          },
        },
      }),
    )
    await page.route('**/api/v1/student-applications/98', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 98, state: 'submitted' },
            progress_available: true,
            workflow: {
              status: 1,
              flow_version: 5,
              structured: true,
              current_stage: 'script',
              review_status: 'awaiting_submission',
              stage: 'script',
              current_task: {
                task_id: 'script-98',
                stage: 'script',
                data: {
                  title_zh: '测试剧',
                  genre: '悬疑',
                  planned_episodes: 499,
                  duration_min_seconds: 7,
                  duration_max_seconds: 7,
                  first_paid_episode: 5,
                  act_outline: '故事大纲',
                },
              },
              versions: [],
              reviews: [],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas')
    await expect(page.locator('.si-page button.si-primary').first()).toHaveCSS('background-color', 'rgb(8, 126, 103)')
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`) })
    await page.goto('/script-ideas/98')
    await expect(page.locator('.si-progress [aria-current=step] b')).toHaveCSS('background-color', 'rgb(8, 126, 103)')
    await page.getByRole('button', { name: '提交剧本' }).click()
    await expect(page.getByLabel('预计集数')).toHaveCSS('border-color', 'rgb(216, 63, 63)')
    await expect(page.getByText('请输入 1 至 200 的整数')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`detail-${width}.png`) })
  })
}
