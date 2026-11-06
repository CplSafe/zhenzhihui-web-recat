import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`剧本审核通过通知显示备注并跳转 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.addInitScript(() => {
      localStorage.setItem('zzh_guide_seen_home_u7', '1')
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/student-applications?**', (route) =>
      route.fulfill({ json: { code: 0, data: { items: [{ id: 46, title: '测试剧' }], total: 1 } } }),
    )
    await page.route('**/api/v1/student-applications/46', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 46, state: 'submitted', title: '测试剧', creative: '故事' },
            progress_available: true,
            workflow: {
              status: 1,
              stage: 'revision',
              current_task: { task_id: 'revision-1', stage: 'revision', content: '完整剧本正文' },
              versions: [],
              reviews: [
                {
                  status: 2,
                  stage: 'script',
                  version: 2,
                  task_id: 'review-1',
                  reason: '请完善第九集的情节',
                  finished_at: 1700000000,
                },
              ],
            },
          },
        },
      }),
    )
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({
        json: { code: 0, data: { profile: null, originality_version: 'test-v1', workflow_synced: false } },
      }),
    )
    await page.goto('/home')
    const bell = page.getByRole('button', { name: /^通知/ })
    await bell.click()
    const panel = page.getByRole('dialog', { name: '通知列表' })
    const item = panel.getByRole('button', { name: /剧本创意审核通过.*请完善第九集/ })
    await expect(item).toBeVisible()
    await expect(item).toContainText('测试剧')
    await expect(bell).toHaveAttribute('aria-label', /未读/)
    await page.screenshot({ path: testInfo.outputPath('script-approval-notice.png') })
    await item.click()
    await expect(page).toHaveURL(/\/script-ideas\/46$/)
    await expect(page.getByText('请完善第九集的情节').first()).toBeVisible()
    await expect(page.getByLabel('剧本正文', { exact: false })).toHaveValue('完整剧本正文')
    await page.screenshot({ path: testInfo.outputPath('script-approval-destination.png') })
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}

test('剧本请求缓慢时需求通知先显示，恢复后加载结束', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  await page.addInitScript(() => localStorage.setItem('zzh_guide_seen_home_u7', '1'))
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/student-applications?**', async (route) => {
    await blocked
    await route.fulfill({ json: { code: 0, data: { items: [], total: 0 } } })
  })
  await page.route('**/api/v1/market/me/demands**', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          items: [{ id: 8, title: '测试需求', status: 'completed', completed_at: '2026-11-05T00:00:00Z' }],
          total: 1,
        },
      },
    }),
  )
  await page.goto('/home')
  await page.getByRole('button', { name: /^通知/ }).click()
  const dialog = page.getByRole('dialog', { name: '通知列表' })
  await expect(dialog.getByRole('button', { name: /需求已完成/ })).toBeVisible()
  await expect(dialog.getByText('剧本消息加载中…')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('partial-loading.png') })
  release()
  await expect(dialog.getByText('剧本消息加载中…')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /需求已完成/ })).toBeVisible()
  expectNoUnexpectedApi(api)
})
