import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`爆款复刻模板按行业筛选 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/template-categories', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: [
            { id: 7, name: '百货', code: 'E02' },
            { id: 8, name: '美妆', code: 'E04' },
            { id: 9, name: '教育', code: 'E10' },
          ],
        },
      }),
    )
    await page.route('**/api/v1/templates**', (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor')
      return route.fulfill({
        json: {
          code: 0,
          data: cursor
            ? {
                items: [
                  {
                    id: 31,
                    industry_code: 'E04',
                    title: '美妆视频',
                    media_type: 'video',
                    media_url: '/tutorials/hot-copy.mp4',
                    ratio: '9:16',
                  },
                ],
                has_more: false,
                next_cursor: '',
              }
            : {
                items: [
                  {
                    id: 30,
                    category_id: 7,
                    title: '百货视频',
                    media_type: 'video',
                    media_url: '/tutorials/hot-copy.mp4',
                    ratio: '16:9',
                  },
                ],
                has_more: true,
                next_cursor: 'next',
              },
        },
      })
    })
    await page.goto('/hot-copy')
    await page.getByRole('dialog', { name: '新手引导' }).getByRole('button', { name: /跳过/ }).click()
    const gallery = page.locator('.hotcopy-tpl')
    const nav = gallery.getByRole('navigation', { name: '模板分类' })
    await expect(gallery.getByRole('button', { name: '预览百货视频' })).toBeVisible()
    await expect(gallery.getByRole('button', { name: '预览美妆视频' })).toBeVisible()
    await nav.getByRole('button', { name: '百货', exact: true }).click()
    await expect(nav.getByRole('button', { name: '百货', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(gallery.getByRole('button', { name: '预览百货视频' })).toBeVisible()
    await expect(gallery.getByRole('button', { name: '预览美妆视频' })).toHaveCount(0)
    await gallery.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`hotcopy-filter-${width}.png`), animations: 'disabled' })
    await nav.getByRole('button', { name: '美妆', exact: true }).click()
    await expect(gallery.getByRole('button', { name: '预览美妆视频' })).toBeVisible()
    await nav.getByRole('button', { name: '教育', exact: true }).click()
    await expect(gallery.getByText('暂无模板')).toBeVisible()
    await nav.getByRole('button', { name: '全部', exact: true }).click()
    await expect(gallery.locator('.hotcopy-tpl__card')).toHaveCount(2)
  })
}

test('分类请求失败时显示预设筛选，并可重试切换到后端分类', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  let fail = true
  await page.route('**/api/v1/template-categories', (route) =>
    fail ? route.fulfill({ status: 503 }) : route.fulfill({ json: { code: 0, data: [{ id: 7, name: '百货' }] } }),
  )
  await page.route('**/api/v1/templates**', (route) => route.fulfill({ status: 503 }))
  await page.goto('/hot-copy')
  await page.getByRole('dialog', { name: '新手引导' }).getByRole('button', { name: /跳过/ }).click()
  const gallery = page.locator('.hotcopy-tpl')
  await expect(gallery.locator('.hotcopy-tpl__card')).toHaveCount(25)
  await expect(gallery.getByRole('alert')).toContainText('分类加载失败')
  await expect(gallery.getByRole('navigation', { name: '模板分类' }).getByRole('button')).toHaveCount(11)
  await gallery.getByRole('button', { name: '美妆', exact: true }).click()
  await expect(gallery.locator('.hotcopy-tpl__card')).toHaveCount(2)
  fail = false
  await gallery.getByRole('button', { name: '重试' }).click()
  await expect(gallery.getByRole('navigation', { name: '模板分类' }).getByRole('button')).toHaveCount(2)
  await gallery.getByRole('button', { name: '百货', exact: true }).click()
  await expect(gallery.locator('.hotcopy-tpl__card')).toHaveCount(5)
})
