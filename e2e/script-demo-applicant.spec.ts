import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`本机演示申请人和学校必填并可恢复 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.goto('/script-ideas/stage/demo')
    await page.getByRole('button', { name: '提交创意', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('申请人、学校')
    await page.getByLabel('申请人').fill('张三')
    await page.getByLabel('学校').fill('示例学校')
    await page.getByLabel('剧名').fill('示例剧')
    await page.getByLabel('题材').fill('悬疑')
    await page.getByLabel('剧情简介').fill('故事简介')
    await page
      .getByLabel('剧本文档附件')
      .setInputFiles({ name: '示例.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('demo') })
    await page.reload()
    await expect(page.getByLabel('申请人')).toHaveValue('张三')
    await expect(page.getByLabel('学校')).toHaveValue('示例学校')
    await page.screenshot({ path: testInfo.outputPath('applicant-form.png'), fullPage: true })
    await page.getByRole('button', { name: '提交创意', exact: true }).click()
    await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
    await expect(page.locator('.si-readonly')).toContainText('张三')
    await expect(page.locator('.si-readonly')).toContainText('示例学校')
    await page.getByRole('button', { name: '撤回提交' }).click()
    await expect(page.getByLabel('申请人')).toHaveValue('张三')
    await page.getByLabel('学校').fill('')
    await page.getByRole('button', { name: '重新提交创意' }).click()
    await expect(page.getByRole('alert')).toContainText('学校')
    expectNoUnexpectedApi(api)
  })
}
