import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('附件选择状态随数量变化，达到上限后禁止选择和拖放', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({ json: { code: 0, data: { profile: null, workflow_synced: true } } }),
  )
  await page.goto('/script-ideas/new')
  const picker = page.locator('.si-upload')
  const input = page.getByLabel('剧本文档附件')
  await expect(picker.getByRole('status')).toHaveText('未选择文件')
  const file = (index: number) => ({ name: `文件${index}.txt`, mimeType: 'text/plain', buffer: Buffer.from('内容') })
  await input.setInputFiles([file(1)])
  await expect(picker.getByRole('status')).toHaveText('请继续上传文件')
  await input.setInputFiles(Array.from({ length: 29 }, (_, index) => file(index + 2)))
  await expect(picker.getByRole('status')).toHaveText('文件数量已到上限')
  await expect(input).toBeDisabled()
  await picker.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('attachment-limit.png') })
  await picker.locator('.si-upload-drop').evaluate((element) => {
    const data = new DataTransfer()
    data.items.add(new File(['内容'], '多余.txt', { type: 'text/plain' }))
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }))
  })
  await expect(page.getByText('多余.txt')).toHaveCount(0)
  await page.getByRole('button', { name: '删除附件 文件1.txt' }).click()
  await expect(input).toBeEnabled()
  await expect(picker.getByRole('status')).toHaveText('请继续上传文件')
})
