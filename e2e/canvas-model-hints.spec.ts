import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 760, height: 900 },
]) {
  test(`模型悬停展开真实说明且仅点击切换 ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const state = await installStrictAuthenticatedApp(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: 42,
              display_name: 'Seedance 2.0',
              capability: 'video',
              operation_codes: ['video.generate'],
              params_schema: { fields: [{ name: 'duration', type: 'integer', options: [5, 10, 15] }] },
              price: 999,
              tags: ['最强', '最便宜'],
              description: '目录提供的模型说明：支持参考素材创作，具体参数以当前模型配置为准。',
            },
            {
              id: 43,
              display_name: 'HappyHorse',
              capability: 'video',
              operation_codes: ['video.generate'],
              description: '另一模型的真实说明，用于比较不同选项。',
            },
            ...Array.from({ length: 10 }, (_, index) => ({
              id: 44 + index,
              display_name: `画布视频模型 ${index + 3}`,
              capability: 'video',
              operation_codes: ['video.generate'],
            })),
          ],
        },
      }),
    )
    await page.route('**/api/v1/real-people?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/canvases/119**', (route) =>
      route.fulfill({
        json:
          route.request().method() === 'PATCH'
            ? { revision: 2 }
            : new URL(route.request().url()).pathname.endsWith('/elements')
              ? {
                  elements: [
                    {
                      element_id: 'source',
                      kind: 'node',
                      payload: {
                        id: 'source',
                        type: 'video',
                        position: { x: 300, y: 150 },
                        style: { width: 320, height: 240 },
                        data: { kind: 'video', modelVersionId: 42, prompt: '参考人物生成视频' },
                      },
                    },
                  ],
                  sync_revision: 1,
                  history_floor_revision: 0,
                  has_more: false,
                }
              : { id: 119, title: '真人引导布局检查', revision: 1 },
      }),
    )
    await page.goto('/canvas/119')
    await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('100')
    await page.locator('.react-flow__node[data-id="source"]').click()
    const editor = page.locator('[data-canvas-node-panel]')
    await expect(editor.getByText(/Seedance 2.0，适用于/)).toHaveCount(0)
    await expect(editor.locator('[data-canvas-model-hint]')).toHaveCount(0)
    const trigger = editor.getByRole('button', { name: 'Seedance 2.0', exact: true })
    await trigger.hover()
    await expect(page.getByRole('listbox', { name: '生成模型列表' })).toBeVisible()
    const option = page.getByRole('option', { name: /Seedance 2.0/ })
    await expect(option.locator('[data-canvas-model-hint]')).toHaveCount(0)
    await expect(option).toContainText('最长 15 秒')
    await expect(option).not.toContainText(/多模态参考|适合广告镜头|适用/)
    await expect(option).not.toContainText(/最强|最便宜|0.02|999/)
    const menu = page.getByRole('listbox', { name: '生成模型列表' })
    const before = await menu.boundingBox()
    await expect.poll(() => menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    expect(await menu.evaluate((element) => element.clientHeight)).toBeLessThanOrEqual(700)
    const generateBounds = await editor.locator('[data-canvas-generate]').boundingBox()
    const menuBounds = await menu.boundingBox()
    expect(generateBounds).not.toBeNull()
    expect(menuBounds).not.toBeNull()
    expect(
      menuBounds!.x + menuBounds!.width <= generateBounds!.x ||
        menuBounds!.x >= generateBounds!.x + generateBounds!.width ||
        menuBounds!.y + menuBounds!.height <= generateBounds!.y ||
        menuBounds!.y >= generateBounds!.y + generateBounds!.height,
    ).toBe(true)
    expect(await menu.evaluate((element) => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(1450)
    await option.hover()
    await expect(option).toHaveAttribute('data-expanded', 'true')
    await expect(option.getByText(/目录提供的模型说明/)).toBeVisible()
    await expect(option).toHaveAttribute('aria-selected', 'true')
    const other = page.getByRole('option', { name: /HappyHorse/ })
    await other.hover()
    await expect(other).toHaveAttribute('data-expanded', 'true')
    await expect(option).toHaveAttribute('data-expanded', 'false')
    await expect(other).toHaveAttribute('aria-selected', 'false')
    const after = await menu.boundingBox()
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(1)
    expect(Math.abs(after!.height - before!.height)).toBeLessThan(1)
    await page.screenshot({ path: testInfo.outputPath('model-hints.png') })
    await page.getByRole('option', { name: /HappyHorse/ }).click()
    await expect(editor.getByRole('button', { name: 'HappyHorse', exact: true })).toBeVisible()
    await editor.getByRole('button', { name: 'HappyHorse', exact: true }).click()
    const fallback = page.getByRole('option', { name: /HappyHorse/ })
    await expect(fallback).not.toContainText(/适合|适用/)
    await expect(fallback.locator('[data-canvas-model-hint]')).toHaveCount(0)
    await page.getByRole('option', { name: /Seedance 2.0/ }).click()
    await expect(editor.getByRole('button', { name: 'Seedance 2.0', exact: true })).toBeVisible()
    const reopenedTrigger = editor.getByRole('button', { name: 'Seedance 2.0', exact: true })
    await reopenedTrigger.focus()
    await reopenedTrigger.press('ArrowDown')
    await expect(option).toBeFocused()
    await option.press('ArrowDown')
    await expect(other).toBeFocused()
    await expect(other).toHaveAttribute('data-expanded', 'true')
    await other.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(reopenedTrigger).toBeFocused()
    expect(errors).toEqual([])
    expect(state.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(state)
  })
}
