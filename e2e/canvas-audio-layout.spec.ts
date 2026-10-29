import { expect, test } from '@playwright/test'
import {
  expectNoUnexpectedApi,
  installStrictAuthenticatedApp,
  waitForScopedApiResponse,
  WORKSPACE_ID,
} from './fixtures/strict-authenticated-app'

test('长音频模型名不覆盖用途和生成参数，费用与生成按钮独立成行', async ({ page }, testInfo) => {
  // WebKit 冷加载画布的大型懒加载分片与媒体模块较慢，只延长该浏览器的场景总预算。
  if (testInfo.project.name === 'webkit') test.slow()
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: [
        {
          id: 91,
          display_name: 'Seed TTS 2.0 超长模型名称用于验证底栏文字不会遮挡其他操作',
          operation_codes: ['audio.tts'],
          params_schema: {
            properties: {
              speaker: { type: 'string', default: 'voice-1', enum: ['voice-1', 'voice-2'] },
              speed: { type: 'number', default: 1, minimum: 0.5, maximum: 2 },
              enable_subtitle: { type: 'string', default: 'false' },
              sample_rate: { type: 'integer', default: 48000, enum: [24000, 48000] },
            },
          },
        },
        { id: 92, display_name: '音乐模型', operation_codes: ['audio.music'] },
      ],
    }),
  )
  await page.route('**/api/v1/canvases/116**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'audio-layout',
                kind: 'node',
                op: 'upsert',
                payload: {
                  id: 'audio-layout',
                  type: 'audio',
                  position: { x: 400, y: 180 },
                  style: { width: 320, height: 120 },
                  data: {
                    kind: 'audio',
                    modelVersionId: 91,
                    operationCode: 'audio.tts',
                    prompt: '测试文案',
                    params: { speed: 1 },
                  },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 116, title: 'Audio layout', status: 'active', revision: 1 },
    })
  })
  const ready = waitForScopedApiResponse(page, {
    method: 'GET',
    path: '/api/v1/canvases/116/elements',
    workspaceId: WORKSPACE_ID,
  })
  await page.goto('/canvas/116')
  await ready
  await expect(page.locator('.react-flow__node[data-id="audio-layout"]')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '复位视图', exact: true }).click()
  await expect(page.locator('.react-flow__node[data-id="audio-layout"] .canvas-node-header')).toBeInViewport()
  await page.locator('.react-flow__node[data-id="audio-layout"] .canvas-node-header').click()
  const model = page.getByRole('button', { name: '音频生成模型', exact: true })
  await expect(model).toBeEnabled()
  await expect(model).toContainText('配音')
  await model.click()
  await expect(page.getByRole('option', { name: /音乐模型/ })).toBeVisible()
  await page.keyboard.press('Escape')
  for (const scale of [1, 0.5]) {
    await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption(String(scale * 100))
    await expect
      .poll(() =>
        page
          .locator('.react-flow__viewport')
          .evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a),
      )
      .toBe(scale)
    // 同一帧读取所有控件，避免平移动画中分多次测量产生伪重叠。
    const {
      model: modelBox,
      parameters,
      cost,
      generate,
      prompt,
      count,
    } = await model.evaluate((element) => {
      const root = element.closest('.canvas-audio-generator')!
      const rect = (target: Element | null) => {
        if (!target) return null
        const { x, y, width, height } = target.getBoundingClientRect()
        return { x, y, width, height }
      }
      return {
        model: rect(element),
        parameters: rect(root.querySelector('[data-audio-section="parameters"]')),
        cost: rect(root.querySelector('[data-audio-section="cost-actions"]')),
        generate: rect(root.querySelector('[data-audio-action="generate"]')),
        prompt: rect(root.querySelector('textarea')),
        count: rect(root.querySelector('[aria-label="文案字数"]')),
      }
    })
    expect(modelBox).not.toBeNull()
    expect(parameters).not.toBeNull()
    expect(cost).not.toBeNull()
    expect(generate).not.toBeNull()
    expect(modelBox!.x + modelBox!.width).toBeLessThanOrEqual(parameters!.x + 1)
    expect(modelBox!.y + modelBox!.height).toBeLessThanOrEqual(cost!.y + 1)
    expect(parameters!.y + parameters!.height).toBeLessThanOrEqual(cost!.y + 1)
    expect(generate!.y + generate!.height).toBeLessThanOrEqual(cost!.y + 1)
    expect(count!.x).toBeGreaterThanOrEqual(prompt!.x)
    expect(count!.y).toBeGreaterThanOrEqual(prompt!.y)
    expect(count!.x + count!.width).toBeLessThanOrEqual(prompt!.x + prompt!.width)
    expect(count!.y + count!.height).toBeLessThanOrEqual(prompt!.y + prompt!.height)
  }
  await expect(page.getByText('预估费用', { exact: true })).toHaveCount(0)
  await page.getByRole('textbox', { name: '配音文案或音乐描述' }).fill('')
  await expect(page.locator('[data-audio-section="cost-actions"]')).toBeHidden()
  await expect(page.getByLabel('文案字数')).toHaveText('0 / 2000 字')
  await page.getByRole('button', { name: '生成参数', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '声音设置' })
  await expect(settings).toBeVisible()
  // 浮层应独立于 50% 的画布缩放，保持屏幕上可操作的 380px 宽度。
  const bounds = await settings.boundingBox()
  expect(bounds!.width).toBeGreaterThan(350)
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1000)
  await settings.getByText('高级设置', { exact: false }).click()
  await expect(settings.getByRole('switch', { name: '启用字幕' })).toHaveCount(0)
  await expect(settings.getByRole('option', { name: '48 kHz' })).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('audio-settings.png') })
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})
