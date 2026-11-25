import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

function launcherInsets(launcher: Locator) {
  return launcher.evaluate((element: HTMLElement) => ({
    right: window.innerWidth - element.offsetLeft - element.offsetWidth,
    bottom: window.innerHeight - element.offsetTop - element.offsetHeight,
  }))
}

async function dragLauncherAway(page: Page, launcher: Locator) {
  const box = await launcher.boundingBox()
  if (!box) throw new Error('AI 助手悬浮球不可见')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(110, 160, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await launcherInsets(launcher)).right).toBeGreaterThan(100)
  await expect(launcher).toHaveAttribute('aria-expanded', 'false')
}

test('窗口缩小和放大后 AI 助手重新贴到右下角', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/templates')
  const launcher = page.getByRole('button', { name: 'AI 助手', exact: true })
  const defaultInsets = { right: 24, bottom: 24 }
  await expect.poll(() => launcherInsets(launcher)).toEqual(defaultInsets)

  await dragLauncherAway(page, launcher)
  await launcher.click()
  const panel = page.getByRole('dialog', { name: 'AI 助手' })
  const search = panel.getByRole('textbox', { name: '搜索帮助内容' })
  await search.fill('分镜')
  await page.setViewportSize({ width: 390, height: 680 })
  await expect.poll(() => launcherInsets(launcher)).toEqual(defaultInsets)
  await expect(launcher).toHaveAttribute('aria-expanded', 'true')
  await expect(search).toHaveValue('分镜')
  await expect(panel).toBeInViewport({ ratio: 1 })
  await expect
    .poll(() =>
      panel.evaluate((element) => {
        const ball = document.querySelector<HTMLButtonElement>('button[aria-controls="help-center-dialog"]')
        return Boolean(ball && element.getBoundingClientRect().bottom < ball.getBoundingClientRect().top)
      }),
    )
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('assistant-resized-narrow-open.png'), animations: 'disabled' })

  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await dragLauncherAway(page, launcher)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(() => launcherInsets(launcher)).toEqual(defaultInsets)
  await page.reload()
  await expect.poll(() => launcherInsets(launcher)).toEqual(defaultInsets)
  await page.screenshot({ path: testInfo.outputPath('assistant-resized-wide.png'), animations: 'disabled' })
  expectNoUnexpectedApi(api)
})

test('窗口缩小时画布助手回到右下并为底部工具留出空间', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/142**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 142, title: '助手位置回归', revision: 1, status: 'active' },
    }),
  )
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/canvas/142')
  const launcher = page.getByRole('button', { name: 'AI 助手', exact: true })
  const canvasInsets = { right: 24, bottom: 112 }
  await expect.poll(() => launcherInsets(launcher)).toEqual(canvasInsets)
  await dragLauncherAway(page, launcher)
  await page.setViewportSize({ width: 390, height: 680 })
  await expect.poll(() => launcherInsets(launcher)).toEqual(canvasInsets)
  await page.screenshot({ path: testInfo.outputPath('assistant-resized-canvas.png'), animations: 'disabled' })
  expectNoUnexpectedApi(api)
})
