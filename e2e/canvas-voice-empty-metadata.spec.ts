import { expect, test } from '@playwright/test'
import { setupVoiceLibrary } from './fixtures/canvas-voice-library'

for (const width of [1440, 390]) {
  test(`音色缺少语种和试听隐藏空项，已有信息保留 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const { modal, errors } = await setupVoiceLibrary(page)
    await page.route('**/api/v1/voices?**', (route) =>
      route.fulfill({
        json: {
          items: [
            { id: 801, name: '无试听音色', source: 'public', status: 'ready', description: '自然旁白' },
            {
              id: 802,
              name: '有试听音色',
              source: 'public',
              status: 'ready',
              description: '这是一段较长的音色描述，用于验证同一行的内容差异不会把另一张卡片里的操作按钮撑高。'.repeat(
                3,
              ),
              language: 'zh',
              tags: ['温柔'],
              preview_url: 'https://example.com/preview.mp3',
            },
          ],
          total: 2,
        },
      }),
    )
    await modal.getByRole('button', { name: '我的音色', exact: true }).click()
    await modal.getByRole('button', { name: '系统音色', exact: true }).click()
    const empty = modal.getByRole('article').filter({ hasText: '无试听音色' })
    const full = modal.getByRole('article').filter({ hasText: '有试听音色' })
    await expect(empty).toBeVisible()
    await expect(empty.locator('small, audio')).toHaveCount(0)
    await expect(empty.getByRole('button', { name: '选用', exact: true })).toBeEnabled()
    await expect(modal.getByText(/语种未标注|暂无试听/)).toHaveCount(0)
    await expect(full.locator('small')).toContainText('温柔')
    await expect(full.getByLabel('试听 有试听音色', { exact: true })).toHaveCount(1)
    const emptyButton = empty.getByRole('button', { name: '选用', exact: true })
    const fullButton = full.getByRole('button', { name: '选用', exact: true })
    await fullButton.scrollIntoViewIfNeeded()
    const fullBox = await fullButton.boundingBox()
    await emptyButton.scrollIntoViewIfNeeded()
    const emptyBox = await emptyButton.boundingBox()
    expect(emptyBox!.height).toBeCloseTo(fullBox!.height, 0)
    expect(emptyBox!.height).toBeLessThanOrEqual(40)
    const headingBox = await empty.locator('strong').boundingBox()
    const descriptionBox = await empty.getByText('自然旁白', { exact: true }).boundingBox()
    expect(descriptionBox!.y - (headingBox!.y + headingBox!.height)).toBeLessThan(40)
    if (width === 1440) {
      expect(emptyBox!.y).toBeCloseTo(fullBox!.y, 0)
    }
    await modal.screenshot({ path: testInfo.outputPath(`voice-empty-metadata-${width}.png`) })
    expect(errors).toEqual([])
  })
}
