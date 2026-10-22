import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const width of [1440, 760, 390]) {
  test(`图片预览参数与缩放居中 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const api = await installStrictAuthenticatedApp(page)
    let historicalTaskReads = 0
    await page.route('**/api/v1/assets?**', (route) =>
      route.fulfill({ json: { items: [{ id: 704, type: 'image', task_id: 8801 }], total: 1 } }),
    )
    await page.route('**/api/v1/ai/tasks/8801?**', (route) => {
      historicalTaskReads += 1
      return route.fulfill({
        json: {
          id: 8801,
          status: 'succeeded',
          operation_code: 'image.upscale',
          model_version_id: 42,
          params: { multiple: 4 },
        },
      })
    })
    await page.route('**/api/v1/ai/models?**', (route) =>
      route.fulfill({
        json: {
          items:
            new URL(route.request().url()).searchParams.get('operation_code') === 'image.upscale'
              ? [{ id: 42, display_name: 'Topaz 超分模型', operation_codes: ['image.upscale'] }]
              : [],
        },
      }),
    )
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/assets/*/download?**', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: route.request().url().includes('/703/')
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="940" height="938"><rect width="940" height="938" fill="#c9c3b9"/></svg>'
          : '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="#415961"/><circle cx="768" cy="480" r="230" fill="#98b6ad"/></svg>',
      }),
    )
    await page.route('**/api/v1/canvases/120**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? {
              elements: [
                {
                  element_id: 'image',
                  kind: 'node',
                  payload: {
                    id: 'image',
                    type: 'image',
                    position: { x: 300, y: 200 },
                    style: { width: 320, height: 240 },
                    data: {
                      kind: 'image',
                      assetId: 701,
                      assetWorkspaceId: WORKSPACE_ID,
                      title: '海边的人像',
                      modelVersionId: 999,
                      params: { resolution: '4K' },
                      imageResultAssetIds: [701, 702],
                      resultHistory: [
                        {
                          assetId: 701,
                          kind: 'image',
                          createdAt: '2026-10-22T03:00:00Z',
                          imageInfo: {
                            modelName: '测试图片模型',
                            operationCode: 'image.text_to_image',
                            modelVersionId: 101,
                            prompt: '海边的人像，柔和自然光。',
                            createdAt: '2026-10-22T03:00:00Z',
                            rows: [
                              { label: '生成规格', value: '2K' },
                              { label: '随机种子', value: '0' },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
                {
                  element_id: 'local',
                  kind: 'node',
                  payload: {
                    id: 'local',
                    type: 'image',
                    position: { x: 700, y: 200 },
                    style: { width: 320, height: 240 },
                    data: {
                      kind: 'image',
                      assetId: 703,
                      assetSource: 'upload',
                      assetWorkspaceId: WORKSPACE_ID,
                      title: '本地图片',
                      imageOrigin: { assetId: 703, kind: 'upload' },
                    },
                  },
                },
                {
                  element_id: 'legacy-hd',
                  kind: 'node',
                  payload: {
                    id: 'legacy-hd',
                    type: 'image',
                    position: { x: 1100, y: 200 },
                    style: { width: 320, height: 240 },
                    data: {
                      kind: 'image',
                      assetId: 704,
                      assetWorkspaceId: WORKSPACE_ID,
                      title: '历史图片超分',
                      modelVersionId: 999,
                      operationCode: 'image.generate',
                      hd: { taskId: 'submission-historical', sourceAssetId: 703, sourceNodeId: 'local' },
                    },
                  },
                },
              ],
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 120, title: '图片预览验收', revision: 1 },
      }),
    )
    await page.goto('/canvas/120', { waitUntil: 'domcontentloaded' })
    await page.locator('.react-flow__node[data-id="image"] .canvas-node-header').click()
    await page.getByRole('button', { name: '放大预览图片', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '图片预览' })
    const info = dialog.getByRole('complementary', { name: '图片信息' })
    await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(dialog.getByRole('group', { name: '图片缩放工具' })).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    )
    await expect(info.getByText('模型生成', { exact: true })).toBeVisible()
    await expect(info.getByText('使用模型', { exact: true })).toBeVisible()
    await expect(info.getByText('测试图片模型', { exact: true })).toBeVisible()
    await expect(info.getByText('文生图', { exact: true })).toBeVisible()
    await expect(info.getByText('1536 × 1024 px', { exact: true })).toBeVisible()
    await expect(info.getByText('3:2', { exact: true })).toBeVisible()
    await expect(info.getByText('2K', { exact: true })).toBeVisible()
    await expect(info.getByText('4K', { exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: '原始大小', exact: true }).click()
    const percent = dialog.getByRole('spinbutton', { name: '图片缩放百分比' })
    await expect(percent).toHaveValue('100')
    const aligned = await percent.evaluate((input) => {
      const label = input.parentElement!
      const minus = label.previousElementSibling!.getBoundingClientRect()
      const plus = label.nextElementSibling!.getBoundingClientRect()
      const box = label.getBoundingClientRect()
      const unit = label.querySelector('span')!.getBoundingClientRect()
      const number = input.getBoundingClientRect()
      return {
        between: Math.abs((minus.right + plus.left) / 2 - (box.left + box.right) / 2),
        text: Math.abs((number.left + unit.right) / 2 - (box.left + box.right) / 2),
        gap: plus.left - box.right,
      }
    })
    expect(aligned.between).toBeLessThan(1)
    expect(aligned.text).toBeLessThan(1)
    expect(aligned.gap).toBeLessThanOrEqual(4)
    const geometry = await dialog.getByRole('region', { name: '图片缩放区域' }).evaluate((region) => {
      const surface = region.getBoundingClientRect()
      const image = region.querySelector('img')!.getBoundingClientRect()
      return {
        x: Math.abs((surface.left + surface.right - image.left - image.right) / 2),
        y: Math.abs((surface.top + surface.bottom - image.top - image.bottom) / 2),
      }
    })
    expect(geometry.x).toBeLessThan(1)
    expect(geometry.y).toBeLessThan(1)
    await percent.fill('200')
    await percent.press('Enter')
    await expect(percent).toHaveValue('200')
    await dialog.getByRole('button', { name: '适应窗口' }).click()
    const previewPath = testInfo.outputPath('image-preview-info.png')
    await page.screenshot({ path: previewPath })
    await testInfo.attach('图片预览与参数', { path: previewPath, contentType: 'image/png' })
    await dialog.getByRole('button', { name: '下一张图片' }).click()
    await expect(info.getByText('模型生成', { exact: true })).toBeVisible()
    await expect(info.getByText('历史生成参数未记录', { exact: true })).toBeVisible()
    await expect(info.getByText('测试图片模型')).toHaveCount(0)
    await expect(info.getByText('1536 × 1024 px', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '下一张图片' }).click()
    await expect(info.getByText('本地添加', { exact: true })).toBeVisible()
    await expect(info.getByText('使用模型', { exact: true })).toHaveCount(0)
    await expect(info.getByText('历史生成参数未记录', { exact: true })).toHaveCount(0)
    await expect(info.getByText('940 × 938 px', { exact: true })).toBeVisible()
    await expect(info.getByText('约 1:1', { exact: true })).toBeVisible()
    const localPath = testInfo.outputPath('local-image-source.png')
    await page.screenshot({ path: localPath })
    await testInfo.attach('本地图片获取方式', { path: localPath, contentType: 'image/png' })
    await dialog.getByRole('button', { name: '下一张图片' }).click()
    await expect(info.getByText('模型生成', { exact: true })).toBeVisible()
    await expect(info.getByText('图片超分', { exact: true })).toBeVisible()
    await expect(info.getByText('Topaz 超分模型', { exact: true })).toBeVisible()
    await expect(info.getByText('模型 #999', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('legacy-upscale-model.png'), animations: 'disabled' })
    await testInfo.attach('历史超分模型与功能', {
      path: testInfo.outputPath('legacy-upscale-model.png'),
      contentType: 'image/png',
    })
    await dialog.getByRole('button', { name: '上一张图片' }).click()
    await expect(info.getByText('本地添加', { exact: true })).toBeVisible()
    await expect(info.getByText('Topaz 超分模型')).toHaveCount(0)
    await dialog.getByRole('button', { name: '下一张图片' }).click()
    await expect(info.getByText('Topaz 超分模型', { exact: true })).toBeVisible()
    expect(historicalTaskReads).toBe(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(errors).toEqual([])
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
