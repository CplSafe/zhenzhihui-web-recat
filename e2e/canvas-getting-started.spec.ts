import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`空画布隐藏上一轮引导和导入 ${width}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    let revision = 1
    const saved = new Map<string, any>()
    await page.route('**/api/v1/canvases/142**', (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'PATCH') {
        for (const item of route.request().postDataJSON().mutations || []) {
          if (item.op === 'delete') saved.delete(item.element_id)
          else saved.set(item.element_id, item)
        }
        return route.fulfill({ json: { sync_revision: ++revision } })
      }
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [...saved.values()],
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 142, title: '开始创作验收', revision, status: 'active' },
      })
    })
    await page.goto('/canvas/142')
    const guide = page.getByRole('region', { name: '画布开始指南' })
    await expect(page.locator('.canvas-view')).toBeVisible()
    await expect(guide).toHaveCount(0)
    if (width <= 760) await page.getByRole('button', { name: '画布操作', exact: true }).click()
    await expect(page.getByRole('button', { name: '开始指南', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '导入文字或分镜', exact: true })).toHaveCount(0)
    await page.getByRole('combobox', { name: '画布缩放' }).selectOption('60')
    await expect(page.getByRole('combobox', { name: '画布缩放' })).toHaveValue('60')
    await page.screenshot({ path: testInfo.outputPath('hidden-extras.png') })
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
