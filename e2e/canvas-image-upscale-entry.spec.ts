import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const width of [1440, 760]) {
  test(`图片和视频节点仅在有素材时显示超分 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/assets', (route) =>
      route.fulfill({ status: 503, json: { message: '测试环境不保存视频封面' } }),
    )
    await page.route('**/api/v1/canvases/120**', async (route) => {
      await route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? {
              elements: [
                { id: 'image-empty', kind: 'image' },
                { id: 'image', kind: 'image', assetId: 701 },
                { id: 'video', kind: 'video' },
                { id: 'video-filled', kind: 'video', assetId: 702 },
              ].map(({ id, kind, assetId }, index) => ({
                element_id: id,
                kind: 'node',
                payload: {
                  id,
                  type: kind,
                  position: { x: 300 + index * 400, y: 200 },
                  style: { width: 320, height: 240 },
                  data: { kind, assetId, assetWorkspaceId: WORKSPACE_ID, title: id },
                },
              })),
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 120, title: '图片超分入口隐藏验证', revision: 1 },
      })
    })
    await page.goto('/canvas/120')
    await page.locator('.react-flow__node[data-id="image-empty"] .canvas-node-header').click()
    const toolbar = page.getByRole('toolbar', { name: '节点操作', exact: true })
    await expect(toolbar).toBeVisible()
    await expect(toolbar.getByRole('button', { name: '超分', exact: true })).toHaveCount(0)
    await expect(toolbar.getByRole('button', { name: '下载素材', exact: true })).toHaveCount(0)

    await page.locator('.react-flow__node[data-id="image"] .canvas-node-header').click()
    await expect(toolbar.getByRole('button', { name: '超分', exact: true })).toBeEnabled()
    for (const name of ['重命名节点', '替换素材', '下载素材', '删除节点', '放大预览图片']) {
      await expect(toolbar.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await toolbar.getByRole('button', { name: '放大预览图片' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('image-toolbar.png') })
    await page.locator('.react-flow__node[data-id="video"] .canvas-node-header').click()
    await expect(toolbar.getByRole('button', { name: '超分', exact: true })).toHaveCount(0)
    await expect(toolbar.getByRole('button', { name: '上传素材' })).toBeVisible()
    await page.locator('.react-flow__node[data-id="video-filled"] .canvas-node-header').click()
    await expect(toolbar.getByRole('button', { name: '超分', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('video-toolbar-with-content.png') })
    expect(errors).toEqual([])
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
