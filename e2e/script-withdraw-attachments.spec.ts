import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`撤回后保留本阶段最近附件并可重提 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({ json: { code: 0, data: { profile: null, originality_version: 'v1', workflow_synced: true } } }),
    )
    let withdrawn = false
    let submitted: any = null
    const data = {
      title_zh: '示例',
      genre: '悬疑',
      planned_episodes: 30,
      duration_min_seconds: 60,
      duration_max_seconds: 120,
      first_paid_episode: 10,
      act_outline: '大纲',
    }
    await page.route('**/api/v1/student-applications/94/withdraw', (route) => {
      withdrawn = true
      return route.fulfill({ json: { code: 0, data: {} } })
    })
    await page.route('**/api/v1/student-applications/94/stages', (route) => {
      submitted = route.request().postDataJSON()
      return route.fulfill({ json: { code: 0, data: {} } })
    })
    await page.route('**/api/v1/student-applications/94', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 94, state: 'submitted', title: '示例', genre: '悬疑' },
            progress_available: true,
            workflow: {
              status: 1,
              flow_version: 5,
              structured: true,
              current_stage: 'script',
              review_status: submitted ? 'under_review' : withdrawn ? 'withdrawn' : 'under_review',
              stage: withdrawn && !submitted ? 'script' : 'waiting_review',
              can_withdraw: !withdrawn,
              withdraw_task_id: 'review-94',
              current_task: withdrawn && !submitted ? { task_id: 'script-new', stage: 'script', data } : null,
              versions: [
                {
                  version: 3,
                  stage: 'script',
                  task_id: 'old',
                  content: '',
                  submitted_at: 1,
                  data: { attachments: [{ file_id: 10, file_name: '旧版.txt' }] },
                },
                {
                  version: 5,
                  stage: 'card',
                  task_id: 'card',
                  content: '',
                  submitted_at: 3,
                  data: { attachments: [{ file_id: 12, file_name: '其他阶段.txt' }] },
                },
                {
                  version: 4,
                  stage: 'script',
                  task_id: 'last',
                  content: '',
                  submitted_at: 2,
                  data: { attachments: [{ file_id: 11, file_name: '本阶段.txt' }] },
                },
              ],
              reviews: [],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas/94')
    await page.getByRole('button', { name: '撤回提交', exact: true }).click()
    await expect(page.getByText('将沿用本阶段已有附件：本阶段.txt')).toBeVisible()
    await page.reload()
    await expect(page.getByText('将沿用本阶段已有附件：本阶段.txt')).toBeVisible()
    await page.getByText('将沿用本阶段已有附件：本阶段.txt').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('withdraw-attachment.png'), fullPage: true })
    await page.getByRole('checkbox', { name: /我确认本剧本为原创/ }).check()
    await page.getByRole('button', { name: '提交剧本' }).click()
    await expect.poll(() => submitted).not.toBeNull()
    expect(submitted.data.attachments).toEqual([{ file_id: 11 }])
    await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
  })
}

test('撤回后继续选择附件会保留并提交原附件', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({ json: { code: 0, data: { profile: null, originality_version: 'v1', workflow_synced: true } } }),
  )
  let submitted: any = null
  await page.route('**/api/v1/script-files/uploads', (route) =>
    route.fulfill({
      json: { code: 0, data: { file: { id: 13 }, url: '/test-new-upload', form_fields: {}, upload_required: true } },
    }),
  )
  await page.route('**/test-new-upload', (route) => route.fulfill({ status: 204 }))
  await page.route('**/api/v1/script-files/13/complete', (route) =>
    route.fulfill({ json: { code: 0, data: { id: 13, file_name: '新稿.txt', file_size: 3, status: 'ready' } } }),
  )
  await page.route('**/api/v1/student-applications/95/stages', (route) => {
    submitted = route.request().postDataJSON()
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.route('**/api/v1/student-applications/95', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 95, state: 'submitted' },
          progress_available: true,
          workflow: {
            status: 1,
            flow_version: 5,
            structured: true,
            current_stage: 'script',
            review_status: 'withdrawn',
            stage: 'script',
            current_task: {
              task_id: 'script-new',
              stage: 'script',
              data: {
                title_zh: '示例',
                genre: '悬疑',
                planned_episodes: 30,
                duration_min_seconds: 60,
                duration_max_seconds: 120,
                first_paid_episode: 10,
                act_outline: '大纲',
              },
            },
            versions: [
              {
                version: 1,
                stage: 'script',
                task_id: 'old',
                content: '',
                submitted_at: 1,
                data: { attachments: [{ file_id: 11, file_name: '原稿.txt' }] },
              },
            ],
            reviews: [],
          },
        },
      },
    }),
  )
  await page.goto('/script-ideas/95')
  await expect(page.getByText('将沿用本阶段已有附件：原稿.txt')).toBeVisible()
  await page
    .getByLabel('本次提交附件')
    .setInputFiles({ name: '新稿.txt', mimeType: 'text/plain', buffer: Buffer.from('new') })
  await expect(page.getByText('将沿用本阶段已有附件：原稿.txt')).toBeVisible()
  await page.getByRole('checkbox', { name: /我确认本剧本为原创/ }).check()
  await page.getByRole('button', { name: '提交剧本' }).click()
  await expect.poll(() => submitted).not.toBeNull()
  expect(submitted.data.attachments).toEqual([{ file_id: 11 }, { file_id: 13 }])
})
