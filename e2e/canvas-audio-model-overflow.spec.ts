import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('音频模型浮层脱离裁切并保持键盘操作', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
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
  await page.goto('/canvas/116')
  await page.locator('.react-flow__node[data-id="audio-layout"]').click()
  const model = page.getByRole('button', { name: '音频生成模型', exact: true })
  await model.click()
  const modelMenu = page.getByRole('listbox', { name: '音频生成模型列表' })
  await expect(modelMenu).toBeVisible()
  await expect(modelMenu.getByRole('option').first()).toContainText('适合视频解说、产品介绍和日常内容配音。')
  expect(await modelMenu.evaluate((element) => element.closest('.canvas-audio-panel') === null)).toBe(true)
  await model.press('ArrowDown')
  await expect(modelMenu.getByRole('option').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(modelMenu.getByRole('option').last()).toBeFocused()
  await page.screenshot({ path: 'test-results/audio-model-menu.png' })
  await page.keyboard.press('Escape')
  await expect(modelMenu).toBeHidden()
  await expect(model).toBeFocused()
  await page.setViewportSize({ width: 760, height: 640 })
  await model.click()
  await expect(modelMenu).toBeVisible()
  await expect(async () => {
    const bounds = (await modelMenu.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(12)
    expect(bounds.y).toBeGreaterThanOrEqual(12)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(748)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(628)
  }).toPass()
  await page.screenshot({ path: 'test-results/audio-model-menu-narrow.png' })
  await page.getByText('帧智汇', { exact: true }).click()
  await expect(modelMenu).toBeHidden()
})
