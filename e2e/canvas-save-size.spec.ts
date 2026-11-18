import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('较大的画布修改按请求体字节拆分并保存', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const nodes = ['one', 'two'].map((id, i) => ({
    id,
    type: 'text',
    position: { x: 120 + i * 400, y: 120 },
    data: { kind: 'text', text: `节点 ${id}`, params: { content: '画'.repeat(180000) } },
  }))
  await page.addInitScript((nodes) => {
    localStorage.setItem(
      'zzh_canvas_draft_u7_w21_p153',
      JSON.stringify({
        nodes,
        edges: [],
        textContents: {},
        boundCanvasId: 153,
        pendingSync: true,
        syncBaseline: { nodes: [], edges: [] },
        updatedAt: Date.now(),
      }),
    )
  }, nodes)
  let revision = 0
  const bodies: any[] = []
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/153**', (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postData() || ''
      bodies.push(JSON.parse(body))
      if (Buffer.byteLength(body, 'utf8') > 1024 * 1024)
        return route.fulfill({ status: 400, json: { code_string: 'CANVAS_INVALID_INPUT' } })
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 0, has_more: false }
        : { id: 153, title: '大画布保存', revision: 0 },
    })
  })
  await page.goto('/canvas/153')
  await expect(page.getByText('已保存到云端')).toBeVisible({ timeout: 20000 })
  expect(bodies).toHaveLength(2)
  expect(bodies.map((body) => body.base_revision)).toEqual([0, 1])
  expect(
    bodies
      .flatMap((body) => body.mutations)
      .map((item: any) => item.element_id)
      .sort(),
  ).toEqual(['one', 'two'])
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('zzh_canvas_draft_u7_w21_p153') || '{}').pendingSync),
    )
    .toBe(false)
  await page.screenshot({ path: testInfo.outputPath('large-canvas-saved.png') })
})

test('本机修改与云端内容相同但字段顺序不同时不提示冲突', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const baseline = {
    id: 'one',
    type: 'text',
    position: { x: 120, y: 120 },
    data: { kind: 'text', text: '旧内容', params: { a: 1, b: 2 } },
  }
  const local = { ...baseline, data: { ...baseline.data, text: '已保存的内容' } }
  await page.addInitScript(
    ({ baseline, local }) => {
      localStorage.setItem(
        'zzh_canvas_draft_u7_w21_p154',
        JSON.stringify({
          nodes: [local],
          edges: [],
          textContents: { one: '已保存的内容' },
          boundCanvasId: 154,
          pendingSync: true,
          syncBaseline: { nodes: [baseline], edges: [] },
          updatedAt: Date.now(),
        }),
      )
    },
    { baseline, local },
  )
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/154**', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 3 } })
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'one',
                kind: 'node',
                op: 'upsert',
                payload: { ...local, data: { ...local.data, params: { b: 2, a: 1 } } },
              },
            ],
            sync_revision: 2,
            has_more: false,
          }
        : { id: 154, title: '恢复相同内容', revision: 2 },
    })
  })
  await page.goto('/canvas/154')
  await expect(page.getByRole('alertdialog', { name: '恢复本机修改' })).toHaveCount(0)
  await expect(page.getByText('已保存到云端')).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('已保存的内容', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('identical-recovery.png') })
})
