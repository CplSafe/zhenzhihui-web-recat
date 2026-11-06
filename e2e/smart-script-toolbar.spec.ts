import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1920, 390]) {
  test(`爆款脚本位于素材引用后并可选择 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.addInitScript(() => localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
    await page.goto('/smart')
    const prompt = page.getByRole('textbox', { name: '创作需求' })
    await prompt.fill('推广新品咖啡')
    const script = page.getByRole('button', { name: '选择爆款脚本' })
    await expect(script).toBeVisible()
    const at = page.getByTitle('引用参考素材')
    if (await at.isVisible()) {
      const atBounds = (await at.boundingBox())!
      const scriptBounds = (await script.boundingBox())!
      expect(scriptBounds.x).toBeGreaterThan(atBounds.x + atBounds.width - 1)
      expect(Math.abs(scriptBounds.y - atBounds.y)).toBeLessThan(5)
    } else {
      await page.getByRole('button', { name: '更多创作选项' }).click()
      await expect(at).toBeVisible()
      await page.getByRole('button', { name: '更多创作选项' }).click()
    }
    await script.click()
    await expect(page.getByRole('option', { name: '电商广告' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('script-menu.png') })
    await page.getByRole('option', { name: '电商广告' }).click()
    await expect(prompt).toHaveValue('推广新品咖啡\n\n使用电商广告帮我优化')
    await expect(page.getByRole('button', { name: /电商广告/ })).toBeVisible()
    await page.getByRole('tab', { name: '制作图片' }).click()
    await page.getByRole('button', { name: '确认离开' }).click()
    await expect(page.getByRole('button', { name: /选择爆款脚本|电商广告/ })).toHaveCount(0)
    expect(api.paidTaskSubmissions).toBe(0)
  })
}
