import { expect, test } from '@playwright/test'
import {
  HOT_COPY_PROJECT_ID,
  SMART_PROJECT_ID,
  WORKSPACE_ID,
  expectNoUnexpectedApi,
  installStrictAuthenticatedApp,
} from './fixtures/strict-authenticated-app'

for (const project of [
  { id: SMART_PROJECT_ID, title: 'E2E 智能项目' },
  { id: HOT_COPY_PROJECT_ID, title: 'E2E 爆款项目' },
]) {
  test(`从项目卡片封面进入 ${project.title} 的作品列表`, async ({ page }, testInfo) => {
    const api = await installStrictAuthenticatedApp(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/projects')
    const card = page.getByRole('button', { name: `打开项目 ${project.title}` })
    await expect(card).toBeVisible()
    await card.locator('.pm2-pcard-cover').click()
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/videos$`))
    await expect(page.getByText(new RegExp(`${project.title}（\\d+个视频）`))).toBeVisible()
    expect(
      api.seen.some(
        (request) => request.path === `/api/v1/creative/projects/${project.id}` && request.workspaceId === WORKSPACE_ID,
      ),
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('opened-project.png') })
    expectNoUnexpectedApi(api)
  })
}

test('图片项目从卡片进入图片创作工作区', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  const project = {
    id: 313,
    workspace_id: WORKSPACE_ID,
    user_id: 7,
    title: '图片项目',
    draft_json: { flow: 'smart', smart: { flow: 'smart', entryMeta: { mode: 'image' }, imageMessages: [] } },
  }
  await page.route('**/api/v1/creative/projects?*', (route) => route.fulfill({ json: { items: [project], total: 1 } }))
  await page.route('**/api/v1/creative/projects/313?*', (route) => route.fulfill({ json: project }))
  await page.goto('/projects')
  const card = page.getByRole('button', { name: '打开项目 图片项目' })
  await expect(card).toBeVisible()
  await card.locator('.pm2-pcard-cover').click()
  await expect(page).toHaveURL(/\/smart\/313$/)
  await expect(page.getByRole('heading', { name: '制作图片' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('image-project.png') })
  expectNoUnexpectedApi(api)
})

test('从有未保存输入的创作页离开后仍可打开项目', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  const warnings: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('A router only supports one blocker at a time')) warnings.push(message.text())
  })
  await page.goto('/smart')
  await page.getByRole('textbox', { name: '创作需求' }).fill('未保存的输入')
  await page.getByRole('button', { name: '项目管理' }).click()
  const confirm = page.getByRole('alertdialog', { name: '确认离开' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '继续编辑' }).click()
  await expect(page).toHaveURL(/\/smart$/)
  await expect(page.getByRole('textbox', { name: '创作需求' })).toHaveValue('未保存的输入')
  await page.getByRole('button', { name: '项目管理' }).click()
  await confirm.getByRole('button', { name: '确认离开' }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await page.getByRole('button', { name: '打开项目 E2E 智能项目' }).locator('.pm2-pcard-cover').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${SMART_PROJECT_ID}/videos$`))
  expect(warnings).toEqual([])
})

test('从爆款复制入口切换到项目管理后可打开项目', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.goto('/hot-copy')
  await expect(page.getByRole('dialog', { name: '新手引导' })).toBeVisible()
  await page.getByRole('button', { name: '项目管理' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('dialog', { name: '新手引导' })).toHaveCount(0)
  await page.getByRole('button', { name: '打开项目 E2E 爆款项目' }).locator('.pm2-pcard-cover').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${HOT_COPY_PROJECT_ID}/videos$`))
})
