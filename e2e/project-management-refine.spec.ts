import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('项目管理将当前空间精制演示任务归入爆款成片并打开', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript((workspaceId) => {
    const make = (id: string, ownerId: number, ws: number, description: string) => ({
      id,
      ownerId,
      workspaceId: ws,
      description,
      script: '不使用脚本',
      duration: 30,
      ratio: '16:9',
      resolution: '1080P',
      credits: 1125,
      materialCount: 0,
      createdAt: Date.now(),
      dueAt: Date.now() + 86400000,
      status: '精修中',
      revision: 0,
    })
    localStorage.setItem(
      'zzh_refine_demo_v1',
      JSON.stringify({
        version: 2,
        state: {
          tasks: [
            make('mine', 7, workspaceId, '我的精制项目'),
            make('other-user', 8, workspaceId, '其他用户精制项目'),
            make('other-workspace', 7, workspaceId + 1, '其他空间精制项目'),
          ],
        },
      }),
    )
  }, WORKSPACE_ID)
  await page.goto('/projects')
  const card = page.getByRole('button', { name: '打开精制演示任务 我的精制项目' })
  await expect(card).toBeVisible()
  await expect(page.getByRole('button', { name: /其他用户精制项目|其他空间精制项目/ })).toHaveCount(0)
  await page.getByRole('tab', { name: '爆款成片' }).click()
  await expect(card).toBeVisible()
  await expect(page.getByRole('button', { name: '打开项目 E2E 智能项目' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('smart-projects.png') })
  await page.getByRole('tab', { name: '爆款复刻' }).click()
  await expect(card).toHaveCount(0)
  await page.getByRole('tab', { name: '爆款成片' }).click()
  await page.getByPlaceholder('搜索项目名称、团队').fill('我的精制项目')
  await expect(card).toBeVisible()
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/smart\?refineDemo=mine$/)
  await expect(page.getByRole('heading', { name: '任务已提交，明天来验收成片' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('opened-refine.png') })
})
