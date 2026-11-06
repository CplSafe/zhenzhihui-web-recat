import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 640 },
]) {
  test(`长提示词滚动条 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/canvases/119**', (route) =>
      route.fulfill({
        json:
          route.request().method() === 'PATCH'
            ? { revision: 2 }
            : new URL(route.request().url()).pathname.endsWith('/elements')
              ? {
                  elements: [
                    {
                      element_id: 'source',
                      kind: 'node',
                      payload: {
                        id: 'source',
                        type: 'video',
                        position: { x: 300, y: 250 },
                        style: { width: 320, height: 240 },
                        data: { kind: 'video', prompt: '一段需要编辑的长提示词' },
                      },
                    },
                  ],
                  sync_revision: 1,
                  history_floor_revision: 0,
                  has_more: false,
                }
              : { id: 119, title: '提示词编辑检查', revision: 1 },
      }),
    )
    await page.goto('/canvas/119')
    await page.locator('.react-flow__node[data-id="source"]').click()
    const panel = page.locator('[data-canvas-node-panel]')
    const editor = panel.getByRole('textbox')
    await expect(editor).toBeVisible()
    // Native typing and controlled Enter insertions must keep the active caret visible.
    await editor.fill('')
    for (let line = 0; line < 12; line += 1) {
      await editor.pressSequentially(`画面描述${line}`)
      await editor.press('Enter')
    }
    const caretVisible = () =>
      editor.evaluate((element) => {
        const selection = window.getSelection()!
        const range = selection.getRangeAt(0).cloneRange()
        range.collapse(false)
        let caret = range.getBoundingClientRect()
        if (!caret.height) caret = element.querySelector('[data-caret-end]')!.getBoundingClientRect()
        const bounds = element.getBoundingClientRect()
        return caret.height > 0 && caret.top >= bounds.top - 1 && caret.bottom <= bounds.bottom + 1
      })
    await expect.poll(caretVisible).toBe(true)
    await expect.poll(() => editor.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await editor.press('Control+Home')
    await editor.press('Enter')
    await expect.poll(caretVisible).toBe(true)
    await expect.poll(() => editor.evaluate((element) => element.scrollTop)).toBeLessThan(24)
    await editor.press('Control+End')
    await editor.pressSequentially('末尾继续输入')
    await expect.poll(caretVisible).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('caret-follow.png'), caret: 'initial' })
    const longPrompt = Array.from(
      { length: 30 },
      (_, index) => `第${index + 1}行：视频画面与人物动作的详细描述。`,
    ).join('')
    await editor.fill(longPrompt)
    await expect.poll(() => editor.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await editor.evaluate((element) => {
      element.scrollTop = 0
    })
    await editor.hover()
    await page.mouse.wheel(0, 300)
    await expect.poll(() => editor.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect(editor).toHaveText(longPrompt)
    await page.screenshot({ path: testInfo.outputPath('long-prompt-scrollbar.png') })
    if (viewport.width === 390) {
      const panelBox = (await panel.boundingBox())!
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewport.height)
      await panel.getByText('图片参考线', { exact: false }).hover()
      await page.mouse.wheel(0, 600)
      await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      const expandBox = (await panel.getByTitle('放大输入框').boundingBox())!
      expect(expandBox.y + expandBox.height).toBeLessThanOrEqual(viewport.height)
      await page.screenshot({ path: testInfo.outputPath('panel-bottom.png') })
    }
    await panel.getByTitle('放大输入框').click()
    const dialog = page.getByRole('dialog', { name: '编辑提示词' })
    await expect(dialog.getByRole('textbox')).toHaveText(longPrompt)
    await page.keyboard.press('Escape')
    await expect(panel).toBeVisible()
  })
}
