import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 768, height: 720 },
  { width: 390, height: 640 },
]) {
  test(`提示词拖选和遮罩编辑 ${viewport.width}`, async ({ page }, testInfo) => {
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
    const box = (await editor.boundingBox())!
    await page.mouse.move(box.x + 30, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(Math.max(5, box.x - 40), Math.max(5, box.y - 20), { steps: 8 })
    await page.mouse.up()
    await expect(panel).toBeVisible()
    await panel.getByTitle('放大输入框').click()
    const dialog = page.getByRole('dialog', { name: '编辑提示词' })
    await expect(dialog).toBeVisible()
    const expanded = dialog.getByRole('textbox')
    await expect(expanded).toHaveText('一段需要编辑的长提示词')
    const longPrompt = Array.from(
      { length: 60 },
      (_, index) => `镜头 ${index + 1}：人物走进室内，镜头缓慢推进，柔和自然光。`,
    ).join('')
    await expanded.fill(longPrompt)
    await expect(expanded).toHaveText(longPrompt)
    await expect.poll(() => expanded.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    const dialogBox = (await dialog.boundingBox())!
    const inputBox = (await expanded.boundingBox())!
    const doneBox = (await dialog.getByRole('button', { name: '完成' }).boundingBox())!
    expect(dialogBox.x).toBeGreaterThanOrEqual(0)
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height)
    expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(doneBox.y)
    await page.screenshot({ path: testInfo.outputPath('prompt-dialog-long.png') })
    await expanded.fill('遮罩中修改后的长提示词')
    await page.screenshot({ path: testInfo.outputPath('prompt-dialog.png') })
    await dialog.getByRole('button', { name: '完成' }).click()
    await expect(editor).toHaveText('遮罩中修改后的长提示词')
    await panel.getByTitle('放大输入框').click()
    await expect(dialog.getByRole('textbox')).toHaveText('遮罩中修改后的长提示词')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(panel).toBeVisible()
  })
}
