import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('项目管理中的宣传片分类展示本账号本空间的演示任务', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript((workspaceId) => {
    const make = (id: string, ownerId: number, ws: number, org: string) => ({
      id,
      ownerId,
      workspaceId: ws,
      org,
      contact: '联系人',
      phone: '',
      scene: '企业形象片',
      duration: 180,
      ratio: '16:9 横版',
      resolution: '1080P',
      voice: '要旁白＋字幕',
      core: '介绍产品',
      reference: '',
      files: [],
      logo: '',
      other: [],
      createdAt: Date.now(),
      dueAt: Date.now() + 432000000,
      status: '制作中',
      revisionUsed: false,
    })
    localStorage.setItem(
      'zzh_promo_demo_v1',
      JSON.stringify({
        version: 0,
        state: {
          tasks: [
            make('my-promo', 7, workspaceId, '演示公司'),
            make('other-user', 8, workspaceId, '其他用户'),
            make('other-workspace', 7, workspaceId + 1, '其他空间'),
          ],
        },
      }),
    )
  }, WORKSPACE_ID)
  await page.setViewportSize({ width: 1354, height: 900 })
  await page.goto('/projects')
  const card = page.getByRole('button', { name: '打开宣传片演示任务 企业形象片 · 演示公司' })
  await expect(card).toBeVisible()
  await expect(page.getByRole('button', { name: /其他用户|其他空间/ })).toHaveCount(0)
  await page.getByRole('tab', { name: '宣传片' }).click()
  await expect(card).toBeVisible()
  await expect(page.getByRole('button', { name: '打开项目 E2E 智能项目' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '＋ 进入定制宣传片' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('promo-projects.png') })
  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(page.getByRole('tab', { name: '宣传片' })).toBeVisible()
  await expect(card).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('promo-projects-narrow.png') })
  await page.getByPlaceholder('搜索宣传片名称、单位').fill('演示公司')
  await expect(card).toBeVisible()
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/promo\?task=my-promo$/)
  await expect(page.getByRole('heading', { name: /已提交宣传片任务/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('promo-detail.png') })
})

test('没有宣传片任务时保留进入宣传片的入口', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.goto('/projects')
  await page.getByRole('tab', { name: '宣传片' }).click()
  await expect(page.getByText('暂无宣传片演示任务，可进入定制宣传片体验')).toBeVisible()
  await page.getByRole('button', { name: '＋ 进入定制宣传片' }).click()
  await expect(page).toHaveURL(/\/promo$/)
  await expect(page.getByRole('heading', { name: '定制宣传片' })).toBeVisible()
})
