import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const viewport of [
  { name: '桌面', width: 1280, height: 720 },
  { name: '窄屏', width: 390, height: 844 },
]) {
  test(`${viewport.name}系统版本更新提示可暂缓或刷新`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    const response = await page.request.get('/app-version.json')
    expect(response.ok()).toBe(true)
    const { version } = await response.json()
    expect(typeof version).toBe('string')
    let remoteVersion = version
    await page.route('**/app-version.json*', (route) => route.fulfill({ json: { version: remoteVersion } }))
    await page.goto('/smart')
    await expect(page.getByRole('textbox', { name: '创作需求' })).toBeVisible()
    await expect(page.getByRole('status', { name: '系统更新提示' })).toHaveCount(0)
    remoteVersion = 'test-new-version'
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    const notice = page.getByRole('status', { name: '系统更新提示' })
    await expect(notice).toBeVisible()
    await expect(notice.getByText('请先确认其他未保存内容。', { exact: false })).toBeVisible()
    const fits = await notice.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
    })
    expect(fits).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('version-notice.png'), animations: 'disabled' })
    await notice.getByRole('button', { name: '稍后再说' }).click()
    await expect(notice).toHaveCount(0)
    remoteVersion = 'test-another-version'
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(notice).toBeVisible()
    await page.getByRole('textbox', { name: '创作需求' }).fill('更新前刚填写的创作需求')
    remoteVersion = version
    const navigation = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame())
    page.once('dialog', (dialog) => dialog.accept())
    await notice.getByRole('button', { name: '立即刷新' }).click()
    await navigation
    await expect(page.getByRole('textbox', { name: '创作需求' })).toHaveValue('更新前刚填写的创作需求')
    await expect(notice).toHaveCount(0)
  })

  test(`${viewport.name}更新刷新后恢复精制任务修改意见`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
    const { version } = await (await page.request.get('/app-version.json')).json()
    let remoteVersion = version
    await page.route('**/app-version.json*', (route) => route.fulfill({ json: { version: remoteVersion } }))
    await page.goto('/smart')
    await page.getByRole('textbox', { name: '创作需求' }).fill('测试精制修改草稿')
    await page.getByLabel('选择上传图片').setInputFiles({
      name: '素材.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>',
      ),
    })
    const settings = page.getByRole('button', { name: '生成设置' })
    if (await settings.isVisible()) await settings.click()
    await page.getByRole('button', { name: /生成模型/ }).click()
    await page.getByRole('button', { name: /精制交付 · T\+1/ }).click()
    await page.getByRole('button', { name: '去制作' }).click()
    await page.getByRole('button', { name: '查看订单' }).click()
    remoteVersion = 'test-order-update'
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    const orderNotice = page.getByRole('status', { name: '系统更新提示' })
    await expect(orderNotice).toBeVisible()
    remoteVersion = version
    const orderNavigation = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame())
    page.once('dialog', (dialog) => dialog.accept())
    await orderNotice.getByRole('button', { name: '立即刷新' }).click()
    await orderNavigation
    await expect(page.getByRole('button', { name: '提交精制任务（T+1）' })).toBeVisible()
    await expect(page.getByText('测试精制修改草稿')).toBeVisible()
    await page.getByRole('button', { name: '提交精制任务（T+1）' }).click()
    await page.getByRole('dialog', { name: '确认提交精制任务？' }).getByRole('button', { name: '确认提交' }).click()
    await page.getByRole('button', { name: '收起任务管理' }).click()
    await page.getByRole('button', { name: '演示：查看交付页' }).click()
    await page.getByRole('button', { name: '收起任务管理' }).click()
    const input = page.getByRole('textbox', { name: '修改意见' })
    await input.fill('刷新前的修改意见')
    remoteVersion = 'test-new-version'
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    const notice = page.getByRole('status', { name: '系统更新提示' })
    await expect(notice).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('revision-update.png'), animations: 'disabled' })
    remoteVersion = version
    const navigation = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame())
    page.once('dialog', (dialog) => dialog.accept())
    await notice.getByRole('button', { name: '立即刷新' }).click()
    await navigation
    await expect(page.getByRole('textbox', { name: '修改意见' })).toHaveValue('刷新前的修改意见')
    await page.screenshot({ path: testInfo.outputPath('revision-restored.png'), animations: 'disabled' })
    await page.getByRole('textbox', { name: '修改意见' }).fill('')
    remoteVersion = 'test-cleared-comment'
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(notice).toBeVisible()
    remoteVersion = version
    const clearNavigation = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame())
    page.once('dialog', (dialog) => dialog.accept())
    await notice.getByRole('button', { name: '立即刷新' }).click()
    await clearNavigation
    await expect(page.getByRole('textbox', { name: '修改意见' })).toHaveValue('')
  })
}
