import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('提示词中的 @图片和 @视频均显示引用缩略图并可预览原素材', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/real-people?**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/231**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'ref-image',
                kind: 'node',
                payload: {
                  id: 'ref-image',
                  type: 'image',
                  position: { x: 80, y: 120 },
                  style: { width: 240, height: 180 },
                  data: {
                    kind: 'image',
                    title: '产品参考图',
                    assetId: 901,
                    assetWorkspaceId: 21,
                    resultUrl:
                      'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22600%22 height=%22400%22%3E%3Crect width=%22600%22 height=%22400%22 fill=%22%23087f68%22/%3E%3C/svg%3E',
                  },
                },
              },
              {
                element_id: 'ref-video',
                kind: 'node',
                payload: {
                  id: 'ref-video',
                  type: 'video',
                  position: { x: 80, y: 380 },
                  style: { width: 240, height: 180 },
                  data: {
                    kind: 'video',
                    title: '动作参考视频',
                    assetId: 902,
                    assetWorkspaceId: 21,
                    posterAssetId: 903,
                    resultUrl: '/tutorials/canvas.mp4',
                  },
                },
              },
              {
                element_id: 'unconnected-image',
                kind: 'node',
                payload: {
                  id: 'unconnected-image',
                  type: 'image',
                  position: { x: 900, y: 120 },
                  data: {
                    kind: 'image',
                    title: '未连线图片',
                    resultUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E',
                  },
                },
              },
              {
                element_id: 'prompt-image',
                kind: 'node',
                payload: {
                  id: 'prompt-image',
                  type: 'image',
                  position: { x: 440, y: 120 },
                  style: { width: 320, height: 220 },
                  data: {
                    kind: 'image',
                    prompt: '参考动作 @视频1，主视觉参考 @产品参考图，柔和自然光。',
                    sourceRefs: [
                      {
                        kind: 'image',
                        sourceId: 'ref-image',
                        edgeId: 'ref-edge',
                        slotIndex: 0,
                        title: '产品参考图',
                        assetId: 901,
                        workspaceId: 21,
                      },
                      {
                        kind: 'video',
                        sourceId: 'ref-video',
                        edgeId: 'video-edge',
                        slotIndex: 1,
                        title: '动作参考视频',
                        assetId: 902,
                        workspaceId: 21,
                        posterUrl: '/api/v1/assets/903/download?workspace_id=21',
                      },
                    ],
                  },
                },
              },
              {
                element_id: 'ref-edge',
                kind: 'edge',
                payload: {
                  id: 'ref-edge',
                  source: 'ref-image',
                  target: 'prompt-image',
                  sourceHandle: 'ref-image-right-source',
                  targetHandle: 'prompt-image-left-target',
                  data: { slotIndex: 0 },
                },
              },
              {
                element_id: 'video-edge',
                kind: 'edge',
                payload: {
                  id: 'video-edge',
                  source: 'ref-video',
                  target: 'prompt-image',
                  sourceHandle: 'ref-video-right-source',
                  targetHandle: 'prompt-image-left-target',
                  data: { slotIndex: 1 },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 231, title: '图片引用预览', status: 'active', revision: 1 },
    })
  })
  await page.route('**/api/v1/assets/901**', (route) => route.fulfill({ status: 404, json: {} }))
  await page.route('**/api/v1/assets/903**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#635bce"/><circle cx="300" cy="200" r="90" fill="#f6d8ba"/></svg>',
    }),
  )
  // 该视频节点会在加载后尝试补传首帧封面；此流程只验证预览展示，不保存测试素材。
  await page.route('**/api/v1/assets', (route) => route.fulfill({ status: 503, json: { message: '测试不保存封面' } }))
  await page.goto('/canvas/231')
  const imageNode = page.locator('.react-flow__node[data-id="prompt-image"]')
  await expect(imageNode).toBeVisible()
  await imageNode.click({ position: { x: 30, y: 50 } })
  const panel = page.locator('[data-canvas-node-panel]')
  const imageRef = panel.getByTitle('点击预览素材，点击名称插入引用').filter({ hasText: '@产品参考图' })
  const videoRef = panel.getByTitle('点击预览素材，点击名称插入引用').filter({ hasText: '@动作参考视频' })
  await imageRef.click({ position: { x: 8, y: 8 } })
  const refPreview = page.getByRole('dialog', { name: '图片预览' })
  await expect(refPreview).toBeVisible()
  await expect(refPreview.getByRole('button', { name: '下一张图片' })).toHaveCount(0)
  await expect(refPreview.getByText('未连线图片')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('canvas-reference-preview.png') })
  await page.keyboard.press('Escape')
  await videoRef.click({ position: { x: 8, y: 8 } })
  await expect(page.getByRole('dialog', { name: '视频预览' })).toBeVisible()
  await page.keyboard.press('Escape')
  await imageRef.getByRole('button', { name: '@产品参考图' }).click()
  await expect(panel.getByPlaceholder(/描述你想要生成/)).toHaveAttribute('data-value', /@产品参考图/)
  await videoRef.getByRole('button', { name: '@动作参考视频' }).click()
  await expect(panel.getByPlaceholder(/描述你想要生成/)).toHaveAttribute('data-value', /@动作参考视频/)
  await panel.getByTitle('放大输入框').click()
  const editor = page.getByRole('dialog', { name: '编辑提示词' })
  const input = editor.getByPlaceholder(/描述你想要生成/)
  const placeholderContent = () => input.evaluate((element) => getComputedStyle(element, '::before').content)
  await input.fill('')
  await expect(input).toHaveAttribute('data-empty', 'true')
  await expect.poll(placeholderContent).toContain('描述你想要生成')
  const expectEmptyCaretAtStart = async () => {
    await expect(input).toBeFocused()
    await expect
      .poll(() =>
        input.evaluate((element) => {
          const selection = window.getSelection()!
          const range = selection.getRangeAt(0)
          const prefix = range.cloneRange()
          prefix.selectNodeContents(element)
          prefix.setEnd(range.startContainer, range.startOffset)
          const marker = element.querySelector('[data-caret-end]')!.getBoundingClientRect()
          const bounds = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          const scale = bounds.height / (element as HTMLElement).offsetHeight
          const lineHeight = Number.parseFloat(style.lineHeight) * scale
          const insetX = Number.parseFloat(style.paddingLeft) * scale
          const insetY = Number.parseFloat(style.paddingTop) * scale
          return {
            collapsed: range.collapsed,
            prefix: prefix.toString(),
            atStart:
              Math.abs(marker.left - bounds.left - insetX) < 2 &&
              marker.top >= bounds.top + insetY - 1 &&
              marker.top < bounds.top + insetY + lineHeight,
          }
        }),
      )
      .toEqual({ collapsed: true, prefix: '', atStart: true })
  }
  await input.blur()
  await input.focus()
  await expectEmptyCaretAtStart()
  await input.click({ position: { x: 240, y: 8 } })
  await expectEmptyCaretAtStart()
  await page.screenshot({ path: testInfo.outputPath('canvas-empty-caret-start.png'), caret: 'initial' })
  await input.pressSequentially('普通文字')
  await expect(input).toHaveAttribute('data-empty', 'false')
  await expect.poll(placeholderContent).toBe('none')
  // CDP IME composition exercises the browser's native composition events,
  // including the preedit text that ordinary keyboard typing does not produce.
  await input.fill('')
  await input.focus()
  let previousY = Number.NaN
  let stableFrames = 0
  await expect
    .poll(
      async () => {
        const y = (await input.boundingBox())?.y
        stableFrames = y === previousY ? stableFrames + 1 : 0
        previousY = y ?? Number.NaN
        return stableFrames
      },
      { timeout: 30000 },
    )
    .toBeGreaterThanOrEqual(3)
  const editorBounds = await input.boundingBox()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'zhong', selectionStart: 5, selectionEnd: 5 })
  await expect(input).toContainText('zhong')
  expect(await input.boundingBox()).toEqual(editorBounds)
  await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 })
  await expect(input).toContainText('中文')
  expect(await input.boundingBox()).toEqual(editorBounds)
  await cdp.send('Input.insertText', { text: '中文' })
  await expect(input).toHaveAttribute('data-value', '中文')
  await expect(input).toBeFocused()
  expect(await input.boundingBox()).toEqual(editorBounds)
  await input.pressSequentially('继续')
  await expect(input).toHaveAttribute('data-value', '中文继续')
  await page.screenshot({ path: testInfo.outputPath('canvas-ime-composition.png'), caret: 'initial' })
  await cdp.detach()
  await input.blur()
  await expect.poll(placeholderContent).toBe('none')
  await page.screenshot({ path: testInfo.outputPath('canvas-placeholder-text.png') })
  await input.fill('@图片1')
  await expect(input.getByRole('button', { name: '查看引用图片：图片1' })).toBeVisible()
  await expect.poll(placeholderContent).toBe('none')
  await input.fill('参考动作 @视频1，主视觉参考 @图片1，柔和自然光。')
  await expect.poll(placeholderContent).toBe('none')
  // 编辑和失焦均显示原子引用标签，光标与标签处在同一排版层。
  await expect(editor.locator('[data-prompt-editing]')).toHaveAttribute('data-prompt-editing', 'true')
  await expect
    .poll(() => input.evaluate((element) => getComputedStyle(element).caretColor))
    .toBe(await input.evaluate((element) => getComputedStyle(element).color))
  await expect(input.getByRole('button', { name: '查看引用视频：视频1' })).toBeVisible()
  await expect(input.getByRole('button', { name: '查看引用视频：视频1' })).toContainText('@视频1')
  await page.screenshot({ path: testInfo.outputPath('canvas-mention-editing.png'), caret: 'initial' })
  await input.blur()
  const videoMention = editor.getByRole('button', { name: '查看引用视频：视频1' })
  await expect(videoMention).toBeVisible()
  await expect(videoMention.locator('img')).toBeVisible()
  await expect(videoMention).toContainText('视频1')
  await expect(videoMention.locator('img')).toHaveCSS('width', '30px')
  const mention = editor.getByRole('button', { name: '查看引用图片：图片1' })
  await expect(mention).toBeVisible()
  await expect(mention.locator('img')).toBeVisible()
  await expect(mention).toContainText('图片1')
  const mentionSize = await mention.evaluate((button) => {
    const rect = button.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  expect(mentionSize.height).toBeLessThanOrEqual(34)
  expect(mention.locator('img')).toHaveCSS('width', '30px')
  const imageBeforeLabel = await mention.evaluate((button) => {
    const image = button.querySelector('img')!
    const range = document.createRange()
    range.selectNodeContents(button.lastChild!)
    return image.getBoundingClientRect().right <= range.getBoundingClientRect().left
  })
  expect(imageBeforeLabel).toBe(true)
  await mention.click()
  const preview = page.getByRole('dialog', { name: '图片预览' })
  await expect(preview).toBeVisible()
  await expect(preview.getByText('产品参考图', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('canvas-mention-image-preview.png') })
  await preview.getByRole('button', { name: '关闭图片预览' }).click()
  await expect(preview).toHaveCount(0)
  await expect(input).toHaveAttribute('data-value', '参考动作 @视频1，主视觉参考 @图片1，柔和自然光。')
  await input.fill('')
  await input.pressSequentially('@')
  const candidate = page
    .getByRole('listbox', { name: '选择要 @ 的参考素材' })
    .getByRole('option', { name: /@动作参考视频$/ })
  await candidate.click()
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('data-value', '@动作参考视频 ')
  await expect.poll(placeholderContent).toBe('none')
  const caretOffset = () =>
    input.evaluate((element) => {
      const selection = window.getSelection()!
      const range = document.createRange()
      range.selectNodeContents(element)
      range.setEnd(selection.focusNode!, selection.focusOffset)
      const read = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
        if (node instanceof HTMLElement && node.hasAttribute('data-mention')) return node.dataset.mention || ''
        if (node instanceof HTMLElement && node.hasAttribute('data-caret-end')) return ''
        return Array.from(node.childNodes).map(read).join('')
      }
      return read(range.cloneContents()).length
    })
  expect(await caretOffset()).toBe(8)
  await expect(input.getByRole('button', { name: '查看引用视频：动作参考视频' })).toContainText('@动作参考视频')
  await input.evaluate((element) => {
    ;(element as HTMLElement & { originalMention?: Element }).originalMention = element.querySelector('[data-mention]')!
  })
  await input.pressSequentially('继续描述')
  await expect(input).toHaveAttribute('data-value', '@动作参考视频 继续描述')
  expect(await caretOffset()).toBe(12)
  expect(
    await input.evaluate(
      (element) =>
        (element as HTMLElement & { originalMention?: Element }).originalMention ===
        element.querySelector('[data-mention]'),
    ),
  ).toBe(true)
  await input.press('ArrowLeft')
  await input.pressSequentially('新')
  await expect(input).toHaveAttribute('data-value', '@动作参考视频 继续描新述')
  expect(await caretOffset()).toBe(12)
  await page.screenshot({ path: testInfo.outputPath('canvas-mention-caret.png'), caret: 'initial' })
  await page.setViewportSize({ width: 900, height: 700 })
  await input.focus()
  await expect
    .poll(() => input.evaluate((element) => getComputedStyle(element).caretColor))
    .toBe(await input.evaluate((element) => getComputedStyle(element).color))
  await input.press('End')
  await input.pressSequentially('。')
  await expect(input).toHaveAttribute('data-value', '@动作参考视频 继续描新述。')
  expect(await caretOffset()).toBe(14)
  await page.screenshot({ path: testInfo.outputPath('canvas-mention-caret-narrow.png'), caret: 'initial' })
  await input.fill('')
  await input.pressSequentially('@')
  await candidate.click()
  await expect(input).toHaveAttribute('data-value', '@动作参考视频 ')
  await input.press('Backspace')
  await expect(input).toHaveAttribute('data-value', '@动作参考视频')
  await expect(input.getByRole('button', { name: '查看引用视频：动作参考视频' })).toBeVisible()
  await input.press('Backspace')
  await expect(input).toHaveAttribute('data-value', '')
  await expect(input).toHaveAttribute('data-empty', 'true')
  await expect.poll(placeholderContent).toContain('描述你想要生成')
  await input.click({ position: { x: 240, y: 8 } })
  await expectEmptyCaretAtStart()
  await page.screenshot({ path: testInfo.outputPath('canvas-placeholder-empty-narrow.png'), caret: 'initial' })
  await input.press('Control+z')
  await expect(input).toHaveAttribute('data-value', '@动作参考视频')
  await expect.poll(placeholderContent).toBe('none')
  // 放大窗口提供与普通面板相同的素材入口；选画布素材期间让出遮罩，返回后保留编辑。
  await input.fill('')
  await editor.getByRole('button', { name: '@引用素材' }).click()
  const picker = page.getByRole('listbox', { name: '选择要 @ 的参考素材' })
  await expect(picker).toBeVisible()
  await picker.getByRole('option', { name: /@产品参考图$/ }).click()
  await expect(input).toHaveAttribute('data-value', '@产品参考图 ')
  await editor.getByTitle('插入 @动作参考视频').click()
  await expect(input).toHaveAttribute('data-value', '@产品参考图 @动作参考视频 ')
  await input.fill('')
  await editor.getByRole('button', { name: '@引用素材' }).click()
  await picker.getByRole('button', { name: '从画布选择' }).click()
  await expect(editor).toBeHidden()
  await page.locator('.react-flow__node[data-id="unconnected-image"]').click()
  await expect(editor).toBeVisible()
  await expect(input).toHaveAttribute('data-value', /@未连线图片/)
  await input.pressSequentially('继续编辑')
  await expect(input).toHaveAttribute('data-value', /继续编辑/)
  await page.screenshot({ path: testInfo.outputPath('canvas-expanded-reference-tools.png') })
  await editor.getByTitle('添加参考素材').click()
  await page.getByRole('menuitem', { name: '从素材库选择' }).click()
  const libraryItem = page.getByRole('checkbox').first()
  await expect(libraryItem).toBeVisible()
  await libraryItem.click()
  await page.getByRole('button', { name: '添加 1 个参考' }).click()
  await expect(editor).toBeVisible()
  await expect(input).toHaveAttribute('data-value', /继续编辑/)
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
