import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`最近项目可复制他人画布 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    let createCount = 0
    let saved: any = null
    await page.route('**/api/v1/canvases?**', (route) => {
      if (route.request().method() === 'POST') {
        createCount++
        expect(route.request().postDataJSON()).toEqual({ title: '同事画布-副本' })
        return route.fulfill({ json: { id: 702, title: '同事画布-副本', user_id: 7 } })
      }
      return route.fulfill({ json: { items: [{ id: 701, title: '同事画布', user_id: 8 }] } })
    })
    await page.route('**/api/v1/canvases/701/elements?**', (route) =>
      route.fulfill({
        json: {
          elements: [
            {
              element_id: 'node-1',
              kind: 'node',
              op: 'upsert',
              payload: { type: 'text', data: { kind: 'text', text: '测试内容' } },
            },
          ],
          sync_revision: 1,
          has_more: false,
        },
      }),
    )
    await page.route('**/api/v1/canvases/702/elements?**', (route) => {
      saved = route.request().postDataJSON()
      return route.fulfill({ json: { sync_revision: 1 } })
    })
    await page.goto('/canvas')
    await page.getByRole('button', { name: '画布操作 同事画布' }).click()
    await expect(page.getByText('仅创建者可重命名或删除此画布')).toBeVisible()
    await expect(page.getByRole('button', { name: '创建副本', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`copy-menu-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '创建副本', exact: true }).click()
    await expect(page.getByRole('button', { name: '打开画布 同事画布-副本' })).toBeVisible()
    expect(createCount).toBe(1)
    expect(saved.mutations).toEqual([
      {
        element_id: 'node-1',
        kind: 'node',
        op: 'upsert',
        payload: { type: 'text', data: { kind: 'text', text: '测试内容' } },
      },
    ])
    await page.getByRole('button', { name: '画布操作 同事画布-副本' }).click()
    await expect(page.getByRole('button', { name: '重命名', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '删除画布', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`copy-created-${width}.png`), fullPage: true })
    expectNoUnexpectedApi(api)
  })
}
