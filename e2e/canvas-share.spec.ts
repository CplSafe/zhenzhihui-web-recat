import { expect, test } from '@playwright/test'

const node = (id: string, kind: string, x: number, data: Record<string, unknown>) => ({
  element_id: id,
  kind: 'node',
  payload: {
    id,
    type: kind,
    position: { x, y: 100 },
    style: { width: 260, height: 180 },
    data: { kind, ...data },
  },
})

test('免登录分享页展示公开素材与历史连线', async ({ page }) => {
  await page.route('**/api/v1/canvas-shares/shared-token**', async (route) => {
    const path = new URL(route.request().url()).pathname
    await route.fulfill({
      json: path.endsWith('/elements')
        ? {
            elements: [
              node('image', 'image', 80, {
                assetId: 12,
                resultUrl: '/api/v1/assets/12/download?workspace_id=3',
                publicResultUrl: '/shared/image.svg',
              }),
              node('text', 'text', 480, { text: '分享的画布文字' }),
              {
                element_id: 'edge-1',
                kind: 'edge',
                payload: {
                  id: 'edge-1',
                  source: 'image',
                  target: 'text',
                  sourceHandle: 'image-right-source',
                  targetHandle: 'text-left-target',
                },
              },
            ],
            has_more: false,
          }
        : { title: '分享测试画布', status: 'active' },
    })
  })
  await page.route('**/shared/image.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>',
    }),
  )
  await page.route('**/api/v1/assets/12/download**', (route) => route.fulfill({ status: 403 }))

  await page.goto('/canvas/share/shared-token', { waitUntil: 'domcontentloaded' })

  await expect(page.getByText('分享测试画布')).toBeVisible()
  await expect(page.getByRole('img', { name: '图片预览' })).toHaveJSProperty('complete', true)
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge-path')).toHaveAttribute('d', /[MLC]/)
  await expect(page.getByText('分享的画布文字')).toBeVisible()
})
