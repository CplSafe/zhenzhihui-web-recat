import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`一卡附件选择保持页面布局并可下载模板 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/student-applications/96', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 96, state: 'submitted', title: '测试剧' },
            progress_available: true,
            workflow: {
              status: 1,
              flow_version: 5,
              structured: true,
              current_stage: 'card',
              stage: 'card',
              current_task: { task_id: 'card-96', stage: 'card', data: {} },
              versions: [],
              reviews: [],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas/96')
    const upload = page.locator('.si-upload')
    await upload.scrollIntoViewIfNeeded()
    const chooserPromise = page.waitForEvent('filechooser')
    await upload.getByText('点击选择文件').click()
    const chooser = await chooserPromise
    await chooser.setFiles({ name: '一卡.txt', mimeType: 'text/plain', buffer: Buffer.from('一卡') })
    await expect(page.getByText('一卡.txt', { exact: true })).toBeVisible()
    expect(await page.locator('.home').evaluate((el) => el.scrollTop)).toBe(0)
    await expect(upload.getByRole('link', { name: '下载一卡标准模板' })).toHaveAttribute(
      'href',
      '/script-idea-templates/一卡标准模板.docx',
    )
    const downloadPromise = page.waitForEvent('download')
    await upload.getByRole('link', { name: '下载一卡标准模板' }).click()
    expect((await downloadPromise).suggestedFilename()).toBe('一卡标准模板.docx')
    await upload.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('card-upload.png') })
  })
}
