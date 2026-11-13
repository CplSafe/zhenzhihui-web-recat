import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`模板库展示爆款复刻的真实目录结构并回填视频 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/template-categories', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: [
            { id: 7, name: '百货', code: 'E02' },
            { id: 8, name: '美妆', code: 'E04' },
          ],
        },
      }),
    )
    await page.route('**/api/v1/templates**', (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.has('limit'))
        return route.fulfill({ json: { code: 0, data: { items: [], has_more: false, next_cursor: '' } } })
      return route.fulfill({
        json: {
          code: 0,
          data: [
            {
              id: 30,
              category_id: 7,
              industry_code: 'E02',
              title: '爆款视频示例',
              video_url: '/tutorials/hot-copy.mp4',
              ratio: '16:9',
            },
          ],
        },
      })
    })
    await page.goto('/templates')
    const section = page.locator('.library-grid')
    await page.getByRole('button', { name: '百货', exact: true }).click()
    const preview = section.getByRole('button', { name: '预览爆款视频示例' })
    await expect(preview).toBeVisible()
    await expect(section.locator('.library-hotcopy-title')).toHaveText('爆款视频示例')
    await preview.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`hotcopy-catalog-${width}.png`), animations: 'disabled' })
    await preview.hover()
    await section.getByRole('button', { name: '做同款' }).click()
    await expect(page).toHaveURL(/\/hot-copy$/)
    await expect(page.locator('video[src="/tutorials/hot-copy.mp4"]').first()).toBeVisible()
    expect(api.paidTaskSubmissions).toBe(0)
  })
}

test('内置模板保留内容但不显示精选模板字样', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/template-categories', (route) => route.fulfill({ json: { code: 0, data: [] } }))
  await page.route('**/api/v1/templates**', (route) => {
    if (new URL(route.request().url()).searchParams.has('limit'))
      return route.fulfill({ json: { code: 0, data: { items: [], has_more: false, next_cursor: '' } } })
    return route.fulfill({ status: 503 })
  })
  await page.goto('/templates')
  await expect(page.locator('.library-grid .hotcopy-tpl__card')).toHaveCount(25)
  await expect(page.locator('.library-grid .library-hotcopy-title')).toHaveCount(0)
  await expect(page.getByText(/模板服务暂未开放|模板服务暂时不可用/)).toHaveCount(0)
  await expect(page.getByText(/精选模板/)).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '模板分类' }).getByRole('button')).toHaveCount(11)
  await page.getByRole('button', { name: '美妆', exact: true }).click()
  await expect(page.locator('.library-grid .hotcopy-tpl__card')).toHaveCount(2)
})
