import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('图片节点可复制到系统剪贴板，画布内粘贴节点且外部新图片不会被旧节点抢占', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const api = await installStrictAuthenticatedApp(page)
  let externalUploads = 0
  await page.route('**/api/v1/assets', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    externalUploads++
    return route.fulfill({ status: 400, json: { message: '测试素材上传失败' } })
  })
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/canvases/953**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'copy-image',
                kind: 'node',
                payload: {
                  id: 'copy-image',
                  type: 'image',
                  position: { x: 0, y: 0 },
                  style: { width: 240, height: 200 },
                  data: {
                    kind: 'image',
                    title: '剪贴板优先级图片',
                    resultUrl: '/favicon.png',
                  },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 953, title: '剪贴板优先级', revision: 1 },
    }),
  )
  await page.goto('/canvas/953')

  const node = page.locator('.react-flow__node[data-id="copy-image"]')
  await expect(node).toBeVisible()
  await node.click()
  await page.keyboard.press('Control+c')
  await expect(page.getByText('图片和节点已复制')).toBeVisible()
  expect(await page.evaluate(async () => (await navigator.clipboard.read())[0].types)).toContain('image/png')

  await page.keyboard.press('Control+v')
  await expect(page.getByText('粘贴哪些节点？')).toBeVisible()
  await page.getByRole('button', { name: /只含当前节点/ }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)

  await page.evaluate(() => navigator.clipboard.writeText('右键复制前的剪贴板'))
  await node.click({ button: 'right' })
  await page.getByRole('button', { name: '复制 Ctrl+C' }).click()
  await expect
    .poll(async () => page.evaluate(async () => (await navigator.clipboard.read())[0].types))
    .toContain('image/png')

  await page.locator('.canvas-view').evaluate((root) => {
    const data = new DataTransfer()
    data.items.add(new File(['image bytes'], 'system-clipboard.png', { type: 'image/png' }))
    root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })

  await expect(page.getByText('粘贴哪些节点？')).toBeHidden()
  await expect.poll(() => externalUploads).toBe(1)
  await expect(page.locator('.react-flow__node[data-id="copy-image"]')).toHaveCount(1)
  expectNoUnexpectedApi(api)
})
