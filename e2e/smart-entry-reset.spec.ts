import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('切换创作类型需确认，侧边栏重新进入时恢复全新入口', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.addInitScript(() => {
    window.localStorage.setItem('zzh_guide_seen_smart_u7', '1')
  })

  await page.goto('/smart')
  const input = page.getByRole('textbox', { name: '创作需求' })
  await input.fill('切换前不应直接丢失的文案')

  await page.getByRole('tab', { name: '制作图片' }).click()
  const confirm = page.getByRole('alertdialog', { name: '切换创作类型' })
  await expect(confirm).toContainText('切换后当前输入和素材将不会保留')
  await confirm.getByRole('button', { name: '取消' }).click()
  await expect(page.getByRole('tab', { name: '制作视频' })).toHaveAttribute('aria-selected', 'true')
  await expect(input).toHaveValue('切换前不应直接丢失的文案')

  await page.getByRole('tab', { name: '制作图片' }).click()
  await page.getByRole('alertdialog', { name: '切换创作类型' }).getByRole('button', { name: '确认离开' }).click()
  await expect(page.getByRole('tab', { name: '制作图片' })).toHaveAttribute('aria-selected', 'true')
  await expect(input).toHaveValue('')

  await input.fill('已完成任务遗留的旧文案')
  await page.getByRole('button', { name: '爆款成片' }).click()
  await expect(page).toHaveURL(/\/smart$/)
  await expect(page.getByRole('tab', { name: '制作视频' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('textbox', { name: '创作需求' })).toHaveValue('')
})
