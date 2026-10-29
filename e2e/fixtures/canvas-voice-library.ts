import { expect, type Page } from '@playwright/test'
import { installStrictAuthenticatedApp } from './strict-authenticated-app'

export const voices = Array.from({ length: 45 }, (_, index) => ({
  id: index + 1,
  name: `公共旁白 ${String(index + 1).padStart(2, '0')}`,
  source: 'public',
  status: 'ready',
  language: index % 2 ? 'en' : 'zh',
  provider: index % 2 ? 'minimax' : 'volcengine-speech',
  tags: [index % 2 ? '清亮' : '温柔'],
}))

export async function setupVoiceLibrary(page: Page, failFilters = false) {
  const catalog = [
    ...voices.map((voice) => ({ ...voice, is_favorite: false })),
    { ...voices[0], id: 901, name: '我的旁白', source: 'cloned', workspace_id: 21, is_favorite: false },
  ]
  const state = await installStrictAuthenticatedApp(page)
  const requests: URL[] = []
  const createRequests: Record<string, unknown>[] = []
  const errors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/v1/ai/tools**', (route) => {
    expect(route.request().method()).toBe('GET')
    expect(new URL(route.request().url()).searchParams.get('workspace_id')).toBe('21')
    return route.fulfill({ json: { code: 0, data: [] } })
  })
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({ json: [{ id: 91, display_name: '配音模型', operation_codes: ['audio.tts'] }] }),
  )
  await page.route('**/api/v1/voices**', async (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    expect(url.searchParams.get('workspace_id')).toBe('21')
    if (route.request().method() === 'POST' && url.pathname === '/api/v1/voices') {
      const input = route.request().postDataJSON() as Record<string, unknown>
      createRequests.push(input)
      expect(input).toMatchObject({ workspace_id: 21, sample_asset_id: 55, consent_confirmed: true })
      expect(input.idempotency_key).toEqual(expect.any(String))
      const created = { ...catalog[catalog.length - 1], id: 902, name: String(input.name), status: 'training' }
      catalog.push(created)
      return route.fulfill({ json: { code: 0, data: created } })
    }
    const favoriteId = url.pathname.match(/^\/api\/v1\/voices\/(\d+)\/favorite$/)?.[1]
    if (favoriteId) {
      expect(['PUT', 'DELETE']).toContain(route.request().method())
      const voice = catalog.find((voice) => voice.id === Number(favoriteId))!
      voice.is_favorite = route.request().method() === 'PUT'
      return route.fulfill({ json: { code: 0, data: null } })
    }
    expect(route.request().method()).toBe('GET')
    const voiceId = url.pathname.match(/^\/api\/v1\/voices\/(\d+)$/)?.[1]
    if (voiceId) return route.fulfill({ json: catalog.find((voice) => voice.id === Number(voiceId)) })
    if (url.searchParams.get('favorites') === 'true') expect(url.searchParams.has('source')).toBe(false)
    else expect(['public', 'cloned']).toContain(url.searchParams.get('source'))
    if (createRequests.length && url.searchParams.get('source') === 'cloned') {
      expect(url.searchParams.has('model_version_id')).toBe(false)
    } else expect(url.searchParams.get('model_version_id')).toBe('91')
    if (url.pathname.endsWith('/filters')) {
      expect(url.searchParams.has('limit')).toBe(false)
      if (failFilters) {
        failFilters = false
        return route.fulfill({ status: 503, json: { code: 503, message: '筛选服务暂不可用' } })
      }
      return route.fulfill({
        json: {
          languages: ['zh', 'en'],
          providers: ['minimax', 'volcengine-speech'],
          voice_features: ['温柔', '清亮'],
        },
      })
    }
    expect(url.pathname).toBe('/api/v1/voices')
    const q = url.searchParams.get('q') || ''
    const features = url.searchParams.getAll('voice_feature')
    const filtered = catalog.filter(
      (voice) =>
        voice.name.includes(q) &&
        (!url.searchParams.get('source') || voice.source === url.searchParams.get('source')) &&
        (url.searchParams.get('favorites') !== 'true' || voice.is_favorite) &&
        (!url.searchParams.get('language') || voice.language === url.searchParams.get('language')) &&
        (!url.searchParams.get('provider') || voice.provider === url.searchParams.get('provider')) &&
        (!features.length || features.some((feature) => voice.tags.includes(feature))),
    )
    const offset = Number(url.searchParams.get('offset'))
    const limit = Number(url.searchParams.get('limit'))
    return route.fulfill({ json: { items: filtered.slice(offset, offset + limit), total: filtered.length } })
  })
  let revision = 1
  await page.route('**/api/v1/canvases/121**', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: ++revision } })
    const url = new URL(route.request().url())
    // 增量轮询只能返回新变更，不能重复下发初始节点把用户刚选的模型/音色覆盖掉。
    if (url.pathname.endsWith('/elements') && Number(url.searchParams.get('after_revision')) > 0)
      return route.fulfill({
        json: { elements: [], sync_revision: revision, history_floor_revision: 0, has_more: false },
      })
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'audio',
                kind: 'node',
                op: 'upsert',
                payload: {
                  id: 'audio',
                  type: 'audio',
                  position: { x: 350, y: 120 },
                  style: { width: 320, height: 120 },
                  data: { kind: 'audio', modelVersionId: 91, operationCode: 'audio.tts', prompt: '' },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 121, title: '音色筛选验证', status: 'active', revision: 1 },
    })
  })
  await page.goto('/canvas/121')
  await page.locator('.react-flow__node[data-id="audio"] .canvas-node-header').click()
  // 自动适配不应把单个节点过度放大，音频面板仍需可操作；手动缩放另有专项覆盖。
  await expect
    .poll(async () => Number(await page.getByRole('combobox', { name: '画布缩放' }).inputValue()))
    .toBeLessThanOrEqual(100)
  await page.getByRole('button', { name: '音色库', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '音色库', exact: true })
  await expect(modal).toBeVisible()
  return { modal, requests, createRequests, errors, consoleErrors, state }
}
