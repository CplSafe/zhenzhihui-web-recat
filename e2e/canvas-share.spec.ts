import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

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

test('新分享默认设置有限期并可由所有者作废', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  let revision = 1
  let submittedExpiry = ''
  let deleted = false
  await page.route('**/api/v1/canvases/128**', async (route) => {
    const request = route.request()
    if (request.url().includes('/share')) {
      if (request.method() === 'POST') {
        submittedExpiry = String(request.postDataJSON()?.expires_at || '')
        return route.fulfill({ json: { token: 'fresh-token', status: 'active', expires_at: submittedExpiry } })
      }
      if (request.method() === 'DELETE') {
        deleted = true
        return route.fulfill({ json: {} })
      }
      return route.fulfill({ json: {} })
    }
    if (request.method() === 'PATCH') return route.fulfill({ json: { sync_revision: ++revision } })
    return route.fulfill({
      json: request.url().includes('/elements')
        ? { elements: [], sync_revision: revision, history_floor_revision: 0, has_more: false }
        : { id: 128, title: '分享权限测试', status: 'active', revision },
    })
  })
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  await page.goto('/canvas/128')
  await page.getByRole('button', { name: '分享这块画布' }).click()
  await expect(page.getByRole('dialog', { name: '分享画布' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '分享链接有效期' })).toHaveValue('7')
  await page.getByRole('button', { name: '生成链接' }).click()
  await expect.poll(() => submittedExpiry).not.toBe('')
  expect(Date.parse(submittedExpiry)).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000)
  await expect(page.getByText(/到期/)).toBeVisible()
  await page.getByRole('button', { name: '关闭分享', exact: true }).click()
  await expect.poll(() => deleted).toBe(true)
  expectNoUnexpectedApi(api)
})
