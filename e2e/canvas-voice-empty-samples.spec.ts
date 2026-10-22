import { expect, test } from '@playwright/test'
import { setupVoiceLibrary } from './fixtures/canvas-voice-library'
import { expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`无本机样本隐藏空入口，有样本时可复用 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const { modal, errors, consoleErrors, state } = await setupVoiceLibrary(page)
    await page.evaluate(() => localStorage.removeItem('zzh:voice-samples:7:21'))
    await modal.getByRole('button', { name: '我的音色', exact: true }).click()
    await modal.getByRole('button', { name: '添加音色', exact: true }).click()
    await expect(modal.getByLabel('选择本机声音样本')).toHaveCount(0)
    await expect(modal.getByText(/已有声音样本也需至少/)).toHaveCount(0)
    await expect(modal.getByLabel('上传训练录音')).toBeVisible()
    await expect(modal.getByRole('button', { name: '开始录音', exact: true })).toBeVisible()
    await expect(modal.getByRole('checkbox', { name: '我确认声音属于本人或已获得音色复刻授权' })).toBeVisible()
    await modal.screenshot({ path: testInfo.outputPath(`empty-samples-${width}.png`) })
    await modal.getByRole('button', { name: '取消', exact: true }).click()
    await page.evaluate(() =>
      localStorage.setItem(
        'zzh:voice-samples:7:21',
        JSON.stringify([{ assetId: 55, title: '已保存的录音', lastUsedAt: Date.now() }]),
      ),
    )
    await modal.getByRole('button', { name: '添加音色', exact: true }).click()
    await expect(modal.getByLabel('选择本机声音样本')).toBeVisible()
    await expect(modal.getByLabel('选择本机声音样本').locator('option')).toHaveText(['请选择声音样本', '已保存的录音'])
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
    expectNoUnexpectedApi(state)
  })
}
