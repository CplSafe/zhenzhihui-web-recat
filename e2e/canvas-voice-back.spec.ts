import { expect, test } from '@playwright/test'
import { setupVoiceLibrary } from './fixtures/canvas-voice-library'
import { expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`创建音色可从顶部返回列表并确认丢弃录音 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const { modal, createRequests, errors, state } = await setupVoiceLibrary(page)
    await modal.getByRole('button', { name: '我的音色', exact: true }).click()
    await modal.getByRole('button', { name: '添加音色', exact: true }).click()
    const back = modal.getByRole('button', { name: '返回音色列表', exact: true })
    await expect(back).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath(`voice-form-back-${width}.png`) })
    await back.focus()
    await page.keyboard.press('Enter')
    await expect(modal.getByRole('button', { name: '添加音色', exact: true })).toBeVisible()
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: '添加音色', exact: true }).click()
    await modal.getByLabel('上传训练录音').setInputFiles({
      name: 'draft.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.from('unsubmitted recording'),
    })
    await back.click()
    const confirm = page.getByRole('alertdialog', { name: '丢弃录音', exact: true })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    await expect(back).toBeVisible()
    await back.click()
    await confirm.getByRole('button', { name: '确认', exact: true }).click()
    await expect(modal.getByRole('button', { name: '添加音色', exact: true })).toBeVisible()
    await expect(modal).toBeVisible()
    expect(createRequests).toHaveLength(0)
    expect(errors).toEqual([])
    expectNoUnexpectedApi(state)
  })
}
