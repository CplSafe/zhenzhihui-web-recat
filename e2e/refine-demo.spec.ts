import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'
import { getDemoDueAt } from '../src/utils/refineDelivery'

async function start(page: Page, testInfo: TestInfo) {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  await page.goto('/smart')
  await page.getByRole('textbox', { name: '创作需求' }).fill('演示精制视频需求')
  await page.getByLabel('选择上传图片').setInputFiles({
    name: '素材.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="teal"/></svg>',
    ),
  })
  await expect(page.getByRole('button', { name: '查看参考素材' })).toBeVisible()
  const settings = page.getByRole('button', { name: '生成设置' })
  if (await settings.isVisible()) await settings.click()
  await page.getByRole('button', { name: /生成模型/ }).click()
  await page.getByRole('button', { name: /精制交付 · T\+1/ }).click()
  await page.getByRole('button', { name: '去制作' }).click()
  await expect(page.getByText(/演示模式：订单/)).toBeVisible()
  await page.getByRole('button', { name: '查看订单' }).click()
  await page.screenshot({ path: testInfo.outputPath('order.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '提交精制任务（T+1）' }).click()
  const dialog = page.getByRole('dialog', { name: '确认提交精制任务？' })
  await expect(dialog).toContainText('1,125 积分')
  await expect(dialog).toContainText('明天 18:00 前')
  await dialog.getByRole('button', { name: '确认提交' }).click()
}

test('精制任务提交、筛选、刷新恢复、交付和修改', async ({ page }, testInfo) => {
  await start(page, testInfo)
  const drawer = page.getByRole('complementary', { name: '任务管理', exact: true })
  await expect(drawer.getByRole('tab', { name: '爆款成片' })).toHaveAttribute('aria-selected', 'true')
  await expect(drawer.getByRole('tab', { name: '精制任务' })).toHaveCount(0)
  await expect(drawer.getByRole('button', { name: /演示精制视频需求/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('task-list.png'), animations: 'disabled' })
  await drawer.getByLabel('状态').selectOption({ label: '精修中' })
  await drawer.getByRole('button', { name: /演示精制视频需求/ }).click()
  const detail = page.getByRole('dialog', { name: '精制任务详情（演示）' })
  await expect(detail).toContainText('1,125 积分（模拟）')
  await expect(detail.getByRole('img', { name: '素材 1' })).toBeVisible()
  const deliveryTimeFits = await detail.getByText('承诺交付', { exact: true }).evaluate((label) => {
    const body = label.closest('.ant-modal-body')!
    const rect = label.parentElement!.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    return rect.top >= bodyRect.top && rect.bottom <= bodyRect.bottom
  })
  expect(deliveryTimeFits).toBe(true)
  const footerFits = await detail.getByRole('button', { name: '进入任务页' }).evaluate((button) => {
    const rect = button.getBoundingClientRect()
    return rect.top >= 0 && rect.bottom <= window.innerHeight
  })
  expect(footerFits).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('task-detail.png'), animations: 'disabled' })
  await detail.getByRole('button', { name: '进入任务页' }).click()
  await expect(page.getByRole('heading', { name: '任务已提交，明天来验收成片' })).toBeVisible()
  const createdTask = await page.evaluate(() => {
    const task = JSON.parse(localStorage.getItem('zzh_refine_demo_v1')!).state.tasks[0]
    return { dueAt: task.dueAt, createdAt: task.createdAt }
  })
  expect(createdTask.dueAt).toBe(getDemoDueAt(createdTask.createdAt))
  await page.reload()
  await expect(page.getByRole('heading', { name: '任务已提交，明天来验收成片' })).toBeVisible()
  await page.getByRole('button', { name: '查看我的精制任务' }).click()
  await page.getByRole('button', { name: /演示精制视频需求/ }).click()
  await expect(
    page.getByRole('dialog', { name: '精制任务详情（演示）' }).getByRole('img', { name: '素材 1' }),
  ).toBeVisible()
  await page.getByRole('dialog', { name: '精制任务详情（演示）' }).getByRole('button', { name: '进入任务页' }).click()
  await page.screenshot({ path: testInfo.outputPath('waiting.png') })
  await page.getByRole('button', { name: '演示：查看交付页' }).click()
  await page.getByRole('button', { name: '收起任务管理' }).click()
  await expect(page.locator('video[controls]')).toBeVisible()
  await expect(page.getByText(/示例视频为操作教程/)).toBeVisible()
  await expect(page.getByRole('link', { name: '下载示例视频' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('delivery.png') })
  await page.reload()
  await expect(page.getByRole('heading', { name: '精修成片' })).toBeVisible()
  await page.getByRole('textbox', { name: '修改意见' }).fill('调整镜头')
  const revisionStarted = await page.evaluate(() => Date.now())
  await page.getByRole('button', { name: '提交修改，重新排期' }).click()
  const revisionDue = await page.evaluate(
    () => JSON.parse(localStorage.getItem('zzh_refine_demo_v1')!).state.tasks[0].dueAt,
  )
  expect(revisionDue).toBe(getDemoDueAt(revisionStarted))
  await page.getByRole('button', { name: '收起任务管理' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: '任务已提交，明天来验收成片' })).toBeVisible()
  await page.getByRole('button', { name: '演示：模拟超时' }).click()
  await expect(page.getByRole('heading', { name: '制作中，顾问会联系你' })).toBeVisible()
  await page.getByRole('button', { name: '演示：模拟退款' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: '演示积分已退回' })).toBeVisible()
})

