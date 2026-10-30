import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('复制画布节点后 Ctrl+V 优先粘贴节点，即使系统剪贴板里有图片', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
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
                    resultUrl:
                      'data:image/svg+xml,' +
                      encodeURIComponent(
                        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="200"><rect width="240" height="200" fill="#789"/></svg>',
                      ),
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
  await expect(page.getByText('已复制 1 个节点')).toBeVisible()

  await page.locator('.canvas-view').evaluate((root) => {
    const data = new DataTransfer()
    data.items.add(new File(['image bytes'], 'system-clipboard.png', { type: 'image/png' }))
    root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })

  await expect(page.getByText('粘贴哪些节点？')).toBeVisible()
  await page.getByRole('button', { name: /只含当前节点/ }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect(page.locator('.react-flow__node[data-id="copy-image"]')).toHaveCount(1)
  expectNoUnexpectedApi(api)
})
