import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`剧本错误字段标红并提示 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    if (width === 390) await page.emulateMedia({ reducedMotion: 'reduce' })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({ json: { code: 0, data: { profile: null, originality_version: 'o1', workflow_synced: false } } }),
    )
    let submitted: any = null
    await page.route('**/api/v1/student-applications/97/stages', (route) => {
      submitted = route.request().postDataJSON()
      return route.fulfill({ json: { code: 0, data: {} } })
    })
    await page.route('**/api/v1/student-applications/97', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 97, state: 'submitted', title: '示例', genre: '悬疑' },
            progress_available: true,
            workflow: {
              status: 1,
              flow_version: 5,
              structured: true,
              current_stage: 'script',
              review_status: submitted ? 'under_review' : 'awaiting_submission',
              stage: submitted ? 'waiting_review' : 'script',
              current_task: submitted
                ? null
                : {
                    task_id: 'script-97',
                    stage: 'script',
                    data: {
                      title_zh: '示例',
                      genre: '悬疑',
                      planned_episodes: 499,
                      duration_min_seconds: 7,
                      duration_max_seconds: 7,
                      first_paid_episode: 7,
                      act_outline: '故事大纲',
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
    await page.goto('/script-ideas/97')
    await page.getByRole('checkbox', { name: /我确认本剧本为原创/ }).check()
    await page.getByRole('button', { name: '提交剧本' }).click()
    const count = page.getByLabel('预计集数')
    const shortest = page.getByLabel('单集最短时长')
    const longest = page.getByLabel('单集最长时长')
    for (const field of [count, shortest, longest]) {
      await expect(field).toHaveAttribute('aria-invalid', 'true')
      await expect(field).toHaveCSS('border-color', 'rgb(216, 63, 63)')
    }
    await expect(count).toBeFocused()
    await expect(page.getByText('请输入 1 至 200 的整数')).toBeVisible()
    await expect(page.getByText('请输入 10 至 600 秒的整数')).toBeVisible()
    await expect(page.getByLabel('首个付费解锁集')).not.toHaveAttribute('aria-invalid', 'true')
    await expect(count).toHaveCSS('animation-name', width === 390 ? 'none' : 'si-input-shake')
    expect(submitted).toBeNull()
    await page.screenshot({ path: testInfo.outputPath('invalid-fields.png') })
    await count.fill('30')
    await expect(count).not.toHaveAttribute('aria-invalid', 'true')
    await shortest.fill('60')
    await longest.fill('90')
    await page.getByRole('button', { name: '提交剧本' }).click()
    await expect.poll(() => submitted).not.toBeNull()
    expect(submitted.data.planned_episodes).toBe(30)
    expect(submitted.data.duration_min_seconds).toBe(60)
    expect(submitted.data.duration_max_seconds).toBe(90)
  })
}
