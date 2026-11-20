import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`顶部画布操作默认收起，并按权限显示管理入口 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    const canManage = width === 1440
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/canvases/142**', (route) =>
      route.fulfill({
        json: route.request().url().includes('/members?')
          ? { can_manage: canManage, items: [] }
          : new URL(route.request().url()).pathname.endsWith('/elements')
            ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
            : { id: 142, title: '顶部操作验收', revision: 1, status: 'active' },
      }),
    )
    await page.goto('/canvas/142')
    const back = page.getByRole('button', { name: '返回无限画布' })
    const saved = page.locator('.canvas-save-status .creative-draft-save')
    await expect(saved).toHaveText('已保存到云端')
    const toggle = page.getByRole('button', { name: '画布操作', exact: true })
    const balance = page.getByRole('button', { name: /剩余积分/ })
    const tutorial = page.getByRole('button', { name: '操作教程' })
    const share = page.getByRole('button', { name: '分享这块画布' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(balance).toBeHidden()
    await expect(tutorial).toBeHidden()
    await expect(share).toBeHidden()
    await page.screenshot({ path: testInfo.outputPath('canvas-header-collapsed.png') })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(share).toBeVisible()
    for (const name of ['模型设置', '创作成员', '画布数据统计']) {
      const action = page.getByRole('button', { name, exact: true })
      if (canManage) await expect(action).toBeVisible()
      else await expect(action).toHaveCount(0)
    }
    for (const control of [back, saved, balance, tutorial]) {
      await expect(control).toBeVisible()
      await expect(control).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(control).toHaveCSS('border-top-width', '1px')
    }
    if (canManage) {
      const arrow = await toggle.boundingBox()
      const firstAction = await balance.boundingBox()
      if (!arrow || !firstAction) throw new Error('顶部折叠按钮或操作栏未显示')
      expect(arrow.x + arrow.width).toBeLessThanOrEqual(firstAction.x)
    }
    await page.screenshot({ path: testInfo.outputPath('canvas-header-transparent.png') })
    await toggle.click()
    await expect(share).toBeHidden()
    await toggle.click()
    await tutorial.click()
    await expect(page.getByTestId('tutorial-modal-mask')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '关闭' }).click()
    await expect(page.getByTestId('tutorial-modal-mask')).not.toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expectNoUnexpectedApi(api)
  })
}
