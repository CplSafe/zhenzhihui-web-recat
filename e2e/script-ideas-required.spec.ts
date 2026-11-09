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
    await expect(page.locator('.si-approval')).toHaveCount(0)
    await expect(page.getByText('节点配置暂不可用')).toHaveCount(0)
    await page.getByLabel('剧名').fill('上次的剧名')
    await page.getByLabel('故事创意').fill('上次的故事')
    await page.getByLabel('第一集剧本剧情（选填）').fill('上次的第一集')
    await page.getByLabel('人物、身份、性格（选填）').fill('上次的人物')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '新建创意' }).click()
    for (const label of ['剧名', '故事创意', '第一集剧本剧情（选填）', '人物、身份、性格（选填）']) {
      await expect(page.getByLabel(label)).toHaveValue('')
    }
    await expect(page.getByText('故事创意最多 12000 个字符。')).toHaveCount(0)
    for (const label of ['故事创意', '第一集剧本剧情（选填）', '人物、身份、性格（选填）']) {
      const field = page.getByLabel(label)
      await field.fill('文'.repeat(19999) + '😀' + '超')
      await expect(field).toHaveValue('文'.repeat(19999) + '😀')
    }
    await page
      .getByLabel('剧本文档附件')
      .setInputFiles({ name: '故事.txt', mimeType: 'text/plain', buffer: Buffer.from('test') })
    const title = page.getByLabel('剧名')
    const genre = page.getByRole('combobox', { name: '题材' })
    const submit = page.getByRole('button', { name: '提交创意', exact: true })
    await expect(title).toHaveAttribute('required', '')
    await expect(genre).toHaveAttribute('aria-required', 'true')
    await submit.click()
    await expect(page.getByText('请填写剧名', { exact: true })).toBeVisible()
    await expect(page.getByText('请填写题材', { exact: true })).toBeVisible()
    expect(posts).toBe(0)
    await title.fill('测试剧名')
    await submit.click()
    await expect(page.getByText('请填写题材', { exact: true })).toBeVisible()
    expect(posts).toBe(0)
    await genre.fill('奇幻')
    await genre.press('Enter')
    await title.fill('   ')
    await submit.click()
    await expect(page.getByText('请填写剧名', { exact: true })).toBeVisible()
    expect(posts).toBe(0)
    await title.fill('测试剧名')
    await genre.focus()
    await genre.press('Backspace')
    await submit.click()
    await expect(page.getByText('请填写题材', { exact: true })).toBeVisible()
    await expect(genre).toBeFocused()
    expect(posts).toBe(0)
    await page.screenshot({ path: testInfo.outputPath('required-fields.png') })
    await genre.fill('奇幻')
    await genre.press('Enter')
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

test('创意无需附件也可提交，并支持拖放与移除', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          profile: { real_name: '测试学生', school: '示例大学', phone: '13800000000' },
          workflow_synced: true,
        },
      },
    }),
  )
  let submitted: any = null
  await page.route('**/api/v1/student-applications**', (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON()
      return route.fulfill({ json: { code: 0, data: { id: 124, state: 'submitted' } } })
    }
    return route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 124, state: 'submitted' },
          progress_available: true,
          workflow: { status: 1, stage: 'waiting_review', versions: [], reviews: [] },
        },
      },
    })
  })
  await page.goto('/script-ideas/new')
  await page.getByLabel('剧名').fill('测试剧名')
  await page.getByRole('combobox', { name: '题材' }).fill('奇幻')
  await page.getByRole('combobox', { name: '题材' }).press('Enter')
  await page.getByLabel('故事创意').fill('故事')
  await expect(page.getByText('这份附件要写什么？')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '下载创意模板' })).toBeVisible()
  await expect(page.locator('.si-upload a[download]')).toHaveCount(0)
  await page.locator('.si-upload-drop').evaluate((element) => {
    const data = new DataTransfer()
    data.items.add(new File(['内容'], '拖放.txt', { type: 'text/plain' }))
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }))
  })
  await expect(page.getByText('拖放.txt')).toBeVisible()
  await page.locator('.si-upload').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('optional-upload-mobile.png') })
  await page.getByRole('button', { name: '删除附件 拖放.txt' }).click()
  await page.getByRole('button', { name: '提交创意', exact: true }).click()
  await expect.poll(() => submitted).not.toBeNull()
  expect(submitted.data.attachments).toEqual([])
})
