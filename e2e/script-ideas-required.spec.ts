import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`创意申请必须填写剧名和题材 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            profile: { real_name: '测试学生', school: '示例大学', phone: '13800000000' },
            agreement_version: 'agreement-v1',
            originality_version: 'originality-v1',
            workflow_synced: true,
          },
        },
      }),
    )
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    let posts = 0
    await page.route('**/api/v1/script-files/uploads', (route) =>
      route.fulfill({ json: { code: 0, data: { file: { id: 56 }, upload_required: false } } }),
    )
    await page.route('**/api/v1/script-files/56/complete', (route) =>
      route.fulfill({ json: { code: 0, data: { id: 56, file_name: '故事.txt', file_size: 4, status: 'ready' } } }),
    )
    await page.route('**/api/v1/student-applications**', async (route) => {
      if (route.request().method() === 'POST') {
        posts++
        return route.fulfill({ json: { code: 0, data: { id: 123, state: 'submitted' } } })
      }
      if (new URL(route.request().url()).pathname.endsWith('/123')) {
        return route.fulfill({
          json: {
            code: 0,
            data: {
              application: { id: 123, state: 'submitted', creative: '一段故事' },
              progress_available: true,
              workflow: { status: 1, stage: 'waiting_review', current_task: null, versions: [], reviews: [] },
            },
          },
        })
      }
      return route.fulfill({ json: { code: 0, data: { items: [], total: 0 } } })
    })
    await page.goto('/script-ideas/new')
    await page.getByLabel('姓名').fill('测试学生')
    await page.getByLabel('联系电话').fill('13800000000')
    await page.getByLabel('学校 / 机构').fill('示例大学')
    await page.getByLabel('故事创意').fill('一段故事')
    await page
      .getByLabel('剧本文档附件')
      .setInputFiles({ name: '故事.txt', mimeType: 'text/plain', buffer: Buffer.from('test') })
    const title = page.getByLabel('剧名')
    const genre = page.getByLabel('题材')
    const submit = page.getByRole('button', { name: '提交创意', exact: true })
    await expect(title).toHaveAttribute('required', '')
    await expect(genre).toHaveAttribute('required', '')
    await submit.click()
    await expect(page.getByText('请填写剧名', { exact: true })).toBeVisible()
    await expect(page.getByText('请填写题材', { exact: true })).toBeVisible()
    expect(posts).toBe(0)
    await title.fill('测试剧名')
    await submit.click()
    await expect(page.getByText('请填写题材', { exact: true })).toBeVisible()
    expect(posts).toBe(0)
    await genre.fill('奇幻')
    await title.fill('   ')
    await submit.click()
    await expect(page.getByText('请填写剧名', { exact: true })).toBeVisible()
    expect(posts).toBe(0)
    await title.fill('测试剧名')
    await genre.fill('   ')
    await submit.click()
    await expect(page.getByText('请填写题材', { exact: true })).toBeVisible()
    await expect(genre).toBeFocused()
    expect(posts).toBe(0)
    await page.screenshot({ path: testInfo.outputPath('required-fields.png') })
    await genre.fill('奇幻')
    await expect(page.getByText('请填写题材', { exact: true })).toHaveCount(0)
    await submit.click()
    await expect.poll(() => posts).toBe(1)
    await expect(page).toHaveURL(/script-ideas\/123/)
    await expect(page.getByText('审核中')).toBeVisible()
    await expect(page.getByText('页面加载失败')).toHaveCount(0)
    expect(pageErrors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
