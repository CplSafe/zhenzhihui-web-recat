import { expect, test, type Page } from '@playwright/test'
import { setupVoiceLibrary } from './fixtures/canvas-voice-library'
import { expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

async function installVoiceModel(page: Page) {
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: [
        {
          id: 91,
          display_name: 'MiniMax 配音模型',
          operation_codes: ['audio.tts'],
          params_schema: { type: 'object', required: ['voice_id'], properties: { voice_id: { type: 'integer' } } },
        },
      ],
    }),
  )
}

for (const emptyInitially of [false, true]) {
  test(`音频自动选择兼容系统音色，可更换且无需上传${emptyInitially ? '，空列表可重试' : ''}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const { modal, state, errors, consoleErrors } = await setupVoiceLibrary(page)
    await modal.getByRole('button', { name: '关闭', exact: true }).click()
    await installVoiceModel(page)
    let empty = emptyInitially
    let defaultQueries = 0
    await page.route('**/api/v1/voices?**', (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('limit') !== '100') return route.fallback()
      expect(url.searchParams.get('model_version_id')).toBe('91')
      expect(url.searchParams.get('workspace_id')).toBe('21')
      expect(url.searchParams.get('source')).toBe('public')
      defaultQueries++
      return route.fulfill({
        json: {
          items: empty
            ? []
            : [
                { id: 1, name: '不可用声音', source: 'public', status: 'training' },
                { id: 2, name: '公共旁白 02', source: 'public', status: 'ready' },
              ],
          total: empty ? 0 : 2,
        },
      })
    })
    const estimates: number[] = []
    await page.route('**/api/v1/ai/tasks/estimate-cost', (route) => {
      estimates.push(route.request().postDataJSON().params.voice_id)
      return route.fulfill({ json: { estimated_cost: 100, can_afford: true } })
    })
    await page.reload()
    await page.locator('.react-flow__node[data-id="audio"] .canvas-node-header').click()
    const generator = page.locator('.canvas-audio-generator')
    await generator.locator('textarea').fill('测试配音文案')
    if (emptyInitially) {
      await expect(generator).toContainText('当前模型暂无可用的系统音色')
      await generator.getByRole('button', { name: '生成音频', exact: true }).click()
      expect(estimates).toEqual([])
      expect(state.paidTaskSubmissions).toBe(0)
      empty = false
      await generator.getByRole('button', { name: '重试默认音色' }).click()
    }
    await expect(generator).toContainText('公共旁白 02')
    await expect.poll(() => estimates.length).toBeGreaterThan(0)
    expect(estimates.every((id) => id === 2)).toBe(true)
    await expect(generator.getByRole('alert')).toHaveCount(0)
    await generator.screenshot({ path: testInfo.outputPath('default-voice.png') })
    const queriesBeforeManual = defaultQueries
    await page.getByRole('button', { name: '音色库', exact: true }).click()
    await modal.getByRole('button', { name: '我的音色', exact: true }).click()
    await modal.locator('article').getByRole('button', { name: '选用', exact: true }).click()
    await expect(generator).toContainText('我的旁白')
    await expect.poll(() => estimates.at(-1)).toBe(901)
    expect(defaultQueries).toBe(queriesBeforeManual)
    const submissions: any[] = []
    await page.route('**/api/v1/ai/tasks', (route) => {
      submissions.push(route.request().postDataJSON())
      return route.fulfill({ json: { id: 71, status: 'pending' } })
    })
    await page.route('**/api/v1/ai/tasks/71**', (route) => route.fulfill({ json: { id: 71, status: 'pending' } }))
    await generator.getByRole('button', { name: '生成音频', exact: true }).click()
    await expect.poll(() => submissions.length).toBe(1)
    expect(submissions[0]).toMatchObject({ params: { voice_id: 901 } })
    expect(submissions[0].input_assets || []).toEqual([])
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
    expectNoUnexpectedApi(state)
  })
}
