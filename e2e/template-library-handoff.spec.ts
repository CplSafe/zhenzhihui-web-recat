import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('集市模板库视频可带入爆款复刻', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  const item = {
    id: 11,
    category_id: 7,
    title: '产品视频模板',
    description: '视频示例',
    media_type: 'video',
    media_url: '/tutorials/hot-copy.mp4',
    cover_url: '',
  }
  await page.route('**/api/v1/template-categories', (route) =>
    route.fulfill({ json: { code: 0, data: [{ id: 7, name: '产品', position: 1 }] } }),
  )
  await page.route('**/api/v1/templates**', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/11')) return route.fulfill({ json: { code: 0, data: item } })
    return route.fulfill({ json: { code: 0, data: { items: [item], has_more: false, next_cursor: '' } } })
  })
  await page.goto('/templates')
  await expect(page.getByRole('button', { name: '模板库', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /产品视频模板/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('video')).toHaveAttribute('src', '/tutorials/hot-copy.mp4')
  await page.screenshot({ path: testInfo.outputPath('template-video-detail.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: '做同款' }).click()
  await expect(page).toHaveURL(/\/hot-copy$/)
  await expect(page.locator('video[src="/tutorials/hot-copy.mp4"]').first()).toBeVisible()
  expect(api.paidTaskSubmissions).toBe(0)
})
