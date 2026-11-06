import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`题材下拉多选与提交 ${width}`, async ({ page }, testInfo) => {
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
    let submitted = ''
    await page.route('**/api/v1/script-files/uploads', (route) =>
      route.fulfill({ json: { code: 0, data: { file: { id: 56 }, upload_required: false } } }),
    )
    await page.route('**/api/v1/script-files/56/complete', (route) =>
      route.fulfill({ json: { code: 0, data: { id: 56, file_name: '故事.txt', file_size: 4, status: 'ready' } } }),
    )
    await page.route('**/api/v1/student-applications**', async (route) => {
      if (route.request().method() === 'POST') {
        posts++
        submitted = route.request().postData() || ''
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
    for (const [label, value] of [
      ['姓名', '测试学生'],
      ['学校 / 机构', '示例大学'],
      ['联系电话', '13800000000'],
    ]) {
      await expect(page.getByLabel(label)).toHaveValue('')
      await page.getByLabel(label).fill(value)
    }
    await page.getByLabel('故事创意').fill('一段故事')
    await page
      .getByLabel('剧本文档附件')
      .setInputFiles({ name: '故事.txt', mimeType: 'text/plain', buffer: Buffer.from('test') })
    const title = page.getByLabel('剧名')
    const genre = page.getByRole('combobox', { name: '题材' })
    const submit = page.getByRole('button', { name: '提交创意', exact: true })
    const selector = page.locator('.si-genre-select .ant-select-selector')
    const titleBox = await title.boundingBox()
    const genreBox = await selector.boundingBox()
    expect(titleBox).not.toBeNull()
    expect(genreBox).not.toBeNull()
    expect(Math.abs(titleBox!.width - genreBox!.width)).toBeLessThan(1)
    expect(Math.abs(titleBox!.height - genreBox!.height)).toBeLessThan(1)
    await title.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('genres-empty.png') })
    await title.fill('测试剧名')
    await submit.click()
    await expect(page.getByText('请填写题材', { exact: true })).toBeVisible()
    expect(posts).toBe(0)
    await genre.click()
    await expect(page.getByText('CEO豪门', { exact: true }).last()).toBeVisible()
    await genre.fill('悬疑')
    await page.getByTitle('悬疑', { exact: true }).last().click()
    await genre.fill('科幻')
    await page.getByTitle('科幻', { exact: true }).last().click()
    await genre.fill('自创题材')
    await genre.press('Enter')
    await expect(page.locator('.si-genre-select')).toContainText('悬疑')
    await expect(page.locator('.si-genre-select')).toContainText('科幻')
    await expect(page.locator('.si-genre-select')).toContainText('自创题材')
    await page.screenshot({ path: testInfo.outputPath('genres-selected.png'), fullPage: true })
    await submit.click()
    await expect.poll(() => posts).toBe(1)
    expect(JSON.parse(submitted).data.genre).toBe('悬疑、科幻、自创题材')
    await expect(page).toHaveURL(/script-ideas\/123/)
    await expect(page.getByText('审核中')).toBeVisible()
    await expect(page.getByText('页面加载失败')).toHaveCount(0)
    expect(pageErrors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
