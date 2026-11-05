import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`流程完成后展示最终剧本字段 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({ json: { code: 0, data: { profile: null, originality_version: 'v1', workflow_synced: true } } }),
    )
    await page.route('**/api/v1/student-applications/96', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 96, state: 'submitted', title: '测试剧', creative: '旧创意' },
            progress_available: true,
            workflow: {
              status: 2,
              flow_version: 5,
              structured: true,
              current_stage: 'script',
              review_status: 'approved',
              stage: 'finished',
              current_task: null,
              versions: [
                {
                  version: 1,
                  stage: 'creative',
                  task_id: 'creative',
                  content: '',
                  submitted_at: 1,
                  data: { title: '旧创意', genre: '悬疑' },
                },
                {
                  version: 6,
                  stage: 'script',
                  task_id: 'script',
                  content: '',
                  submitted_at: 6,
                  data: {
                    title_zh: '测试剧',
                    genre: '奇幻',
                    planned_episodes: 30,
                    duration_min_seconds: 60,
                    duration_max_seconds: 120,
                    first_paid_episode: 10,
                    act_outline: '最终分幕大纲',
                    world_rules: '最终世界观',
                    paywall_episodes: [10, 20],
                    attachments: [{ file_id: 11, file_name: '最终剧本.txt' }],
                  },
                },
              ],
              reviews: [],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas/96')
    await expect(page.getByRole('heading', { name: '已通过' })).toBeVisible()
    const details = page.locator('.si-readonly')
    for (const text of [
      '中文剧名',
      '测试剧',
      '奇幻',
      '预计集数',
      '30',
      '单集最短时长',
      '60',
      '单集最长时长',
      '120',
      '首个付费解锁集',
      '分幕大纲',
      '最终分幕大纲',
      '最终世界观',
      '最终剧本.txt',
    ])
      await expect(details).toContainText(text)
    await expect(details).not.toContainText('申请人')
    await expect(details.getByRole('link', { name: '最终剧本.txt' })).toHaveAttribute(
      'href',
      '/api/v1/script-files/11/download',
    )
    await page.screenshot({ path: testInfo.outputPath('finished-details.png') })
    await page.reload()
    await expect(details).toContainText('最终分幕大纲')
  })
}
