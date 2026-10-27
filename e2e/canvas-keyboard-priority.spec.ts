import { expect, test, type Page, type BrowserContext } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

// 原生全屏共享浏览器窗口焦点，同一文件顺序执行，避免测试之间抢走全屏。
test.describe.configure({ mode: 'default' })

async function setup(page: Page) {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  let revision = 1
  await page.route('**/api/v1/canvases/129**', (route) => {
    if (route.request().method() === 'PATCH')
      return route.fulfill({ json: { revision: ++revision, sync_revision: revision } })
    const url = new URL(route.request().url())
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements:
              Number(url.searchParams.get('after_revision')) > 0
                ? []
                : ['A', 'B'].map((id, index) => ({
                    element_id: id,
                    kind: 'node',
                    op: 'upsert',
                    payload: {
                      id,
                      type: 'text',
                      position: { x: 100 + index * 400, y: 100 },
                      style: { width: 250, height: 180 },
                      data: { kind: 'text', title: id, text: `节点${id}` },
                    },
                  })),
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 129, title: '浏览器快捷键优先回归', revision },
    })
  })
  await page.goto('/canvas/129')
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  return api
}

async function setKeyboardPermission(
  page: Page,
  context: BrowserContext,
  origin: string,
  setting: 'granted' | 'denied',
) {
  const session = await context.newCDPSession(page)
  const { targetInfo } = await session.send('Target.getTargetInfo')
  await session.send('Browser.setPermission', {
    permission: { name: 'keyboard-lock' },
    setting,
    origin,
    browserContextId: targetInfo.browserContextId,
  })
  // CDP 权限覆盖随会话释放而撤销；保留到本测试的 context 自动关闭。
}

for (const width of [1440, 900]) {
  test(`真实Fullscreen和Keyboard Lock授权后接管命令并退出恢复 ${width}`, async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await setKeyboardPermission(page, context, new URL(baseURL!).origin, 'granted')
    const api = await setup(page)
    expect(
      await page.evaluate(
        async () => (await navigator.permissions.query({ name: 'keyboard-lock' as PermissionName })).state,
      ),
    ).toBe('granted')
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const toggle = page.getByRole('button', { name: '全屏快捷键模式' })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true)
    await expect(page.locator('.canvas-view')).toBeFocused()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+l')
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)
    await page.locator('.canvas-view').evaluate((root) => {
      root.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Tab') root.setAttribute('data-bubbled-key', 'yes')
      })
    })
    await page.keyboard.press('Tab')
    await expect(page.locator('.canvas-context-menu').first()).toBeVisible()
    await expect(page.locator('.canvas-view')).not.toHaveAttribute('data-bubbled-key', 'yes')
    await page.screenshot({ path: testInfo.outputPath(`keyboard-priority-fullscreen-${width}.png`) })
    // 浏览器退出（Esc/系统全屏按钮）都会触发同一 fullscreenchange 清理路径。
    await page.evaluate(() => document.exitFullscreen())
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Escape')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await toggle.click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await page.screenshot({ path: testInfo.outputPath(`keyboard-priority-exited-${width}.png`) })
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}

test('真实浏览器拒绝Keyboard Lock权限后回退普通模式', async ({ page, context, baseURL }, testInfo) => {
  await setKeyboardPermission(page, context, new URL(baseURL!).origin, 'denied')
  const api = await setup(page)
  expect(
    await page.evaluate(
      async () => (await navigator.permissions.query({ name: 'keyboard-lock' as PermissionName })).state,
    ),
  ).toBe('denied')
  const toggle = page.getByRole('button', { name: '全屏快捷键模式' })
  await toggle.click()
  await expect(page.getByText('未能接管快捷键，请允许浏览器的键盘锁定权限后重试', { exact: true })).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
  await page.screenshot({ path: testInfo.outputPath('keyboard-priority-permission-denied.png') })
  expectNoUnexpectedApi(api)
})

test('不支持键盘锁定时明确提示，不进入全屏', async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'keyboard', { configurable: true, value: undefined }))
  const api = await setup(page)
  await page.getByRole('button', { name: '全屏快捷键模式' }).click()
  await expect(
    page.getByText('当前浏览器不支持全屏快捷键接管，请使用支持 Keyboard Lock 的桌面浏览器', { exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
  await page.screenshot({ path: testInfo.outputPath('keyboard-priority-unsupported.png') })
  expectNoUnexpectedApi(api)
})
