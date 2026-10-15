import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('画布快捷键遵守焦点范围并保留浏览器与 Tab 行为', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases/119**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 119, title: 'Shortcut focus', status: 'active', revision: 1 },
    })
  })
  await page.goto('/canvas/119')
  const root = page.locator('.canvas-view')
  const pane = page.locator('.react-flow__pane')
  const menu = page.locator('.canvas-context-menu').first()
  await expect(pane).toBeVisible()
  await pane.click({ position: { x: 600, y: 300 } })
  await expect(root).toBeFocused()

  const prevented = await root.evaluate((element) => {
    return ['l', 'd', '+', '-', '0'].map((key) => {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })
      element.dispatchEvent(event)
      return event.defaultPrevented
    })
  })
  expect(prevented).toEqual([false, false, false, false, false])

  await page.keyboard.press('n')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('button', { name: '文本节点' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await page.keyboard.press('Tab')
  await expect(root).not.toBeFocused()
  await expect(menu).toBeHidden()
  await page.keyboard.press('n')
  await expect(menu).toBeHidden()

  await page.evaluate(() => {
    const button = document.createElement('button')
    button.textContent = '画布外部区域'
    button.dataset.testid = 'shortcut-outside'
    button.style.cssText = 'position:fixed;top:0;left:0;z-index:99999'
    document.body.append(button)
  })
  await pane.click({ position: { x: 600, y: 300 } })
  await page.getByTestId('shortcut-outside').click()
  await page.keyboard.press('n')
  await expect(menu).toBeHidden()
  await page.getByTestId('shortcut-outside').evaluate((element) => element.remove())

  await pane.click({ position: { x: 600, y: 300 } })
  await page.keyboard.press('Shift+/')
  await expect(page.getByRole('dialog', { name: '画布快捷键' })).toBeVisible()
  await page.keyboard.press('n')
  await expect(menu).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '画布快捷键' })).toBeHidden()
  await expect(root).toBeFocused()
  await page.keyboard.press('n')
  await expect(menu).toBeVisible()
  expectNoUnexpectedApi(api)
})
