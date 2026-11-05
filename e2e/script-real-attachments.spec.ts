import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`真实创意申请上传并关联附件 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            profile: { real_name: '测试用户', school: '测试学校', phone: '13800000000' },
            agreement_version: 'agreement-v1',
            originality_version: 'originality-v1',
            workflow_synced: true,
          },
        },
      }),
    )
    let uploadAttempts = 0
    let tickets = 0
    let submissions = 0
    let complete = false
    await page.route('**/api/v1/script-files/uploads', async (route) => {
      tickets++
      expect(route.request().postDataJSON()).toEqual({ file_name: '故事.txt', file_size: 7 })
      await route.fulfill({
        json: {
          code: 0,
          data: {
            file: { id: 55 },
            url: '/test-script-upload',
            form_fields: { key: 'document' },
            upload_required: true,
          },
        },
      })
    })
    await page.route('**/test-script-upload', async (route) => {
      uploadAttempts++
      expect(route.request().postData()).toContain('content')
      if (uploadAttempts === 1) return route.fulfill({ status: 500, body: 'failed' })
      await route.fulfill({ status: 204 })
    })
    await page.route('**/api/v1/script-files/55/complete', async (route) => {
      complete = true
      await route.fulfill({
        json: {
          code: 0,
          data: { id: 55, file_name: '故事.txt', file_size: 7, mime_type: 'text/plain', status: 'ready' },
        },
      })
    })
    await page.route('**/api/v1/student-applications', async (route) => {
      if (route.request().method() !== 'POST')
        return route.fulfill({ json: { code: 0, data: { items: [], total: 0 } } })
      submissions++
      const body = route.request().postDataJSON()
      expect(complete).toBe(true)
      expect(body.data.attachments[0].file_id).toBe(55)
      expect(body.data.synopsis).toBe('故事简介')
      expect(body.data.title).toBe('示例剧')
      expect(Object.keys(body)).toEqual(['data'])
      expect(body.data.attachments).toEqual([{ file_id: 55 }])
      await route.fulfill({ json: { code: 0, data: { id: 123, state: 'submitted' } } })
    })
    await page.route('**/api/v1/student-applications/123', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 123, state: 'submitted' },
            progress_available: true,
            workflow: { status: 1, stage: 'waiting_review', versions: [], reviews: [] },
          },
        },
      }),
    )
    await page.goto('/script-ideas/new')
    await page.getByLabel('姓名').fill('测试用户')
    await page.getByLabel('学校 / 机构').fill('测试学校')
    await page.getByLabel('联系电话').fill('13800000000')
    await page.getByLabel('剧名').fill('示例剧')
    await page.getByLabel('题材').fill('悬疑')
    await page.getByLabel('故事创意').fill('故事简介')
    await page.getByRole('button', { name: '提交创意', exact: true }).click()
    await expect(page.getByText('请选择剧本文档附件。')).toBeVisible()
    await page
      .getByLabel('剧本文档附件')
      .setInputFiles({ name: '故事.txt', mimeType: 'text/plain', buffer: Buffer.from('content') })
    await page.screenshot({ path: testInfo.outputPath('real-form.png'), fullPage: true })
    await page.getByRole('button', { name: '提交创意', exact: true }).click()
    await expect(page.getByText(/附件未能上传/)).toBeVisible()
    expect(submissions).toBe(0)
    await expect(page.getByLabel('剧名')).toHaveValue('示例剧')
    await page.getByRole('button', { name: '提交创意', exact: true }).click()
    await expect(page).toHaveURL(/script-ideas\/123/)
    expect(submissions).toBe(1)
    expect(tickets).toBe(2)
  })
}

test('新版一卡待办上传并提交关联文件', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          profile: null,
          agreement_version: 'agreement-v1',
          originality_version: 'originality-v1',
          workflow_synced: false,
        },
      },
    }),
  )
  let saved: any = null
  await page.route('**/api/v1/script-files/uploads', (route) =>
    route.fulfill({
      json: { code: 0, data: { file: { id: 66 }, url: '/test-stage-upload', form_fields: {}, upload_required: true } },
    }),
  )
  await page.route('**/test-stage-upload', (route) => route.fulfill({ status: 204 }))
  await page.route('**/api/v1/script-files/66/complete', (route) =>
    route.fulfill({ json: { code: 0, data: { id: 66, file_name: '一卡.txt', file_size: 4, status: 'ready' } } }),
  )
  await page.route('**/api/v1/student-applications/44/stages', async (route) => {
    saved = route.request().postDataJSON()
    await route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.route('**/api/v1/student-applications/44', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 44, title: '测试剧', state: 'submitted', creative: '剧名：测试剧\n\n题材：悬疑\n\n故事' },
          progress_available: true,
          workflow: {
            status: 1,
            flow_version: 5,
            structured: true,
            stage: saved ? 'waiting_review' : 'card',
            current_task: saved ? null : { task_id: 'card-1', stage: 'card' },
            versions: saved
              ? [
                  {
                    version: 2,
                    stage: 'card',
                    task_id: 'card-1',
                    content: saved.content,
                    data: { ...saved.data, attachments: [{ file_id: 66, file_name: '一卡.txt', file_size: 4 }] },
                    submitted_at: 2,
                  },
                ]
              : [],
            reviews: [],
          },
        },
      },
    }),
  )
  await page.goto('/script-ideas/44')
  for (const [label, value] of [
    ['英文剧名', 'Test'],
    ['一卡覆盖集数', '10'],
    ['免费段最强付费卡点', '9'],
    ['中文完整版剧情简介', '故事'],
    ['核心卖点', '卖点'],
    ['人物小传', '人物'],
    ['分集大纲与付费卡点', '大纲'],
  ])
    await page.getByLabel(label, { exact: false }).fill(value)
  await page
    .getByLabel('本次提交附件')
    .setInputFiles({ name: '一卡.txt', mimeType: 'text/plain', buffer: Buffer.from('card') })
  await page.getByRole('button', { name: '提交一卡' }).click()
  await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
  expect(saved.stage).toBe('card')
  expect(saved.data.title_en).toBe('Test')
  expect(saved.data.attachments).toEqual([{ file_id: 66 }])
  expect(saved.content).toBeUndefined()
  await expect(page.locator('.si-readonly')).toContainText('一卡.txt')
})
