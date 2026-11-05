import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`删除本次选择和已上传附件 ${width}px`, async ({ page }, testInfo) => {
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
    let deletes = 0
    let tickets = 0
    await page.route('**/api/v1/script-files/uploads', (route) => {
      tickets++
      return route.fulfill({
        json: {
          code: 0,
          data: { file: { id: 55 }, url: '/test-script-upload', form_fields: {}, upload_required: true },
        },
      })
    })
    await page.route('**/test-script-upload', (route) => route.fulfill({ status: 204 }))
    await page.route('**/api/v1/script-files/55/complete', (route) =>
      route.fulfill({ json: { code: 0, data: { id: 55, file_name: '故事.txt', file_size: 3, status: 'ready' } } }),
    )
    await page.route('**/api/v1/script-files/55', (route) => {
      expect(route.request().method()).toBe('DELETE')
      deletes++
      return deletes === 1
        ? route.fulfill({ status: 409, json: { code: 1, message: '文件已关联申请' } })
        : route.fulfill({ status: 200, json: { code: 0, data: null } })
    })
    await page.route('**/api/v1/student-applications', (route) =>
      route.fulfill({ status: 400, json: { code: 1, message: '提交失败' } }),
    )
    await page.goto('/script-ideas/new')
    await page.getByLabel('剧名').fill('测试剧')
    await page.getByLabel('题材').fill('悬疑')
    await page.getByLabel('故事创意').fill('简介')
    const input = page.getByLabel('剧本文档附件')
    await input.setInputFiles({ name: '草稿.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') })
    await page.getByRole('button', { name: '删除附件 草稿.txt' }).click()
    expect(deletes).toBe(0)
    await input.setInputFiles({ name: '故事.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') })
    await page.getByRole('button', { name: '删除附件 故事.txt' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('attachment-delete.png') })
    await page.getByRole('button', { name: '提交创意', exact: true }).click()
    await expect(page.getByText('提交失败', { exact: true })).toBeVisible()
    expect(tickets).toBe(1)
    await page.getByRole('button', { name: '删除附件 故事.txt' }).click()
    await expect(page.getByText(/附件删除失败：文件已关联申请/)).toBeVisible()
    await expect(page.getByRole('button', { name: '删除附件 故事.txt' })).toBeVisible()
    await page.getByRole('button', { name: '删除附件 故事.txt' }).click()
    await expect(page.getByRole('button', { name: '删除附件 故事.txt' })).toHaveCount(0)
    expect(deletes).toBe(2)
    await input.setInputFiles({ name: '故事.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') })
    await expect(page.getByRole('button', { name: '删除附件 故事.txt' })).toBeVisible()
  })
}

test('从本次提交移除历史附件但不删除历史文件', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({ json: { code: 0, data: { profile: null, originality_version: 'v1', workflow_synced: true } } }),
  )
  let body: any = null
  let deletes = 0
  await page.route('**/api/v1/script-files/**', (route) => {
    deletes++
    return route.fulfill({ status: 500 })
  })
  await page.route('**/api/v1/student-applications/97/stages', (route) => {
    body = route.request().postDataJSON()
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.route('**/api/v1/student-applications/97', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 97, state: 'submitted' },
          progress_available: true,
          workflow: {
            status: 1,
            flow_version: 5,
            structured: true,
            current_stage: 'script',
            review_status: 'withdrawn',
            stage: 'script',
            current_task: {
              task_id: 'script',
              stage: 'script',
              data: {
                title_zh: '示例',
                genre: '悬疑',
                planned_episodes: 30,
                duration_min_seconds: 60,
                duration_max_seconds: 120,
                first_paid_episode: 10,
                act_outline: '大纲',
                attachments: [
                  { file_id: 11, file_name: '旧稿一.txt' },
                  { file_id: 12, file_name: '旧稿二.txt' },
                ],
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
  await page.getByRole('button', { name: '移除本次附件 旧稿一.txt' }).click()
  await expect(page.getByRole('button', { name: '移除本次附件 旧稿一.txt' })).toHaveCount(0)
  await page.getByLabel('我确认本剧本为原创，并同意平台用于后续制作评估').check()
  await page.getByRole('button', { name: '提交剧本' }).click()
  await expect.poll(() => body).not.toBeNull()
  expect(body.data.attachments).toEqual([{ file_id: 12 }])
  expect(deletes).toBe(0)
})
