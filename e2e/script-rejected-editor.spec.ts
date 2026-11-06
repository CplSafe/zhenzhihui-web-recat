import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

test('各阶段无待办时不显示驳回编辑区，已有本机草稿仍可恢复', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => {
    localStorage.setItem('zzh.student-application.rejected-draft.v1.7.30.3', '修改后的完善剧本')
  })
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({ json: { code: 0, data: { profile: null } } }),
  )
  let stage = 'creative'
  let version = 1
  let restored = false
  await page.route('**/api/v1/student-applications/30', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 30, state: 'submitted', creative: '原始创意' },
          progress_available: true,
          workflow: {
            status: restored ? 1 : 3,
            stage: restored ? stage : 'finished',
            current_task: restored ? { task_id: 'new-task', stage, content: '被驳回的正文' } : null,
            versions: [{ version, stage, content: '被驳回的正文', task_id: 'old', submitted_at: 1793760000000 }],
            reviews: [{ status: restored ? 5 : 3, version, reason: '请修改剧情', finished_at: 1793760200000 }],
          },
        },
      },
    }),
  )
  for (const [value, title] of [
    ['creative', '创意'],
    ['draft', '一卡初稿'],
    ['revision', '完善剧本'],
  ]) {
    stage = value
    await page.goto('/script-ideas/30')
    await expect(page.getByRole('heading', { name: '流程未通过' })).toBeVisible()
    await expect(page.getByRole('heading', { name: `修改被驳回的${title}` })).toHaveCount(0)
    await expect(page.getByLabel('修改内容')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '重新提交（暂不可用）' })).toHaveCount(0)
    version++
  }
  await page.screenshot({ path: testInfo.outputPath('rejected-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByRole('heading', { name: '流程未通过' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('rejected-mobile.png'), fullPage: true })
  version--
  restored = true
  await page.reload()
  await page.getByRole('button', { name: '使用本机修改内容' }).click()
  await expect(page.getByLabel('正文')).toHaveValue('修改后的完善剧本')
  await expect(page.getByRole('button', { name: '提交终稿' })).toBeVisible()
  expectNoUnexpectedApi(api)
})
