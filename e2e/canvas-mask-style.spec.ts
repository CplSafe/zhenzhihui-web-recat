import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`蒙版上传区域 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: 27,
              provider: 'openai',
              version: 'gpt-image-2',
              capability: 'image',
              enabled: true,
              display_name: 'GPT Image',
              operation_codes: ['image.text_to_image', 'image.image_to_image'],
              input_constraints: {
                'image.image_to_image': { roles: [{ role: 'reference_image', min_count: 1, max_count: 3 }] },
              },
            },
          ],
        },
      }),
    )
    const nodes = [
      {
        element_id: 'image-edit',
        kind: 'node',
        op: 'upsert',
        payload: {
          id: 'image-edit',
          type: 'image',
          position: { x: 180, y: 100 },
          style: { width: 250, height: 250 },
          data: { kind: 'image', prompt: '测试蒙版', modelVersionId: 27 },
        },
      },
      {
        element_id: 'source',
        kind: 'node',
        op: 'upsert',
        payload: {
          id: 'source',
          type: 'image',
          position: { x: -140, y: 100 },
          style: { width: 200, height: 200 },
          data: { kind: 'image', assetId: 12391, workspaceId: WORKSPACE_ID },
        },
      },
      {
        element_id: 'edge',
        kind: 'edge',
        op: 'upsert',
        payload: {
          id: 'edge',
          source: 'source',
          target: 'image-edit',
          sourceHandle: 'source-right-source',
          targetHandle: 'image-edit-left-target',
        },
      },
    ]
    await page.route('**/api/v1/canvases/108**', (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { revision: 2 } })
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : nodes,
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 108, title: '蒙版测试', revision: 1 },
      })
    })
    await page.route('**/api/v1/assets', (route) =>
      route.fulfill({
        json: {
          data: {
            asset: { id: 702 },
            upload: { url: new URL('/api/v1/mock-mask-upload', route.request().url()).href, form_fields: {} },
          },
        },
      }),
    )
    await page.route('**/api/v1/mock-mask-upload', (route) => route.fulfill({ status: 204 }))
    await page.route('**/api/v1/assets/702/complete?**', (route) =>
      route.fulfill({ json: { data: { id: 702, status: 'ready' } } }),
    )
    await page.route('**/api/v1/assets/702/download?**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    )
    await page.goto('/canvas/108')
    await page.locator('.react-flow__node[data-id="image-edit"] .canvas-node-header').click()
    const input = page.getByLabel('上传编辑蒙版')
    await expect(input).toBeAttached()
    await expect(page.getByText('上传 PNG', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`mask-empty-${width}.png`), fullPage: true })
    await input.setInputFiles({
      name: 'mask.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=',
        'base64',
      ),
    })
    await expect(page.getByText('已上传蒙版')).toBeVisible()
    await expect(page.getByText('更换蒙版', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`mask-uploaded-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '移除蒙版' }).click()
    await expect(page.getByText('已上传蒙版')).toHaveCount(0)
    await expect(page.getByText('上传 PNG', { exact: true })).toBeVisible()
  })
}
