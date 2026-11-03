import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('项目管理的漫剧制作分类展示画布文件并可打开', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/canvases?*', (route) =>
    route.fulfill({
      json: {
        items: [
          { id: 701, title: '春日新品分镜', user_id: 7, updated_at: '2026-10-22T08:30:00Z' },
          { id: 702, title: '品牌短剧脚本', user_id: 8, status: 'archived' },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/*/elements?*', (route) =>
    route.fulfill({
      json: {
        elements: [
          {
            element_id: 'cover',
            kind: 'node',
            op: 'upsert',
            payload: { type: 'image', data: { kind: 'image', assetId: 881 } },
          },
        ],
        sync_revision: 1,
        history_floor_revision: 0,
        has_more: false,
      },
    }),
  )
  await page.route('**/api/v1/assets/881/download?*', (route) =>
    route.fulfill({ path: 'src/assets/login-hero.webp', contentType: 'image/webp' }),
  )
  await page.route('**/api/v1/canvases/701?*', (route) => {
    if (route.request().method() === 'DELETE') return route.fulfill({ json: { success: true } })
    if (route.request().method() === 'PATCH') {
      return route.fulfill({ json: { id: 701, title: '改名后的分镜', user_id: 7 } })
    }
    return route.fulfill({ json: { id: 701, title: '春日新品分镜', user_id: 7 } })
  })
  await page.goto('/projects')
  await page.getByRole('tab', { name: '漫剧制作', exact: true }).click()
  await expect(page.getByRole('button', { name: '打开漫剧制作文件 春日新品分镜' })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开漫剧制作文件 品牌短剧脚本' })).toBeVisible()
  const ownCard = page.getByRole('button', { name: '打开漫剧制作文件 春日新品分镜' })
  const cover = ownCard.locator('.pm2-pcard-cover-media')
  await expect(cover).toBeVisible()
  await expect(cover).toHaveJSProperty('complete', true)
  expect(await cover.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  await ownCard.getByRole('button', { name: '画布操作 春日新品分镜' }).click()
  await page.getByRole('button', { name: '重命名', exact: true }).click()
  const renameDialog = page.getByRole('dialog', { name: '重命名画布' })
  await renameDialog.getByLabel('画布名称').fill('改名后的分镜')
  await renameDialog.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('button', { name: '打开漫剧制作文件 改名后的分镜' })).toBeVisible()
  await page.getByRole('button', { name: '画布操作 改名后的分镜' }).click()
  await expect(page.getByRole('button', { name: '删除画布', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '画布操作 品牌短剧脚本' }).click()
  await expect(page.getByRole('button', { name: '删除画布', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('project-management-canvas-files.png') })
  await page.getByRole('button', { name: '打开漫剧制作文件 品牌短剧脚本' }).click()
  await expect(page).toHaveURL(/\/canvas\/702$/)
  await page.goto('/projects?flow=canvas')
  await expect(page.getByRole('tab', { name: '漫剧制作', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: '画布操作 春日新品分镜' }).click()
  await page.getByRole('button', { name: '删除画布', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click()
  await expect(page.getByRole('button', { name: '打开漫剧制作文件 春日新品分镜' })).toHaveCount(0)
  expectNoUnexpectedApi(api)
})
