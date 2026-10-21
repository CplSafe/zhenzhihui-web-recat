import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('超分打开时收起输入框，关闭后恢复原文与选中节点', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: 42,
            name: '图片超分',
            capability: 'image',
            operation_codes: ['image.upscale'],
            params_schema: { fields: [{ name: 'multiple', type: 'number', default: 2, min: 1, max: 4 }] },
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/120**', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ json: { revision: 2 } })
      return
    }
    await route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'source',
                kind: 'node',
                payload: {
                  id: 'source',
                  type: 'image',
                  position: { x: 300, y: 200 },
                  style: { width: 320, height: 240 },
                  data: {
                    kind: 'image',
                    assetId: 701,
                    assetWorkspaceId: WORKSPACE_ID,
                    title: '原图',
                    prompt: '保留这段图片描述',
                  },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 120, title: '超分面板验证', revision: 1 },
    })
  })
  await page.goto('/canvas/120')
  const source = page.locator('.react-flow__node[data-id="source"]')
  await source.locator('.canvas-node-header').click()
  await expect(page.locator('.canvas-panel-area')).toBeVisible()
  await expect(page.locator('.canvas-panel-area textarea').first()).toHaveValue('保留这段图片描述')
  await page.getByRole('button', { name: '超分', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '超分', exact: true })
  await expect(modal).toBeVisible()
  await expect(page.locator('.ant-modal-mask')).toHaveCount(0)
  await expect(modal.getByRole('button', { name: '2 倍', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(modal.getByRole('button', { name: '6 倍', exact: true })).toHaveCount(0)
  await modal.getByRole('button', { name: '4 倍', exact: true }).click()
  await expect(modal.getByRole('spinbutton', { name: '放大倍率（倍）' })).toHaveValue('4')
  await expect(page.locator('.canvas-panel-area')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '超分', exact: true })).toHaveCount(0)
  await modal.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(modal).not.toBeVisible()
  await expect(page.locator('.canvas-panel-area')).toBeVisible()
  await expect(page.locator('.canvas-panel-area textarea').first()).toHaveValue('保留这段图片描述')
  await expect(source).toHaveClass(/selected/)
  await page.getByRole('button', { name: '超分', exact: true }).click()
  await expect(modal).toBeVisible()
  await expect(page.locator('.canvas-panel-area')).toHaveCount(0)
  await modal.getByRole('button', { name: 'Close', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('.canvas-panel-area')).toBeVisible()
  await page.getByRole('button', { name: '超分', exact: true }).click()
  await expect(modal).toBeVisible()
  await source.locator('.canvas-node-header').click()
  await page.locator('.react-flow__pane').click({ position: { x: 40, y: 100 } })
  await expect(modal).not.toBeVisible()
})
