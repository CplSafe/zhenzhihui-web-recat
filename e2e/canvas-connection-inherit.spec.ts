import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('图片和视频节点连线继承模型与参数并保存', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) => {
    const op = new URL(route.request().url()).searchParams.get('operation_code') || ''
    const video = op === 'video.generate'
    const image = op.startsWith('image.')
    return route.fulfill({
      json: {
        items:
          video || image
            ? [
                {
                  id: video ? 52 : 42,
                  display_name: video ? '来源视频模型' : '来源图片模型',
                  capability: video ? 'video' : 'image',
                  operation_codes: [op],
                  input_constraints: { [op]: { roles: [{ role: video ? 'video' : 'reference_image', max_count: 5 }] } },
                  params_schema: {
                    fields: [
                      { name: 'duration', display_name: '时长', options: [5, 8], default: 5 },
                      { name: 'resolution', display_name: '分辨率', options: ['2K', '1080p'], default: '2K' },
                    ],
                  },
                },
                {
                  id: video ? 53 : 43,
                  display_name: '目标模型',
                  capability: video ? 'video' : 'image',
                  operation_codes: [op],
                },
              ]
            : [],
      },
    })
  })
  const items = [
    {
      id: 'image-source',
      kind: 'image',
      x: 50,
      y: 50,
      modelVersionId: 42,
      params: { resolution: '2K', count: 2 },
      ratio: '4:3',
    },
    { id: 'image-target', kind: 'image', x: 550, y: 50, modelVersionId: 43, params: { count: 1 }, ratio: '1:1' },
    {
      id: 'video-source',
      kind: 'video',
      x: 50,
      y: 450,
      modelVersionId: 52,
      params: { duration: 8, resolution: '1080p' },
      ratio: '16:9',
      videoMode: 'full-ref',
    },
    { id: 'video-target', kind: 'video', x: 550, y: 450, modelVersionId: 53, params: { duration: 5 }, ratio: '9:16' },
  ]
  const elements = new Map(
    items.map(({ id, kind, x, y, ...data }) => [
      id,
      {
        element_id: id,
        kind: 'node',
        op: 'upsert',
        payload: { id, type: kind, position: { x, y }, style: { width: 220, height: 180 }, data: { kind, ...data } },
      },
    ]),
  )
  let revision = 1
  await page.route('**/api/v1/canvases/987**', async (route) => {
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
        : { id: 987, title: '连线继承配置', status: 'active', revision },
    })
  })
  await page.goto('/canvas/987')
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  async function connect(source: string, target: string) {
    const node = page.locator(`.react-flow__node[data-id="${source}"]`)
    await node.hover()
    await node.locator('.canvas-handle-icon--right').dragTo(page.locator(`.react-flow__node[data-id="${target}"]`))
  }
  await connect('image-source', 'image-target')
  await expect
    .poll(() => elements.get('image-target')?.payload.data)
    .toMatchObject({ modelVersionId: 42, params: { resolution: '2K', count: 2 }, ratio: '4:3' })
  await connect('video-source', 'video-target')
  await expect
    .poll(() => elements.get('video-target')?.payload.data)
    .toMatchObject({
      modelVersionId: 52,
      params: { duration: 8, resolution: '1080p' },
      ratio: '16:9',
      videoMode: 'full-ref',
    })
  await page.locator('.react-flow__node[data-id="video-target"]').click()
  await expect(page.getByText('来源视频模型', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('inherited-config.png') })
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
