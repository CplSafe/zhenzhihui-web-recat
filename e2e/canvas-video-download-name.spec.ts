import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const width of [1440, 760]) {
  test(`画布视频按节点当前名称下载 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    const bytes = await readFile('public/tutorials/hot-copy.mp4')
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      delete (window as any).showSaveFilePicker
    })
    await page.route('**/api/v1/assets', (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      expect(route.request().postDataJSON().source).toBe('canvas-poster')
      return route.fulfill({ status: 503, json: { message: '封面服务不可用' } })
    })
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { code: 0, data: [] } }))
    await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/assets/601/download?**', (route) =>
      route.fulfill({ contentType: 'video/mp4', body: bytes }),
    )
    await page.route('**/api/v1/canvases/172**', (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements:
                Number(url.searchParams.get('after_revision')) > 0
                  ? []
                  : [
                      {
                        element_id: 'video-name',
                        kind: 'node',
                        op: 'upsert',
                        payload: {
                          id: 'video-name',
                          type: 'video',
                          position: { x: 200, y: 180 },
                          style: { width: 320, height: 240 },
                          data: {
                            kind: 'video',
                            title: '原视频名称',
                            assetId: 601,
                            assetWorkspaceId: WORKSPACE_ID,
                            resultUrl: `/api/v1/assets/601/download?workspace_id=${WORKSPACE_ID}`,
                          },
                        },
                      },
                    ],
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 172, title: '视频下载', status: 'active', revision: 1 },
      })
    })
    await page.goto('/canvas/172')
    const node = page.locator('.react-flow__node[data-id="video-name"]')
    await node.locator('.canvas-node-header').click()
    const toolbar = page.getByRole('toolbar', { name: '节点操作' })
    const downloadButton = toolbar.getByRole('button', { name: '下载素材', exact: true })
    await expect(downloadButton).toBeEnabled()
    const first = page.waitForEvent('download')
    await downloadButton.click()
    expect((await first).suggestedFilename()).toBe('原视频名称.mp4')
    await toolbar.getByRole('button', { name: '重命名节点' }).click()
    const edit = node.locator('input.ie-input')
    await edit.fill('新名称:作品.mp4')
    await edit.press('Enter')
    await expect(node.locator('.canvas-node-header__label')).toHaveText('新名称:作品.mp4')
    const second = page.waitForEvent('download')
    await downloadButton.click()
    const download = await second
    expect(download.suggestedFilename()).toBe('新名称_作品.mp4')
    const saved = testInfo.outputPath('node-video.mp4')
    await download.saveAs(saved)
    expect(await readFile(saved)).toEqual(bytes)
    await page.screenshot({ path: testInfo.outputPath(`video-download-${width}.png`) })
    expect(errors).toEqual([])
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
