import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [390, 768, 1440]) {
  test(`统计页 ${width}px 可滚动至明细和分页，筛选控件不重叠`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/canvases/76/statistics?**', (route) =>
      route.fulfill({
        json: {
          total: 20,
          total_used_credits: 20,
          items: Array.from({ length: 20 }, (_, i) => ({
            node_id: `n-${i}`,
            title: `镜头 ${i}`,
            deleted: false,
            used_credits: 1,
            members: [],
          })),
          trend: [{ date: '2026-11-18', used_credits: 20 }],
          member_choices: [],
          member_totals: [],
          top_nodes: [],
        },
      }),
    )
    await page.goto('/canvas/76/statistics')
    const main = page.getByRole('main', { name: '画布数据统计' })
    await expect(page.getByText('20 积分', { exact: true })).toBeVisible()
    expect(await main.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    const boxes = await page.locator('form input, form select').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }
      }),
    )
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].x).toBeGreaterThanOrEqual(0)
      expect(boxes[i].right).toBeLessThanOrEqual(width)
      for (const other of boxes.slice(i + 1)) {
        expect(
          boxes[i].right <= other.x ||
            other.right <= boxes[i].x ||
            boxes[i].bottom <= other.y ||
            other.bottom <= boxes[i].y,
        ).toBe(true)
      }
    }
    await main.hover({ position: { x: 8, y: 200 } })
    await page.mouse.wheel(0, 10000)
    await expect(page.getByRole('navigation', { name: '统计分页' })).toBeInViewport()
    expect(await main.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  })
}
