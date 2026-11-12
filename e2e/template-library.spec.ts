import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`真实接口结构的分类、分页与详情 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/cover.png', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#b4ded2"/><circle cx="200" cy="150" r="72" fill="#447f73"/></svg>',
      }),
    )
    await page.route('**/sample.png', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#b4ded2"/></svg>',
      }),
    )
    const requests: string[] = []
    await page.route('**/api/v1/template-categories', (route) =>
      route.fulfill({ json: { code: 0, data: [{ id: 7, name: '产品', position: 1 }] } }),
    )
    await page.route('**/api/v1/templates**', (route) => {
      const url = new URL(route.request().url())
      requests.push(url.pathname + url.search)
      if (url.pathname.endsWith('/11'))
        return route.fulfill({
          json: {
            code: 0,
            data: {
              id: 11,
              category_id: 7,
              title: '产品展示',
              description: '详情描述',
              media_type: 'image',
              media_url: '/sample.png',
              cover_url: '/cover.png',
            },
          },
        })
      const category = url.searchParams.get('category_id')
      const cursor = url.searchParams.get('cursor')
      const item = {
        id: cursor ? 12 : 11,
        category_id: 7,
        title: cursor ? '第二个模板' : '产品展示',
        description: '案例介绍',
        media_type: 'image',
        media_url: '/sample.png',
        cover_url: '/cover.png',
      }
      return route.fulfill({
        json: {
          code: 0,
          data: { items: category === '7' ? [] : [item], next_cursor: cursor ? '' : 'next', has_more: !cursor },
        },
      })
    })
    await page.goto('/templates')
    await expect(page.getByRole('button', { name: /产品展示/ })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`library-${width}.png`) })
    await page.getByRole('button', { name: '加载更多' }).click()
    await expect(page.getByRole('button', { name: /第二个模板/ })).toBeVisible()
    expect(requests.some((x) => x.includes('cursor=next'))).toBe(true)
    await page.getByRole('button', { name: /产品展示/ }).click()
    await expect(page.getByRole('dialog')).toContainText('详情描述')
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: '产品', exact: true }).click()
    await expect(page.getByText('暂无模板')).toBeVisible()
    expect(requests.some((x) => x.includes('category_id=7') && !x.includes('cursor='))).toBe(true)
  })
}

test('接口错误展示重试且不显示内置模板', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  let fail = true
  await page.route('**/api/v1/template-categories', (route) => route.fulfill({ json: { code: 0, data: [] } }))
  await page.route('**/api/v1/templates?**', (route) =>
    fail
      ? route.fulfill({ status: 503, json: { message: 'unavailable' } })
      : route.fulfill({ json: { code: 0, data: { items: [], has_more: false, next_cursor: '' } } }),
  )
  await page.goto('/templates')
  await expect(page.getByRole('alert')).toContainText('模板加载失败')
  fail = false
  await page.getByRole('button', { name: '重试' }).click()
  await expect(page.getByText('暂无模板')).toBeVisible()
})
