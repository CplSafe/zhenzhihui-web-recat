import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const viewport of [
  { name: '桌面', width: 1280, height: 720 },
  { name: '窄屏', width: 390, height: 844 },
]) {
  test(`${viewport.name}素材步骤实时说明未满足的条件`, async ({ page }, testInfo) => {
    await installStrictAuthenticatedApp(page)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/promo')
    await page.getByRole('button', { name: /填写制作需求/ }).click()
    await page.getByLabel(/单位 \/ 公司名称/).fill('演示公司')
    await page.getByLabel(/联系人/).fill('张经理')
    await page.getByLabel(/联系方式/).fill('13812340000')
    await page.getByLabel(/核心信息/).fill('展现生产线')
    await page.getByRole('button', { name: /下一步：上传素材/ }).click()
    const next = page.getByRole('button', { name: '下一步：确认并提交' })
    const requirements = page.getByRole('status').filter({ hasText: '完成以下事项后可进入下一步' })
    await expect(requirements).toContainText('还需上传 3 个实拍图片或视频')
    await expect(requirements).toContainText('请确认已获得素材授权')
    await expect(requirements).toContainText('请勾选制作与 AIGC 标识须知')
    await expect(next).toBeDisabled()
    await page.getByLabel('选择图片或视频').setInputFiles({
      name: '素材一.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('test'),
    })
    await expect(requirements).toContainText('还需上传 2 个实拍图片或视频')
    await page.screenshot({
      path: testInfo.outputPath('missing-requirements.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('checkbox', { name: /我确认已获得素材/ }).check()
    await expect(requirements).not.toContainText('请确认已获得素材授权')
    await page.getByRole('checkbox', { name: /我已知悉本片非即时生成/ }).check()
    await expect(requirements).not.toContainText('请勾选制作与 AIGC 标识须知')
    await page.getByLabel('选择图片或视频').setInputFiles([
      { name: '素材二.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('test') },
      { name: '素材三.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('test') },
    ])
    await expect(next).toBeEnabled()
    await page.getByRole('button', { name: '移除 素材三.jpg' }).click()
    await expect(next).toBeDisabled()
    await expect(requirements).toContainText('还需上传 1 个实拍图片或视频')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test(`${viewport.name}线下交接可提交且素材收齐后才排期`, async ({ page }, testInfo) => {
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/promo')
    await page.getByRole('button', { name: /填写制作需求/ }).click()
    await page.getByLabel(/单位 \/ 公司名称/).fill('线下素材公司')
    await page.getByLabel(/联系人/).fill('张经理')
    await page.getByLabel(/联系方式/).fill('13812340000')
    await page.getByLabel(/核心信息/).fill('介绍企业')
    await page.getByRole('button', { name: /下一步：上传素材/ }).click()
    const next = page.getByRole('button', { name: '下一步：确认并提交' })
    await page.getByRole('button', { name: '素材我线下交给顾问' }).click()
    const offline = page.getByRole('status').filter({ hasText: '线下交接素材' })
    await expect(offline).toContainText('素材收齐后开始计算 5 天交付时间')
    await expect(offline.getByRole('link', { name: '13681065734' })).toHaveAttribute('href', 'tel:13681065734')
    await expect(page.getByText(/还需上传/)).toHaveCount(0)
    await expect(next).toBeDisabled()
    await page.screenshot({
      path: testInfo.outputPath('offline-selection.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: /已选择线下交接/ }).click()
    await expect(page.getByText('还需上传 3 个实拍图片或视频')).toBeVisible()
    await page.getByRole('button', { name: '素材我线下交给顾问' }).click()
    await page.getByRole('checkbox', { name: /我确认已获得素材/ }).check()
    await page.getByRole('checkbox', { name: /我已知悉本片非即时生成/ }).check()
    await expect(next).toBeEnabled()
    await next.click()
    await expect(page.getByText('线下交给顾问（待交接）', { exact: false })).toBeVisible()
    await expect(page.getByText('素材收齐后确定')).toBeVisible()
    await page.getByRole('button', { name: '提交宣传片任务（T+5）' }).click()
    const dialog = page.getByRole('dialog', { name: '确认提交宣传片任务？' })
    await expect(dialog).toContainText('素材收齐后确定')
    await dialog.getByRole('button', { name: '确认提交' }).click()
    await expect(page.getByRole('heading', { name: '已提交演示任务，请联系顾问交接素材' })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: '上传素材' })).toContainText('待交接')
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('zzh_promo_demo_v1')!).state.tasks[0])
    expect(pending).toMatchObject({ status: '待交接', materialDelivery: 'offline', dueAt: 0 })
    await page.getByRole('button', { name: '收起任务管理' }).click()
    await page.reload()
    await expect(page.getByRole('heading', { name: '已提交演示任务，请联系顾问交接素材' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('offline-pending.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '演示控制' }).click()
    await page.getByRole('button', { name: '演示：素材已交接' }).click()
    const received = await page.evaluate(() => JSON.parse(localStorage.getItem('zzh_promo_demo_v1')!).state.tasks[0])
    expect(received.status).toBe('制作中')
    expect(received.dueAt).toBeGreaterThan(received.createdAt)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

test('定制宣传片演示从需求到交付与一次修改', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.goto('/promo')
  await expect(page.getByRole('heading', { name: '定制宣传片' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('intro.png') })
  await page.getByRole('button', { name: /填写制作需求/ }).click()
  await expect(page.getByRole('listitem').filter({ hasText: '填写需求' })).toHaveAttribute('aria-current', 'step')
  await page.getByLabel(/单位 \/ 公司名称/).fill('演示公司')
  await page.getByLabel(/联系人/).fill('张经理')
  await page.getByLabel(/联系方式/).fill('13812340000')
  await page.getByLabel(/核心信息/).fill('展现生产线和产品质量')
  await page.getByLabel(/期望时长/).selectOption('60')
  await page.screenshot({ path: testInfo.outputPath('form.png'), fullPage: true })
  await page.getByRole('button', { name: /下一步：上传素材/ }).click()
  await expect(page.getByRole('listitem').filter({ hasText: '上传素材' })).toHaveAttribute('aria-current', 'step')
  const next = page.getByRole('button', { name: '下一步：确认并提交' })
  await expect(next).toBeDisabled()
  await page.getByLabel('选择图片或视频').setInputFiles([
    {
      name: '生产线.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    },
    { name: '质检.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('test') },
    { name: '车间.mp4', mimeType: 'video/mp4', buffer: Buffer.from('test') },
  ])
  await expect(page.getByText(/生产线\.png.*低于 1080P/)).toBeVisible()
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await expect(next).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('materials.png') })
  await next.click()
  await expect(page.getByRole('listitem').filter({ hasText: '确认提交' })).toHaveAttribute('aria-current', 'step')
  await expect(page.getByText('2,250 积分', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('order.png') })
  await page.getByRole('button', { name: '提交宣传片任务（T+5）' }).click()
  const dialog = page.getByRole('dialog', { name: '确认提交宣传片任务？' })
  await expect(dialog).toContainText('1,500 积分')
  await expect(dialog).toContainText('750 积分')
  await expect(dialog).not.toContainText('¥')
  await dialog.getByRole('button', { name: '确认提交' }).click()
  await expect(page.getByRole('heading', { name: /已提交宣传片任务/ })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: '制作与交付' })).toHaveAttribute('aria-current', 'step')
  await expect(page.getByRole('tab', { name: '宣传片' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: '正在生成' }).click()
  await expect(page.getByRole('button', { name: /企业形象片 · 演示公司/ })).toBeVisible()
  await page.getByRole('tab', { name: '宣传片' }).click()
  await page.getByRole('button', { name: /企业形象片 · 演示公司/ }).click()
  await page.getByRole('button', { name: '收起任务管理' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: /已提交宣传片任务/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('waiting.png') })
  await page.getByRole('button', { name: '演示控制' }).click()
  await page.getByRole('button', { name: '已交付' }).click()
  await expect(page.getByRole('heading', { name: '不满意？提 1 次修改' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('delivery.png') })
  await page.getByLabel('修改意见').fill('调整结尾字幕')
  await page.getByRole('button', { name: '提交修改' }).click()
  await expect(page.getByRole('heading', { name: '修改已受理，请等待再次交付' })).toBeVisible()
  await expect(page.getByText('修改权益已使用 1/1，预计 2 天内再次交付。')).toBeVisible()
})

test('窄屏页面保持可用且没有横向溢出', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/promo')
  await expect(page.getByRole('heading', { name: '定制宣传片' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'AI 助手' })).toBeHidden()
  const rail = await page.getByRole('button', { name: '展开任务管理' }).boundingBox()
  expect(rail?.y).toBeGreaterThan(56)
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true })
})

test('任务抽屉展开时首页内容与价格保持清晰', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page)
  await page.setViewportSize({ width: 1354, height: 900 })
  await page.goto('/promo')
  await expect(page.getByRole('heading', { name: '定制宣传片' })).toBeVisible()
  const expand = page.getByRole('button', { name: '展开任务管理' })
  if (await expand.isVisible()) await expand.click()
  await expect(page.getByRole('complementary', { name: '任务管理', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /填写制作需求/ })).toBeVisible()
  const lineCount = await page.getByText('预计消耗', { exact: true }).evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return range.getClientRects().length
  })
  expect(lineCount).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('expanded-drawer.png') })
  await page.getByRole('button', { name: /填写制作需求/ }).click()
  await expect(page.getByRole('heading', { name: '填写宣传片需求' })).toBeVisible()
})

test('桌面任务抽屉延伸至视口底部，长任务列表可独立滚动', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page)
  await page.addInitScript((workspaceId) => {
    const tasks = Array.from({ length: 18 }, (_, index) => ({
      id: `promo-test-${index}`,
      ownerId: 7,
      workspaceId,
      org: `演示企业 ${index}`,
      scene: '企业形象片',
      duration: 180,
      dueAt: Date.now() + 432000000,
      status: '制作中',
    }))
    localStorage.setItem('zzh_promo_demo_v1', JSON.stringify({ state: { tasks }, version: 0 }))
  }, WORKSPACE_ID)
  await page.setViewportSize({ width: 1354, height: 900 })
  await page.goto('/promo')
  await expect(page.getByRole('heading', { name: '定制宣传片' })).toBeVisible()
  const expand = page.getByRole('button', { name: '展开任务管理' })
  if (await expand.isVisible()) await expand.click()
  const drawer = page.getByRole('complementary', { name: '任务管理', exact: true })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('tab', { name: '宣传片' }).click()
  const bounds = await drawer.boundingBox()
  expect(bounds?.y).toBeCloseTo(56, 0)
  expect(bounds?.height).toBeCloseTo(844, 0)
  const list = drawer.getByRole('tabpanel', { name: '宣传片任务' })
  const scroll = await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    return { scrollTop: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }
  })
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight)
  expect(scroll.scrollTop).toBeGreaterThan(0)
  await page.screenshot({ path: testInfo.outputPath('full-height-drawer.png') })
  await drawer.getByRole('button', { name: '收起任务管理' }).click()
  await expect(page.getByRole('button', { name: '展开任务管理' })).toBeVisible()
})
