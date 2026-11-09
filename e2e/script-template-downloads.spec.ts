import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`模板按当前申请审核进度开放 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    let stage = 'creative'
    let reviews: Array<{ status: number; stage: string }> = []
    let progressAvailable = true
    await page.route('**/api/v1/student-applications/91', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 91, state: 'submitted' },
            progress_available: progressAvailable,
            workflow: {
              status: 1,
              flow_version: 5,
              stage: 'waiting_review',
              current_stage: stage,
              current_task: null,
              reviews,
              versions: [],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas/new')
    await expect(page.getByRole('link', { name: '下载创意模板' })).toBeVisible()
    await expect(page.getByText('一卡模板', { exact: true })).toHaveCount(0)
    await expect(page.getByText('剧本模板', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`templates-new-${width}.png`) })

    await page.goto('/script-ideas/91')
    await expect(page.getByRole('link', { name: '下载创意模板' })).toBeVisible()
    await expect(page.getByText('一卡模板', { exact: true })).toHaveCount(0)
    reviews = [{ status: 2, stage: 'creative' }]
    stage = 'card'
    await page.reload()
    await expect(page.getByRole('link', { name: '下载一卡模板' })).toBeVisible()
    await expect(page.getByRole('link', { name: '下载创意模板' })).toHaveCount(0)
    await expect(page.getByText('剧本模板', { exact: true })).toHaveCount(0)
    reviews = [...reviews, { status: 2, stage: 'card' }]
    stage = 'script'
    await page.reload()
    await expect(page.getByRole('link', { name: '下载剧本模板' })).toBeVisible()
    await expect(page.locator('a[download][href*="script-idea-templates"]')).toHaveCount(1)
    await expect(page.getByText('创意模板', { exact: true })).toHaveCount(0)
    await expect(page.getByText('一卡模板', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`templates-open-${width}.png`) })
    progressAvailable = false
    await page.reload()
    await expect(page.getByRole('heading', { name: '模板下载' })).toHaveCount(0)
  })
}
