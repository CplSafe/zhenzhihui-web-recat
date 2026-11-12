import { expect, test } from '@playwright/test'
for (const width of [1440, 390]) {
  test(`模板库静态预览 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/template-library-preview.html')
    await expect(page.getByRole('heading', { name: '模板库', exact: true })).toBeVisible()
    await expect(page.locator('.card')).toHaveCount(8)
    await expect(page.locator('.cover .card-body')).toHaveCount(8)
    const ratios = await page
      .locator('.cover')
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).aspectRatio))
    expect(new Set(ratios).size).toBeGreaterThan(1)
    await expect(page.locator('.grid')).toHaveCSS('column-count', width === 390 ? '2' : '4')
    await expect
      .poll(() =>
        page
          .locator('.cover img')
          .first()
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0)
    await page.screenshot({ path: testInfo.outputPath(`preview-${width}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '商品展示', exact: true }).click()
    await expect(page.locator('.card')).toHaveCount(2)
    await page.getByRole('button', { name: /光影里的产品/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: '关闭详情' }).click()
    await page.getByRole('searchbox', { name: '搜索模板名称' }).fill('不存在')
    await expect(page.getByText('没有找到相关模板，试试其他关键词。')).toBeVisible()
  })
}
