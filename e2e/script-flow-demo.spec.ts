import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`本机演示创意审核 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.goto('/script-ideas/stage/demo')
    await expect(page.getByText('附件只记录文件名', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: '提交创意' }).click()
    await expect(page.getByRole('alert')).toContainText('剧本文档附件')
    await page.getByLabel('申请人').fill('测试申请人')
    await page.getByLabel('学校').fill('测试学校')
    await page.getByLabel('剧名').fill('测试剧名')
    await page.getByLabel('题材').fill('悬疑')
    await page.getByLabel('剧情简介').fill('故事简介')
    await page
      .getByLabel('剧本文档附件')
      .setInputFiles({ name: '创意.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('demo') })
    await page.getByRole('button', { name: '提交创意' }).click()
    await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
    await expect(page.locator('.si-readonly')).toContainText('测试剧名')
    await expect(page.locator('.si-readonly')).toContainText('悬疑')
    await expect(page.locator('.si-readonly')).toContainText('创意.docx')
    await expect(page.getByRole('heading', { name: '审批记录' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
    await expect(page.getByRole('button', { name: '模拟审核通过' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '模拟打回' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '撤回提交' })).toBeVisible()
    await expect(page.locator('.si-progress')).not.toContainText('入驻')
    await page.screenshot({ path: testInfo.outputPath(`script-flow-${width}.png`), fullPage: true })
    expectNoUnexpectedApi(api)
  })
}

test('演示审核中仍可撤回并重新提交', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.goto('/script-ideas/stage/demo')
  await page.getByLabel('申请人').fill('测试申请人')
  await page.getByLabel('学校').fill('测试学校')
  await page.getByLabel('剧名').fill('示例剧')
  await page.getByLabel('题材').fill('悬疑')
  await page.getByLabel('剧情简介').fill('示例剧情')
  await page
    .getByLabel('剧本文档附件')
    .setInputFiles({ name: '示例.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('test') })
  await page.getByRole('button', { name: '提交创意', exact: true }).click()
  await page.getByRole('button', { name: '撤回提交' }).click()
  await expect(page.getByRole('heading', { name: '已撤回' })).toBeVisible()
  await expect(page.getByLabel('剧名')).toHaveValue('示例剧')
  await page.getByRole('button', { name: '重新提交创意' }).click()
  await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
  expectNoUnexpectedApi(api)
})

test('演示记录进入列表并支持统计、筛选和恢复', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.route('**/api/v1/student-applications?**', (route) =>
    route.fulfill({ json: { code: 0, data: { items: [], total: 0 } } }),
  )
  await page.goto('/script-ideas/stage/demo')
  await page.getByLabel('申请人').fill('测试申请人')
  await page.getByLabel('学校').fill('测试学校')
  await page.getByLabel('剧名').fill('可筛选演示剧')
  await page.getByLabel('题材').fill('悬疑')
  await page.getByLabel('剧情简介').fill('剧情')
  await page
    .getByLabel('剧本文档附件')
    .setInputFiles({ name: '剧本.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('demo') })
  await page.getByRole('button', { name: '提交创意', exact: true }).click()
  await page.goto('/script-ideas/list')
  await page.getByRole('button', { name: '本机演示', exact: true }).click()
  const list = page.getByRole('region', { name: '本机演示创意' })
  await expect(list).toContainText('可筛选演示剧')
  await list.getByLabel('演示审核状态').selectOption('revision')
  await expect(list).not.toContainText('可筛选演示剧')
  await list.getByLabel('演示审核状态').selectOption('reviewing')
  await list.getByRole('button', { name: /可筛选演示剧/ }).click()
  await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
  expectNoUnexpectedApi(api)
})

test('提交创意页可进入明确标识的原型流程', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.goto('/script-ideas/new')
  await page.getByRole('button', { name: '新建本机演示创意' }).click()
  await expect(page.getByRole('heading', { name: '提交新创意' })).toBeVisible()
  await expect(page.getByText('不创建真实申请', { exact: false })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('new-idea.png'), fullPage: true })
  expectNoUnexpectedApi(api)
})

for (const width of [1440, 390]) {
  test(`创意列表按数据来源切换 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.route('**/api/v1/student-applications?**', (route) =>
      route.fulfill({
        json: { code: 0, data: { items: [{ id: 31, state: 'submitted', name: '测试申请' }], total: 11 } },
      }),
    )
    await page.goto('/script-ideas/list')
    await expect(page.getByRole('button', { name: '真实申请' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('创意申请 #31')).toBeVisible()
    await expect(page.getByRole('region', { name: '本机演示创意' })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`list-real-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '本机演示', exact: true }).click()
    await expect(page.getByRole('region', { name: '本机演示创意' })).toBeVisible()
    await expect(page.getByText('创意申请 #31')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`list-demo-${width}.png`), fullPage: true })
    await page.reload()
    await expect(page.getByRole('button', { name: '本机演示', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '真实申请' }).click()
    await expect(page.getByText('创意申请 #31')).toBeVisible()
    expectNoUnexpectedApi(api)
  })
}
