import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('图片节点工具栏隐藏反推提示词入口', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/v1/billing/plans', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data: [] }) }),
  )
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: [{ id: 9341, enabled: true, display_name: 'E2E 视觉模型', operation_codes: ['responses.multimodal'] }],
    }),
  )
  await page.route('**/api/v1/assets/991/download**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
  await page.route('**/api/v1/canvases/158**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements:
              Number(url.searchParams.get('after_revision') || 0) > 0
                ? []
                : [
                    {
                      element_id: 'image-source',
                      kind: 'node',
                      payload: {
                        id: 'image-source',
                        type: 'image',
                        position: { x: 220, y: 200 },
                        style: { width: 280, height: 280 },
                        data: {
                          kind: 'image',
                          assetId: 991,
                          assetWorkspaceId: WORKSPACE_ID,
                          resultUrl: `/api/v1/assets/991/download?workspace_id=${WORKSPACE_ID}`,
                          title: '产品参考图',
                        },
                      },
                    },
                  ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 158, title: '反推提示词流程', status: 'active', revision: 1 },
    })
  })
  await page.goto('/canvas/158')
  const image = page.locator('.react-flow__node[data-id="image-source"]')
  await expect(image).toBeVisible()
  await image.click({ position: { x: 120, y: 120 } })
  await expect(page.locator('[aria-label="反推提示词"]')).toBeHidden()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  expect(pageErrors).toEqual([])
  await page.screenshot({ path: test.info().outputPath('reverse-prompt-button-hidden.png') })
  expectNoUnexpectedApi(api)
})
