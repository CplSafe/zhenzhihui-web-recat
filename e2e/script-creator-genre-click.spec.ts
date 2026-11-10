import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('题材选项支持鼠标选择、自定义输入和键盘操作', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({ json: { code: 0, data: { profile: null, workflow_synced: true } } }),
  )
  await page.goto('/script-ideas/join')
  const input = page.getByLabel('擅长题材（可多选）')
  await input.click()
  await page.getByRole('button', { name: 'CEO豪门' }).click()
  await expect(page.getByRole('button', { name: '移除题材 CEO豪门' })).toBeVisible()
  await input.fill('自定义题材')
  await page.getByRole('button', { name: '添加“自定义题材”' }).click()
  await expect(page.getByRole('button', { name: '移除题材 自定义题材' })).toBeVisible()
  await input.fill('契约婚姻')
  await input.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '移除题材 契约婚姻' })).toBeVisible()
  await input.click()
  await input.press('Escape')
  await expect(input).toHaveAttribute('aria-expanded', 'false')
  await input.click()
  await page.getByText('创作方向', { exact: true }).click()
  await expect(input).toHaveAttribute('aria-expanded', 'false')
  await input.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('genres-selected.png') })
})

test.describe('触屏选择', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
  test('触摸选项后添加题材', async ({ page }) => {
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({ json: { code: 0, data: { profile: null, workflow_synced: true } } }),
    )
    await page.goto('/script-ideas/join')
    await page.getByLabel('擅长题材（可多选）').tap()
    await page.getByRole('button', { name: 'CEO豪门' }).tap()
    await expect(page.getByRole('button', { name: '移除题材 CEO豪门' })).toBeVisible()
  })
})
