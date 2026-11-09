import { test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('probe tab order', async ({ page }) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  await page.goto('/smart')
  await page.getByRole('textbox', { name: '创作需求' }).waitFor()
  await page.waitForTimeout(800)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const seen: string[] = []
  for (let i = 0; i < 16; i += 1) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return 'none'
      const cs = getComputedStyle(el)
      const label = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 24)
      return [
        el.tagName,
        el.getAttribute('role') || '',
        label,
        cs.outlineWidth,
        cs.outlineColor,
        cs.boxShadow.slice(0, 40),
      ].join(' | ')
    })
    seen.push(`${i + 1}: ${info}`)
  }
  console.log('=== TAB ORDER ===\n' + seen.join('\n'))

  // 模型菜单键盘行为
  const trigger = page.getByRole('button', { name: /生成模型/ })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  console.log('AFTER ENTER expanded=', await trigger.getAttribute('aria-expanded'))
  const menu = page.locator('[role="listbox"], [role="menu"]')
  console.log('MENU COUNT=', await menu.count())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  console.log(
    'AFTER ESC expanded=',
    await trigger.getAttribute('aria-expanded'),
    'active=',
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
  )
})
