import { expect, test, type Page } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

type FocusStop = {
  tag: string
  role: string
  label: string
  outlineWidth: string
  outlineColor: string
  boxShadow: string
}

/** 读取当前焦点元素的语义与焦点环样式，用于断言「键盘可达且焦点可见」。 */
async function readFocus(page: Page): Promise<FocusStop> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return { tag: 'NONE', role: '', label: '', outlineWidth: '0px', outlineColor: '', boxShadow: 'none' }
    const style = getComputedStyle(el)
    return {
      tag: el.tagName,
      role: el.getAttribute('role') || '',
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
    }
  })
}

function hasVisibleFocusRing(stop: FocusStop): boolean {
  const outline = stop.outlineWidth !== '0px' && stop.outlineWidth !== ''
  const shadow = stop.boxShadow !== 'none' && stop.boxShadow !== ''
  return outline || shadow
}

/** 键盘连续 Tab，收集停靠点，直到命中目标或达到上限。 */
async function tabUntil(page: Page, labels: string[], limit = 45) {
  const stops: Array<FocusStop & { index: number }> = []
  for (let index = 1; index <= limit; index += 1) {
    await page.keyboard.press('Tab')
    const stop = await readFocus(page)
    stops.push({ ...stop, index })
    if (labels.every((label) => stops.some((item) => item.label.includes(label)))) break
  }
  return stops
}

test('创作入口纯键盘 Tab 可达关键控件，且每次停靠都有可见焦点环', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  await page.goto('/smart')
  await page.getByRole('textbox', { name: '创作需求' }).waitFor()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  const stops = await tabUntil(page, ['创作需求', '生成设置', '生成模型'])

  // 1) 每个停靠点都必须落在真实可聚焦元素上，且带焦点环——不允许键盘走到「看不见焦点」的地方
  expect(stops.length).toBeGreaterThanOrEqual(5)
  for (const stop of stops) {
    expect(stop.tag, `第 ${stop.index} 个停靠点丢失焦点`).not.toBe('NONE')
    expect(hasVisibleFocusRing(stop), `第 ${stop.index} 个停靠点（${stop.label || stop.tag}）无可见焦点环`).toBe(true)
  }

  // 2) 关键控件必须能被 Tab 依次命中，顺序为输入区 → 生成设置 → 生成模型
  const indexOf = (label: string) => stops.findIndex((stop) => stop.label.includes(label))
  const inputAt = indexOf('创作需求')
  const settingsAt = indexOf('生成设置')
  const modelAt = indexOf('生成模型')
  expect(inputAt, '创作需求输入区无法通过 Tab 到达').toBeGreaterThanOrEqual(0)
  expect(settingsAt, '生成设置无法通过 Tab 到达').toBeGreaterThanOrEqual(0)
  expect(modelAt, '生成模型无法通过 Tab 到达').toBeGreaterThanOrEqual(0)
  expect(inputAt).toBeLessThan(settingsAt)
  expect(settingsAt).toBeLessThan(modelAt)

  // 3) 焦点环为全局品牌色 2px 轮廓（style.css 的 :focus-visible 约定）
  const ringed = stops.filter((stop) => stop.outlineWidth === '2px' && stop.outlineColor === 'rgb(87, 103, 229)')
  expect(ringed.length, '多数停靠点应命中品牌色 2px 焦点环').toBeGreaterThanOrEqual(Math.ceil(stops.length / 2))

  await page.screenshot({ path: testInfo.outputPath('c06-tab-focus-ring.png'), animations: 'disabled' })
})

test('生成模型菜单可用键盘开关，关闭后焦点回到触发按钮', async ({ page }) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  await page.goto('/smart')
  const trigger = page.getByRole('button', { name: /生成模型/ })
  await expect(trigger).toBeVisible()

  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')

  await page.keyboard.press('Escape')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  const afterEscape = await readFocus(page)
  expect(afterEscape.label).toContain('生成模型')

  // Space 与 Enter 应等价，键盘用户不依赖鼠标
  await page.keyboard.press(' ')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

test('精制确认弹窗可纯键盘取消，且不会误提交付费任务', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  const creates: string[] = []
  await page.route('**/api/v1/ai/models**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('capability') !== 'video') return route.fallback()
    await route.fulfill({
      json: {
        code: 0,
        data: [
          { id: 76, provider: 'manual-video', model: 'other', enabled: true, operation_codes: ['video.generate'] },
          {
            id: 77,
            provider: 'manual-video',
            enabled: true,
            display_name: '人工制作',
            operation_codes: ['video.t1'],
            params_schema: {
              fields: [
                { name: 'duration', type: 'integer', default: 30 },
                { name: 'ratio', options: ['16:9'], default: '16:9' },
                { name: 'resolution', options: ['720p'], default: '720p' },
                { name: 'generate_audio', type: 'boolean', default: false },
              ],
            },
          },
        ],
      },
    })
  })
  await page.route('**/api/v1/ai/tasks/estimate-cost', async (route) => {
    await route.fulfill({
      json: { code: 0, data: { estimated_cost: 123, balance: 1000, frozen: 0, can_afford: true } },
    })
  })
  await page.route('**/api/v1/ai/tasks**', async (route) => {
    if (route.request().method() === 'POST') creates.push(route.request().postData() || '')
    return route.fulfill({ json: { code: 0, data: { id: 91, status: 'awaiting_manual', poll_after_ms: 60000 } } })
  })

  await page.goto('/smart')
  await page.getByRole('textbox', { name: '创作需求' }).fill('键盘无障碍精制需求')
  const settings = page.getByRole('button', { name: '生成设置' })
  if (await settings.isVisible()) await settings.click()
  await page.getByRole('button', { name: /生成模型/ }).click()
  await page.getByRole('button', { name: /精制交付 · T\+1/ }).click()
  await page.getByRole('button', { name: '去制作' }).click()
  await page.getByRole('button', { name: '查看订单 →' }).click()
  await expect(page.getByRole('heading', { name: '本次生成参数' })).toBeVisible()

  await page.getByRole('button', { name: '提交精制任务（T+1）' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // 弹窗打开后按 Tab：焦点必须留在弹窗内（焦点陷阱），不能跑到弹窗外继续操作页面
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Tab')
    const inside = await page.evaluate(() => {
      const dialogEl = document.querySelector('[role="dialog"]')
      return !!dialogEl && !!document.activeElement && dialogEl.contains(document.activeElement)
    })
    expect(inside, `第 ${index + 1} 次 Tab 后焦点逸出弹窗`).toBe(true)
  }

  // 纯键盘选择「取消」：不产生任何创建请求，弹窗关闭
  await dialog.getByRole('button', { name: /取\s*消/ }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  expect(creates).toHaveLength(0)
  await expect(page.getByRole('heading', { name: '本次生成参数' })).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('c06-dialog-keyboard-cancel.png'), animations: 'disabled' })
})
