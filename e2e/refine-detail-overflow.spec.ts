import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

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

for (const viewport of [
  { name: '桌面', width: 1280, height: 720 },
  { name: '窄屏', width: 390, height: 844 },
]) {
  test(`${viewport.name}任务详情支持长描述和多素材`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await start(page, testInfo)
    await page.evaluate(async () => {
      const stored = JSON.parse(localStorage.getItem('zzh_refine_demo_v1')!)
      const task = stored.state.tasks[0]
      task.description = `长描述测试：${'这是一段需要完整展示的创作需求，包含产品介绍和镜头要求。'.repeat(20)}描述结束`
      task.revisionNote = `修改要求：${'请调整镜头和文案。'.repeat(12)}修改结束`
      task.materialCount = 12
      task.materials = Array.from({ length: 12 }, (_, index) => ({
        kind: 'local',
        key: `${task.ownerId}:${task.workspaceId}:${task.id}:stress-${index}`,
      }))
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('zzh_refine_demo_media', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('images')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('images', 'readwrite')
        for (const item of task.materials) {
          transaction
            .objectStore('images')
            .put(
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              item.key,
            )
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      db.close()
      localStorage.setItem('zzh_refine_demo_v1', JSON.stringify(stored))
    })
    await page.reload()
    await expect(page.getByRole('button', { name: /长描述测试/ })).toBeVisible()
    await page.getByRole('button', { name: /长描述测试/ }).click()
    const detail = page.getByRole('dialog', { name: '精制任务详情（演示）' })
    await expect(detail.getByRole('img', { name: '素材 12' })).toBeAttached()
    const body = detail.locator('.ant-modal-body')
    const button = detail.getByRole('button', { name: '进入任务页' })
    await expect.poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('long-detail-top.png'), animations: 'disabled' })
    await detail.getByText(/修改结束/).scrollIntoViewIfNeeded()
    await expect(detail.getByText(/修改结束/)).toBeInViewport()
    await expect(button).toBeInViewport({ ratio: 1 })
    const noOverlap = await button.evaluate((element) => {
      const buttonRect = element.getBoundingClientRect()
      const bodyRect = element.closest('.ant-modal-content')!.querySelector('.ant-modal-body')!.getBoundingClientRect()
      return buttonRect.top >= bodyRect.bottom && buttonRect.bottom <= window.innerHeight
    })
    expect(noOverlap).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('long-detail-bottom.png'), animations: 'disabled' })
    await button.click()
    await expect(page.getByRole('heading', { name: '任务已提交，明天来验收成片' })).toBeVisible()
  })
}
