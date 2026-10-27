import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 900]) {
  test(`音频多选收起面板，恢复单选保留输入 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const api = await installStrictAuthenticatedApp(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: [
          {
            id: 91,
            display_name: '音乐模型',
            operation_codes: ['audio.music'],
            params_schema: { properties: { duration: { type: 'integer', default: 10, minimum: 5, maximum: 30 } } },
          },
        ],
      }),
    )
    const elements = new Map(
      ['a', 'b', 'image'].map((id, index) => [
        id,
        {
          element_id: id,
          kind: 'node',
          op: 'upsert',
          payload: {
            id,
            type: id === 'image' ? 'image' : 'audio',
            position: { x: 200 + index * 400, y: 180 },
            style: { width: 300, height: 120 },
            data: {
              kind: id === 'image' ? 'image' : 'audio',
              title: id,
              ...(id === 'image' ? {} : { modelVersionId: 91, operationCode: 'audio.music', prompt: '原始音乐描述' }),
            },
          },
        },
      ]),
    )
    let revision = 1
    await page.route('**/api/v1/canvases/147**', async (route) => {
      if (route.request().method() === 'PATCH') {
        for (const item of route.request().postDataJSON().mutations || []) {
          if (item.op === 'delete') elements.delete(item.element_id)
          else elements.set(item.element_id, item)
        }
        return route.fulfill({ json: { sync_revision: ++revision } })
      }
      const url = new URL(route.request().url())
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [...elements.values()],
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 147, title: '音频多选面板验证', status: 'active', revision },
      })
    })
    await page.goto('/canvas/147')
    const a = page.locator('.react-flow__node[data-id="a"]')
    const b = page.locator('.react-flow__node[data-id="b"]')
    const image = page.locator('.react-flow__node[data-id="image"]')
    const panels = page.locator('.canvas-audio-panel:visible')
    const prompt = page.getByRole('textbox', { name: '配音文案或音乐描述' })
    await expect(a).toBeVisible()
    await a.locator('.canvas-node-header').click()
    await expect(panels).toHaveCount(1)
    await prompt.fill('多选后应保留的音乐描述')
    await a.getByRole('button', { name: '生成参数', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '声音设置' })).toBeVisible()
    // Ctrl 多选时也应关闭 Portal 中的声音设置，不能仅隐藏节点内的 DOM。
    await b.locator('.canvas-node-header').click({ modifiers: ['Control'] })
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
    await expect(panels).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '声音设置' })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('audio-multiple-hidden.png') })
    await a.locator('.canvas-node-header').click()
    await expect(panels).toHaveCount(1)
    await expect(prompt).toHaveValue('多选后应保留的音乐描述')
    await image.locator('.canvas-node-header').click({ modifiers: ['Control'] })
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
    await expect(panels).toHaveCount(0)
    await expect(page.locator('[data-canvas-node-panel]:visible')).toHaveCount(0)
    // 全选使用真实键盘入口。
    await page.locator('.canvas-view').focus()
    await page.keyboard.press('Control+a')
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(3)
    await expect(panels).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
    const ab = await a.boundingBox()
    const bb = await b.boundingBox()
    if (!ab || !bb) throw new Error('音频节点位置缺失')
    // 从空白处真实拖出选框，覆盖两个音频节点。
    await page.mouse.move(ab.x - 12, ab.y - 60)
    await page.mouse.down()
    await page.mouse.move(bb.x + bb.width + 10, bb.y + bb.height + 10, { steps: 15 })
    await page.mouse.up()
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
    await expect(panels).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('audio-box-selection.png') })
    await b.locator('.canvas-node-header').click()
    await expect(panels).toHaveCount(1)
    await expect(prompt).toHaveValue('原始音乐描述')
    await a.locator('.canvas-node-header').click()
    await expect(prompt).toHaveValue('多选后应保留的音乐描述')
    await page.screenshot({ path: testInfo.outputPath('audio-single-restored.png') })
    expect(errors).toEqual([])
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
