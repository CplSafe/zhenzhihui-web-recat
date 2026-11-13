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

test('接口错误展示重试并保留内置模板', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  let fail = true
  await page.route('**/api/v1/template-categories', (route) => route.fulfill({ json: { code: 0, data: [] } }))
  await page.route('**/api/v1/templates', (route) => route.fulfill({ status: 503 }))
  await page.route('**/api/v1/templates?**', (route) =>
    fail
      ? route.fulfill({ status: 503, json: { message: 'unavailable' } })
      : route.fulfill({ json: { code: 0, data: { items: [], has_more: false, next_cursor: '' } } }),
  )
  await page.goto('/templates')
  await expect(page.getByRole('alert')).toContainText('模板加载失败')
  fail = false
  await page.getByRole('button', { name: '重试' }).click()
  await expect(page.locator('.library-grid .hotcopy-tpl__card')).toHaveCount(25)
  await expect(page.getByText(/模板服务暂未开放|模板服务暂时不可用/)).toHaveCount(0)
})

test('分类失败不遮盖列表，已下架模板提供反馈', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/template-categories', (route) => route.fulfill({ status: 503 }))
  await page.route('**/api/v1/templates**', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/11')) return route.fulfill({ status: 404 })
    return route.fulfill({
      json: {
        code: 0,
        data: { items: [{ id: 11, title: '视频模板', media_type: 'video' }], has_more: false, next_cursor: '' },
      },
    })
  })
  await page.goto('/templates')
  await expect(page.getByRole('alert')).toContainText('分类加载失败')
  await page.getByRole('button', { name: /视频模板/ }).click()
  await expect(page.getByRole('dialog')).toContainText('模板已下架或不存在')
})

for (const width of [1440, 390]) {
  test(`瀑布流封面文字与视频详情 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/cover.png', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#6aab95"/><circle cx="200" cy="150" r="70" fill="#37594e"/></svg>',
      }),
    )
    await page.route('**/api/v1/template-categories', (route) => route.fulfill({ json: { code: 0, data: [] } }))
    await page.route('**/api/v1/templates**', (route) => {
      if (new URL(route.request().url()).pathname.endsWith('/1')) {
        return route.fulfill({
          json: { code: 0, data: { id: 1, title: '视频模板 1', media_type: 'video', media_url: '/sample.mp4' } },
        })
      }
      return route.fulfill({
        json: {
          code: 0,
          data: {
            items: Array.from({ length: 6 }, (_, i) => ({
              id: i + 1,
              title: `视频模板 ${i + 1}`,
              description: '模板介绍',
              media_type: 'video',
              cover_url: '/cover.png',
            })),
            has_more: false,
            next_cursor: '',
          },
        },
      })
    })
    await page.goto('/templates')
    const cards = page.locator('.library-card')
    await expect(cards).toHaveCount(6)
    await expect(page.locator('.library-grid')).toHaveCSS('column-count', width === 390 ? '2' : '4')
    await expect(cards.first().locator('.library-cover .library-card-title')).toHaveText('视频模板 1')
    const heights = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    )
    expect(new Set(heights).size).toBeGreaterThan(1)
    await page.screenshot({ path: testInfo.outputPath(`waterfall-${width}.png`), animations: 'disabled' })
    await cards.first().click()
    await expect(page.getByRole('dialog').locator('video')).toHaveAttribute('src', '/sample.mp4')
  })
}
