import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`入驻联系手机格式校验 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    let writes = 0
    await page.route('**/api/v1/script-creators/me', (route) => {
      if (route.request().method() === 'PUT') {
        writes++
        expect(route.request().postDataJSON().phone).toBe('13800001111')
        return route.fulfill({ status: 400, json: { code: 400, message: '测试请求已发送' } })
      }
      return route.fulfill({
        json: { code: 0, data: { profile: null, agreement_version: 'v1', workflow_synced: false } },
      })
    })
    await page.goto('/script-ideas/join')
    await page.getByLabel('真实姓名').fill('林知夏')
    await page.getByLabel('学生状态').selectOption({ label: '在校学生' })
    await page.getByRole('radio', { name: /业余创作者/ }).check()
    await page.getByLabel('学校全称').fill('测试学校')
    await page.getByLabel('省 / 直辖市').selectOption('山东省')
    await page.getByLabel('城市', { exact: true }).selectOption('济宁市')
    const phone = page.getByLabel('联系手机')
    await phone.fill('12345678901')
    await expect(phone).toHaveAttribute('aria-invalid', 'true')
    await page.getByLabel('联系邮箱').fill('test@example.com')
    await page.getByLabel(/擅长题材/).fill('悬疑')
    await page.getByLabel(/擅长题材/).press('Enter')
    await page.getByRole('checkbox', { name: /我已阅读并同意/ }).check()
    await page.getByRole('button', { name: '提交入驻信息' }).click()
    expect(writes).toBe(0)
    await expect(page.getByRole('alert')).toContainText('请输入正确的 11 位手机号码')
    await phone.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`script-phone-${width}.png`), animations: 'disabled' })
    await phone.fill('13800001111')
    await page.getByRole('button', { name: '提交入驻信息' }).click()
    await expect.poll(() => writes).toBe(1)
  })
}

test('退回创意修改时阻止无效联系电话提交', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({ json: { code: 0, data: { profile: null, workflow_synced: false } } }),
  )
  let submitted: any = null
  await page.route('**/api/v1/student-applications/92/stages', (route) => {
    submitted = route.request().postDataJSON()
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.route('**/api/v1/student-applications/92', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 92, state: 'submitted' },
          progress_available: true,
          workflow: {
            status: 1,
            flow_version: 5,
            structured: true,
            current_stage: 'creative',
            review_status: submitted ? 'under_review' : 'needs_changes',
            stage: submitted ? 'waiting_review' : 'creative',
            current_task: submitted
              ? null
              : {
                  task_id: 'creative-2',
                  stage: 'creative',
                  data: {
                    applicant_name: '张三',
                    applicant_phone: '13800000000',
                    applicant_school: '学校',
                    title: '故事',
                    genre: '悬疑',
                    synopsis: '简介',
                    attachments: [],
                  },
                },
            versions: [],
            reviews: [],
          },
        },
      },
    }),
  )
  await page.goto('/script-ideas/92')
  const phone = page.getByLabel('联系电话')
  await phone.fill('abcdef')
  await expect(phone).toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('button', { name: '提交创意' }).click()
  expect(submitted).toBeNull()
  await expect(page.getByText('请输入正确的 11 位手机号码')).toBeVisible()
  await phone.fill('13800000000')
  await page.getByRole('button', { name: '提交创意' }).click()
  await expect.poll(() => submitted).not.toBeNull()
  expect(submitted.data.applicant_phone).toBe('13800000000')
})