test('窄屏任务入口和交付内容可见', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await start(page, testInfo)
  await page.screenshot({ path: testInfo.outputPath('narrow-task-list.png'), animations: 'disabled' })
  await page.getByRole('button', { name: /演示精制视频需求/ }).click()
  const detail = page.getByRole('dialog', { name: '精制任务详情（演示）' })
  await expect(detail.getByRole('img', { name: '素材 1' })).toBeVisible()
  await expect(detail.getByRole('button', { name: '进入任务页' })).toBeVisible()
  const dialogFits = await detail.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.left >= 0 && rect.right <= window.innerWidth && element.scrollWidth <= element.clientWidth
  })
  expect(dialogFits).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('narrow-task-detail.png'), animations: 'disabled' })
  await detail.getByRole('button', { name: '进入任务页' }).click()
  await page.getByRole('button', { name: '演示：查看交付页' }).click()
  await page.getByRole('button', { name: '收起任务管理' }).click()
  await expect(page.getByRole('heading', { name: '这条片子想改？' })).toBeVisible()
  const videoFits = await page.locator('video[controls]').evaluate((element) => {
    const video = element.getBoundingClientRect()
    const card = element.closest('section')!.getBoundingClientRect()
    return video.left >= card.left && video.right <= card.right
  })
  expect(videoFits).toBe(true)
  const overlap = await page.getByRole('button', { name: '展开任务管理' }).evaluate((element) => {
    const rail = element.getBoundingClientRect()
    const title = document.querySelector('video')!.closest('section')!.getBoundingClientRect()
    return rail.right > title.left && rail.left < title.right && rail.bottom > title.top && rail.top < title.bottom
  })
  expect(overlap).toBe(false)
  await expect(page.getByRole('button', { name: 'AI 助手' })).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('narrow-delivery.png'), fullPage: true })
})

test('即时模型选择长时长后自动切换精制并显示测评选项', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: [
        { id: 9801, enabled: true, display_name: '脚本模型', operation_codes: ['responses.multimodal'] },
        { id: 9804, enabled: true, display_name: '即时视频模型', operation_codes: ['video.generate'] },
      ],
    }),
  )
  await page.goto('/smart')
  await page.getByRole('button', { name: /生成模型/ }).click()
  await page.getByRole('option', { name: /即时视频模型/ }).click()
  await expect(page.getByRole('dialog', { name: '创作参数' })).toBeVisible()
  await page.getByRole('button', { name: '45秒' }).click()
  await expect(page.getByRole('button', { name: /生成模型，精制交付/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /创作参数/ })).toContainText('45s')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '选择爆款脚本' }).click()
  await expect(page.getByRole('option', { name: '测评视频' })).toBeVisible()
  await page.getByRole('option', { name: '测评视频' }).click()
  await page.getByRole('button', { name: /生成模型，精制交付/ }).click()
  await page.getByRole('option', { name: /即时视频模型/ }).click()
  await page.getByRole('button', { name: '选择爆款脚本' }).click()
  await expect(page.getByRole('option', { name: '测评视频' })).toHaveCount(0)
})
