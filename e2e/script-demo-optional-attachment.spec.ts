import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('本机演示中附件选填并显示原型文案', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.goto('/script-ideas/stage/demo')
  await page.getByLabel('申请人').fill('测试申请人')
  await page.getByLabel('学校').fill('测试学校')
  await page.getByLabel('剧名').fill('示例剧')
  const genre = page.getByRole('combobox', { name: '题材' })
  await genre.fill('悬疑')
  await genre.press('Enter')
  await expect(page.getByLabel('剧情简介')).toHaveAttribute('placeholder', /交代主角/)
  await page.getByLabel('剧情简介').fill('示例故事')
  await expect(page.getByLabel('剧本文档附件')).not.toHaveAttribute('required')
  await page.locator('.si-upload').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('demo-upload.png') })
  await page.getByRole('button', { name: '提交创意', exact: true }).click()
  await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
})
