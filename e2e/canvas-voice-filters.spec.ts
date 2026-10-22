import { expect, test } from '@playwright/test'
import { setupVoiceLibrary } from './fixtures/canvas-voice-library'
import { expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`音色筛选默认精简、展开多条件、收起保留已选条件 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const { modal, requests, errors, consoleErrors, state } = await setupVoiceLibrary(page)
    await page.route('**/api/v1/voices/filters?**', (route) =>
      route.fulfill({
        json: {
          languages: ['zh', 'en'],
          providers: ['minimax', 'volcengine-speech'],
          voice_features: ['温柔', '清亮'],
          genders: ['female', 'male'],
          ages: ['young', 'adult'],
        },
      }),
    )
    await modal.getByRole('button', { name: '我的音色', exact: true }).click()
    await expect(modal.getByRole('combobox', { name: '音色供应商' })).toBeVisible()
    await modal.getByRole('button', { name: '系统音色', exact: true }).click()
    await expect(modal.getByRole('combobox')).toHaveCount(1)
    await expect(modal.getByRole('combobox', { name: '音色语种' })).toBeVisible()
    await expect(modal.getByRole('button', { name: '更多筛选' })).toHaveAttribute('aria-expanded', 'false')
    await modal.screenshot({ path: testInfo.outputPath(`filters-compact-${width}.png`) })
    await modal.getByRole('button', { name: '更多筛选' }).click()
    await expect(modal.getByRole('combobox')).toHaveCount(5)
    await modal.screenshot({ path: testInfo.outputPath(`filters-expanded-${width}.png`) })
    await modal.getByRole('combobox', { name: '音色声音特征' }).click()
    await page.getByTitle('清亮', { exact: true }).click()
    await page.keyboard.press('Escape')
    await expect
      .poll(() => requests.some((url) => url.searchParams.getAll('voice_feature').includes('清亮')))
      .toBe(true)
    await modal.getByRole('button', { name: '收起筛选' }).click()
    await expect(modal.getByRole('combobox')).toHaveCount(2)
    await expect(modal.getByRole('combobox', { name: '音色声音特征' })).toBeVisible()
    await modal.getByRole('button', { name: '清除筛选' }).click()
    await expect(modal.getByRole('combobox')).toHaveCount(1)
    await expect(modal.getByRole('article')).toHaveCount(20)
    expect(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
    expectNoUnexpectedApi(state)
  })
}
