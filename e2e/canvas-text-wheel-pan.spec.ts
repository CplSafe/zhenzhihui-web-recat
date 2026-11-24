import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('滚轮默认平移画布，仅在聚焦的音频编辑框上滚动文案', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const audioPrompt = Array.from({ length: 24 }, (_, index) => `第 ${index + 1} 行配音文案`).join('\n')
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: [] }))
  await page.addInitScript(() => localStorage.setItem('zzh_canvas_preferences', JSON.stringify({ wheelMode: 'pan' })))
  await page.route('**/api/v1/canvases/953**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'pan-text',
                kind: 'node',
                payload: {
                  id: 'pan-text',
                  type: 'text',
                  position: { x: 200, y: 160 },
                  style: { width: 300, height: 220 },
                  data: { kind: 'text', title: '文本节点', text: '在文本节点上滚动触控板，画布应继续平移。' },
                },
              },
              {
                element_id: 'pan-audio',
                kind: 'node',
                payload: {
                  id: 'pan-audio',
                  type: 'audio',
                  position: { x: 650, y: 160 },
                  style: { width: 320, height: 220 },
                  data: { kind: 'audio', title: '音频节点', prompt: audioPrompt },
                },
              },
              {
                element_id: 'pan-failure-id',
                kind: 'node',
                payload: {
                  id: 'pan-failure-id',
                  type: 'image',
                  position: { x: 200, y: 520 },
                  style: { width: 300, height: 220 },
                  data: {
                    kind: 'image',
                    title: '失败的图片节点',
                    taskStatus: 'failed',
                    taskError: '模拟失败',
                    taskFailure: { requestId: 'request-pan-test' },
                  },
                },
              },
              {
                element_id: 'pan-failure-retry',
                kind: 'node',
                payload: {
                  id: 'pan-failure-retry',
                  type: 'video',
                  position: { x: 650, y: 520 },
                  style: { width: 320, height: 220 },
                  data: {
                    kind: 'video',
                    title: '配音失败的视频节点',
                    taskStatus: 'failed',
                    taskError: '模拟失败',
                    videoAudioComposition: { failed: true },
                  },
                },
              },
              {
                element_id: 'pan-audio-reference',
                kind: 'node',
                payload: {
                  id: 'pan-audio-reference',
                  type: 'audio',
                  position: { x: 1020, y: 520 },
                  style: { width: 320, height: 120 },
                  data: { kind: 'audio', title: '参考旁白', assetId: 51, assetWorkspaceId: 21 },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 953, title: '文本节点滚轮平移', revision: 1 },
    }),
  )
  await page.route('**/api/v1/assets/51/download**', (route) =>
    route.fulfill({
      contentType: 'audio/wav',
      body: Buffer.from('UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA', 'base64'),
    }),
  )
  await page.route('**/api/v1/canvases/953/node-locks**', (route) =>
    route.fulfill({ json: { granted: true, nodes: {} } }),
  )

  await page.goto('/canvas/953')
  const node = page.locator('.react-flow__node[data-id="pan-text"]')
  await expect(node).toBeVisible()
  const transform = () =>
    page.locator('.react-flow__viewport').evaluate((element) => getComputedStyle(element).transform)
  const expectWheelToPan = async (deltaY = 120) => {
    const before = await transform()
    await page.mouse.wheel(0, deltaY)
    await expect.poll(transform).not.toBe(before)
  }
  await node.locator('.canvas-node-prompt').hover()
  await expectWheelToPan()

  const audioNode = page.locator('.react-flow__node[data-id="pan-audio"]')
  await audioNode.locator('.canvas-node-header').click()
  const audioPanel = audioNode.locator('.canvas-audio-panel')
  const audioPromptEditor = audioPanel.getByRole('textbox', { name: '配音文案或音乐描述' })
  const audioPromptScroll = () => audioPromptEditor.evaluate((element) => element.scrollTop)
  await expect(audioPromptEditor).toHaveValue(audioPrompt)
  await expect(audioNode).toHaveClass(/selected/)
  await expect(audioPromptEditor).not.toBeFocused()
  await audioPromptEditor.hover()
  const idleScroll = await audioPromptScroll()
  await expectWheelToPan(60)
  expect(await audioPromptScroll()).toBe(idleScroll)

  await audioPromptEditor.click()
  await expect(audioPromptEditor).toBeFocused()
  await page.keyboard.press('ControlOrMeta+Home')
  await expect.poll(audioPromptScroll).toBe(0)
  const beforeEditing = await transform()
  await page.mouse.wheel(0, 120)
  await expect.poll(audioPromptScroll).toBeGreaterThan(0)
  expect(await transform()).toBe(beforeEditing)
  await page.screenshot({ path: testInfo.outputPath('audio-prompt-scrolled-while-focused.png') })

  await page.locator('.react-flow__pane').hover({ position: { x: 120, y: 360 } })
  await expectWheelToPan(-60)
  await expect(audioPromptEditor).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(audioPromptEditor).not.toBeFocused()
  await expect(audioNode).toHaveClass(/selected/)
  await audioPromptEditor.hover()
  const blurredScroll = await audioPromptScroll()
  await expectWheelToPan(60)
  expect(await audioPromptScroll()).toBe(blurredScroll)

  await audioPromptEditor.press('ControlOrMeta+End')
  await audioPromptEditor.pressSequentially('@')
  const referenceMenu = page.getByRole('listbox', { name: '引用画布音频' })
  await expect(referenceMenu).toBeInViewport()
  expect(await referenceMenu.evaluate((element) => element.parentElement === document.body)).toBe(true)
  await referenceMenu.getByRole('option', { name: '参考旁白' }).click()
  await expect(audioPanel.getByTitle('参考旁白')).toBeVisible()
  await expect(referenceMenu).toBeHidden()

  const failureNode = page.locator('.react-flow__node[data-id="pan-failure-id"]')
  const detailsButton = failureNode.getByRole('button', { name: '查看详情' })
  await expect(detailsButton).toBeVisible()
  await detailsButton.click()
  const failureDialog = page.getByRole('dialog', { name: '生成失败详情' })
  await expect(failureDialog).toContainText('模拟失败')
  await expect(failureDialog).toContainText('request-pan-test')
  await failureDialog.locator('.ant-modal-close').click()
  await expect(failureDialog).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('canvas-text-wheel-pan.png') })
  expectNoUnexpectedApi(api)
})
