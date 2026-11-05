import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`暂时隐藏宣传片和 T+1 精制交付 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript((workspaceId) => {
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
      localStorage.setItem(
        'zzh_refine_demo_v1',
        JSON.stringify({
          version: 2,
          state: {
            tasks: [
              {
                id: 'old-refine',
                ownerId: 7,
                workspaceId,
                description: '历史精制测试',
                status: '精修中',
                createdAt: 1,
                dueAt: 2,
              },
            ],
          },
        }),
      )
      localStorage.setItem(
        'zzh_promo_demo_v1',
        JSON.stringify({
          version: 0,
          state: {
            tasks: [
              {
                id: 'promo-old',
                ownerId: 7,
                workspaceId,
                org: '历史宣传测试',
                scene: '宣传片',
                status: '制作中',
                createdAt: 1,
              },
            ],
          },
        }),
      )
      sessionStorage.setItem(
        `zzh.smart-entry.draft.v2_u7_ws${workspaceId}`,
        JSON.stringify({ text: '保留的草稿', refineSelected: true, refineScreen: 'order' }),
      )
    }, WORKSPACE_ID)
    await page.goto('/promo?task=promo-old')
    await expect(page).toHaveURL(/\/hot-copy$/)
    await expect(page.getByRole('button', { name: '定制宣传片' })).toHaveCount(0)
    await page.goto('/smart?manualTask=123')
    await expect(page.getByRole('textbox', { name: '创作需求' })).toBeVisible()
    await expect(page.locator('[data-refine-demo]')).toHaveCount(0)
    const settings = page.getByRole('button', { name: '生成设置' })
    if (await settings.isVisible()) await settings.click()
    await page.getByRole('button', { name: /生成模型/ }).click()
    await expect(page.getByText(/精制交付|T\+1/)).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`smart-${width}.png`) })
    await page.goto('/smart?refineDemo=old-refine')
    await expect(page.getByRole('textbox', { name: '创作需求' })).toBeVisible()
    await expect(page.locator('[data-refine-demo]')).toHaveCount(0)
    await page.goto('/projects')
    await expect(page.getByRole('tab', { name: '宣传片' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /历史精制测试|历史宣传测试/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '打开项目 E2E 智能项目' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`projects-${width}.png`) })
    const preserved = await page.evaluate(() => ({
      refine: JSON.parse(localStorage.getItem('zzh_refine_demo_v1')!).state.tasks.length,
      promo: JSON.parse(localStorage.getItem('zzh_promo_demo_v1')!).state.tasks.length,
    }))
    expect(preserved).toEqual({ refine: 1, promo: 1 })
  })
}
