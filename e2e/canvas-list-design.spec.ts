import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 768, 390]) {
  test(`画布列表与新建弹窗在 ${width}px 可操作`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/canvases?**', (route) =>
      route.fulfill({
        json: {
          items: [
            { id: 701, title: '春日新品 · 视觉探索', updated_at: '2026-10-22T08:30:00Z' },
            { id: 702, title: '产品故事分镜', updated_at: '2026-10-21T09:00:00Z' },
            { id: 703, title: '品牌短片素材', status: 'archived' },
          ],
          total: 3,
        },
      }),
    )
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/canvases/701**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
          : { id: 701, title: '春日新品 · 视觉探索', revision: 1 },
      }),
    )
    await page.goto('/canvas?manage=1')
    await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()
    const openMenu = page.getByRole('button', { name: '打开菜单', exact: true })
    if (await openMenu.isVisible()) await openMenu.click()
    const sidebar = page.locator('.app-sidebar')
    await expect(sidebar.getByText('集市', { exact: true })).toBeVisible()
    await expect(sidebar.getByRole('button', { name: '无限画布', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('sidebar-product-names.png'), fullPage: true })
    await sidebar.getByRole('button', { name: '无限画布', exact: true }).click()
    await expect(page).toHaveURL(/\/canvas$/)
    await expect(page.getByRole('region', { name: '开始创作' })).toBeVisible()
    await expect(page.locator('.canvas-entry-main')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.getByRole('button', { name: '打开画布 春日新品 · 视觉探索', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('canvas-light-entry.png') })
    await page.getByRole('button', { name: '查看更多' }).click()
    await expect(page).toHaveURL(/\/projects\?flow=canvas$/)
    await expect(page.getByRole('tab', { name: '无限画布' })).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({ path: testInfo.outputPath('canvas-more-projects.png') })
    await page.goto('/canvas?manage=1')
    await expect(page.getByRole('button', { name: '打开画布 春日新品 · 视觉探索', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByText('共 3 个画布', { exact: true })).toBeVisible()
    await page.goto('/projects?flow=canvas')
    await expect(page.getByRole('tab', { name: '无限画布' })).toHaveAttribute('aria-selected', 'true')
    await page.goto('/canvas?manage=1')
    await page.screenshot({ path: testInfo.outputPath('canvas-list.png'), fullPage: true })
    await page.getByRole('button', { name: '更多操作' }).first().focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/canvas\?manage=1$/)
    await page.getByRole('button', { name: '重命名', exact: true }).click()
    const renameDialog = page.getByRole('dialog', { name: '重命名画布' })
    await expect(renameDialog).toBeVisible()
    const renameMask = page.locator('.cl-rename-mask')
    const maskBounds = await renameMask.boundingBox()
    expect(maskBounds).not.toBeNull()
    expect(maskBounds!.x).toBe(0)
    expect(maskBounds!.y).toBe(0)
    expect(maskBounds!.width).toBe(width)
    expect(maskBounds!.height).toBe(900)
    const renameBounds = await renameDialog.boundingBox()
    const inputBounds = await renameDialog.getByPlaceholder('输入画布名称').boundingBox()
    expect(renameBounds!.x).toBeGreaterThanOrEqual(0)
    expect(renameBounds!.x + renameBounds!.width).toBeLessThanOrEqual(width)
    expect(inputBounds!.x).toBeGreaterThanOrEqual(renameBounds!.x)
    expect(inputBounds!.x + inputBounds!.width).toBeLessThanOrEqual(renameBounds!.x + renameBounds!.width)
    await page.screenshot({ path: testInfo.outputPath(`canvas-rename-${width}.png`) })
    await renameDialog.getByRole('button', { name: '取消' }).click()
    await page.getByRole('button', { name: /新建画布/ }).click()
    const dialog = page.getByRole('dialog', { name: '创建新画布' })
    await expect(dialog).toBeVisible()
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await expect(dialog.getByRole('button', { name: '创建画布', exact: true })).toBeDisabled()
    await dialog.getByPlaceholder('请输入画布名称').fill('新的创意')
    await expect(dialog.getByRole('button', { name: '创建画布', exact: true })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('canvas-create.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: /新建画布/ }).click()
    await expect(dialog.getByPlaceholder('请输入画布名称')).toHaveValue('')
    await dialog.getByRole('button', { name: '取消' }).click()
    expectNoUnexpectedApi(api)
  })
}

test('空画布列表显示创建引导', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.goto('/canvas?manage=1')
  await expect(page.getByText(/还没有画布/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('canvas-empty.png'), fullPage: true })
  await page.goto('/canvas')
  await expect(page.getByRole('region', { name: '开始创作' })).toBeVisible()
  await expect(page.locator('.app-sidebar').getByRole('button', { name: '无限画布', exact: true })).toBeVisible()
  await page.getByRole('region', { name: '开始创作' }).getByRole('button', { name: '创建脚本' }).click()
  await expect(page.getByRole('dialog', { name: '创建新画布' })).toBeVisible()
  expectNoUnexpectedApi(api)
})

for (const width of [1440, 390]) {
  test(`最近项目的不同尺寸封面在 ${width}px 均显示为正方形`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/canvases?**', (route) =>
      route.fulfill({
        json: {
          items: [
            { id: 701, title: '竖图', updated_at: '2026-11-03T10:00:00Z' },
            { id: 702, title: '横图', updated_at: '2026-11-02T10:00:00Z' },
            { id: 703, title: '无封面', updated_at: '2026-11-01T10:00:00Z' },
          ],
        },
      }),
    )
    await page.route('**/api/v1/canvases/*/elements?**', (route) => {
      const id = Number(new URL(route.request().url()).pathname.split('/').at(-2))
      return route.fulfill({
        json: {
          elements:
            id === 703
              ? []
              : [
                  {
                    element_id: 'cover',
                    kind: 'node',
                    op: 'upsert',
                    payload: { type: 'image', data: { kind: 'image', assetId: id } },
                  },
                ],
          has_more: false,
          sync_revision: 1,
        },
      })
    })
    await page.route('**/api/v1/assets/*/download?**', (route) => {
      const id = Number(new URL(route.request().url()).pathname.split('/').at(-2))
      const dimensions = id === 701 ? 'width="100" height="200"' : 'width="200" height="100"'
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" ${dimensions}><rect width="100%" height="100%" fill="#8cb5a7"/></svg>`,
      })
    })
    await page.goto('/canvas')
    for (const title of ['竖图', '横图', '无封面']) {
      const card = page.getByRole('button', { name: `打开画布 ${title}` })
      const cover = card.locator('[class*="projectCover_"]')
      await expect(cover).toBeVisible()
      if (title !== '无封面') {
        const image = cover.locator('img')
        await expect(image).toHaveJSProperty('complete', true)
        await expect(image).toHaveCSS('object-fit', 'cover')
        expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
      } else {
        await expect(cover.getByText('暂无预览')).toBeVisible()
      }
      const bounds = await cover.boundingBox()
      expect(Math.abs(bounds!.width - bounds!.height)).toBeLessThan(1)
    }
    await page.screenshot({ path: testInfo.outputPath(`canvas-square-covers-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '画布操作 竖图' }).click()
    await expect(page.getByRole('button', { name: '重命名', exact: true })).toBeVisible()
    expectNoUnexpectedApi(api)
  })
}

test('漫剧起始页可直达最近项目，画布返回时恢复侧栏', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases*', (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { id: 999, title: '新画布' } })
    return route.fulfill({
      json: {
        items: [
          { id: 701, title: '最近项目 A', updated_at: '2026-11-03T10:00:00Z' },
          { id: 702, title: '最近项目 B', updated_at: '2026-11-02T10:00:00Z' },
        ],
      },
    })
  })
  await page.route('**/api/v1/canvases/701**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 701, title: '最近项目 A', revision: 1 },
    }),
  )
  await page.route('**/api/v1/canvases/999**', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'PATCH'
          ? { sync_revision: 2 }
          : new URL(route.request().url()).pathname.endsWith('/elements')
            ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
            : { id: 999, title: '新画布', revision: 1 },
    }),
  )

  await page.goto('/canvas')
  const sidebarCanvas = page.locator('.app-sidebar').getByRole('button', { name: '无限画布', exact: true })
  await expect(sidebarCanvas).toBeVisible()
  await expect(page.getByRole('region', { name: '开始创作' })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开画布 最近项目 A', exact: true })).toBeVisible()
  const actions = page.locator('[class*="actions"]')
  const recentHeader = page.getByRole('heading', { name: '最近的项目' })
  const actionsBounds = await actions.boundingBox()
  const recentHeaderBounds = await recentHeader.boundingBox()
  expect(Math.round(recentHeaderBounds!.y - (actionsBounds!.y + actionsBounds!.height))).toBe(100)
  await expect(page.getByRole('region', { name: '开始创作' }).locator('[class*="icon"]').first()).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  )
  await page.getByRole('button', { name: '画布操作 最近项目 A' }).click()
  await page.getByRole('button', { name: '重命名', exact: true }).click()
  const quickRenameDialog = page.getByRole('dialog', { name: '重命名画布' })
  await expect(quickRenameDialog.getByRole('button', { name: '取消' })).toHaveCSS('border-top-width', '1px')
  await expect(quickRenameDialog.getByRole('button', { name: '保存' })).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  )
  await expect(quickRenameDialog).toBeVisible()
  const quickRenameMask = quickRenameDialog.locator('xpath=..')
  const quickMaskBounds = await quickRenameMask.boundingBox()
  const viewport = page.viewportSize()!
  expect(quickMaskBounds!.x).toBe(0)
  expect(quickMaskBounds!.y).toBe(0)
  expect(quickMaskBounds!.width).toBe(viewport.width)
  expect(quickMaskBounds!.height).toBe(viewport.height)
  await page.screenshot({ path: testInfo.outputPath('canvas-start-rename-overlay.png') })
  await quickRenameDialog.getByRole('button', { name: '取消' }).click()
  await page.screenshot({ path: testInfo.outputPath('canvas-workspace-start.png') })
  await page.getByRole('button', { name: '打开画布 最近项目 A', exact: true }).click()
  await expect(page).toHaveURL(/\/canvas\/701$/)
  await expect(page.locator('.canvas-view')).toBeVisible()
  await expect(page.locator('.app-sidebar')).toHaveCount(0)
  await page.getByRole('button', { name: '返回无限画布' }).click()
  await expect(page).toHaveURL(/\/canvas$/)
  await expect(sidebarCanvas).toBeVisible()

  await page.getByRole('region', { name: '开始创作' }).getByRole('button', { name: '创建脚本' }).click()
  const dialog = page.getByRole('dialog', { name: '创建新画布' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('请输入画布名称').fill('脚本工作流')
  await dialog.getByRole('button', { name: '创建画布' }).click()
  await expect(page).toHaveURL(/\/canvas\/999$/)
  await expect(page.locator('.app-sidebar')).toHaveCount(0)
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('canvas-workspace-editor.png') })
  await page.getByRole('button', { name: '返回无限画布' }).click()
  await expect(sidebarCanvas).toBeVisible()
  expectNoUnexpectedApi(api)
})

test('最近项目卡片支持重命名且仅本人可删除', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  let deletedId = 0
  await page.route('**/api/v1/canvases?*', (route) =>
    route.fulfill({
      json: {
        items: [
          { id: 701, title: '我的画布', user_id: 7, updated_at: '2026-11-03T10:00:00Z' },
          { id: 702, title: '同事的画布', user_id: 8, updated_at: '2026-11-02T10:00:00Z' },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/*/elements?*', (route) =>
    route.fulfill({ json: { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false } }),
  )
  await page.route('**/api/v1/canvases/701?*', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { id: 701, title: '更新后的画布' } })
    if (route.request().method() === 'DELETE') {
      deletedId = 701
      return route.fulfill({ json: { success: true } })
    }
    return route.fulfill({ json: { id: 701, title: '我的画布' } })
  })
  await page.goto('/canvas')
  await page.getByRole('button', { name: '画布操作 我的画布' }).click()
  await page.getByRole('button', { name: '重命名', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '重命名画布' })
  await dialog.getByLabel('画布名称').fill('更新后的画布')
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('button', { name: '打开画布 更新后的画布' })).toBeVisible()
  await page.getByRole('button', { name: '画布操作 同事的画布' }).click()
  await expect(page.getByText('仅创建者可重命名或删除此画布')).toBeVisible()
  await expect(page.getByRole('button', { name: '重命名', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '删除画布', exact: true })).toHaveCount(0)
  const more = page.getByRole('button', { name: '画布操作 同事的画布' })
  const alignment = await more.evaluate((button) => {
    const outer = button.getBoundingClientRect()
    const icon = button.querySelector('svg')!.getBoundingClientRect()
    return {
      x: icon.x + icon.width / 2 - (outer.x + outer.width / 2),
      y: icon.y + icon.height / 2 - (outer.y + outer.height / 2),
    }
  })
  expect(Math.abs(alignment.x)).toBeLessThan(1)
  expect(Math.abs(alignment.y)).toBeLessThan(1)
  await page.screenshot({ path: 'test-results/canvas-recent-permission.png' })
  await page.getByRole('button', { name: '画布操作 更新后的画布' }).click()
  await page.getByRole('button', { name: '删除画布', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click()
  await expect.poll(() => deletedId).toBe(701)
  await expect(page.getByRole('button', { name: '打开画布 更新后的画布' })).toHaveCount(0)
  expectNoUnexpectedApi(api)
})

test('矮屏漫剧起始页可滚动查看全部最近项目', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.setViewportSize({ width: 390, height: 640 })
  await page.route('**/api/v1/canvases?*', (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 8 }, (_, index) => ({
          id: 801 + index,
          title: `矮屏项目 ${index + 1}`,
          updated_at: new Date(Date.now() - index * 1000).toISOString(),
        })),
      },
    }),
  )
  await page.route('**/api/v1/canvases/*/elements?*', (route) =>
    route.fulfill({ json: { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false } }),
  )
  await page.goto('/canvas')
  await expect(page.getByRole('heading', { name: '开启你的漫剧创作' })).toBeVisible()
  const main = page.getByRole('main', { name: '无限画布创作入口' })
  const lastCard = page.getByRole('button', { name: '打开画布 矮屏项目 8', exact: true })
  await expect(lastCard).toBeVisible()
  await lastCard.scrollIntoViewIfNeeded()
  expect(await main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  const [mainBounds, cardBounds] = await Promise.all([main.boundingBox(), lastCard.boundingBox()])
  expect(cardBounds!.y).toBeGreaterThanOrEqual(mainBounds!.y)
  expect(cardBounds!.y + cardBounds!.height).toBeLessThanOrEqual(mainBounds!.y + mainBounds!.height)
  expectNoUnexpectedApi(api)
})

test('新画布入口打开命名弹窗并承接创建意图', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  const persistedElements = new Map<string, Record<string, unknown>>()
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases?**', (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { id: 999, title: '命名后的新项目' } })
    return route.fulfill({
      json: {
        items: [
          { id: 999, title: '命名后的新项目', updated_at: new Date().toISOString() },
          ...Array.from({ length: 12 }, (_, index) => ({
            id: 900 + index,
            title: `最近项目 ${index + 1}`,
            updated_at: new Date(Date.now() - (index + 1) * 1000).toISOString(),
          })),
        ],
      },
    })
  })
  await page.route('**/api/v1/canvases/*/elements*', (route) => {
    if (route.request().method() === 'PATCH') {
      const mutations = route.request().postDataJSON()?.mutations || []
      for (const mutation of mutations) {
        if (mutation.op === 'delete') persistedElements.delete(String(mutation.element_id))
        else persistedElements.set(String(mutation.element_id), mutation)
      }
      return route.fulfill({ json: { sync_revision: 2 } })
    }
    return route.fulfill({
      json: {
        elements: [...persistedElements.values()],
        sync_revision: persistedElements.size ? 2 : 1,
        history_floor_revision: 0,
        has_more: false,
      },
    })
  })
  await page.route('**/api/v1/canvases/999**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/elements')) {
      if (route.request().method() === 'PATCH') {
        for (const mutation of route.request().postDataJSON()?.mutations || []) {
          if (mutation.op === 'delete') persistedElements.delete(String(mutation.element_id))
          else persistedElements.set(String(mutation.element_id), mutation)
        }
        return route.fulfill({ json: { sync_revision: 2 } })
      }
      return route.fulfill({
        json: {
          elements: [...persistedElements.values()],
          sync_revision: persistedElements.size ? 2 : 1,
          history_floor_revision: 0,
          has_more: false,
        },
      })
    }
    return route.fulfill({ json: { id: 999, title: '命名后的新项目', revision: 1 } })
  })
  await page.goto('/canvas/142')
  const studio = page.getByRole('region', { name: '开始创作' })
  await expect(studio.getByRole('button', { name: '创建脚本' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看更多' })).toBeVisible()
  await studio.getByRole('button', { name: '创建脚本' }).click()
  const dialog = page.getByRole('dialog', { name: '创建新画布' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByPlaceholder('请输入画布名称')).toBeFocused()
  await dialog.getByPlaceholder('请输入画布名称').fill('脚本项目验收')
  await dialog.getByRole('button', { name: '创建画布' }).click()
  await expect(page).toHaveURL(/\/canvas\/999$/)
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '剧本创作' })).toBeVisible()
  await expect(page.getByText('已保存到云端')).toBeVisible()
  await expect.poll(() => persistedElements.size).toBeGreaterThan(0)
  expectNoUnexpectedApi(api)
})

test('新建项目首个节点返回后重开仍然存在', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  const persistedElements = new Map<string, Record<string, unknown>>()
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases?**', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ json: { id: 999, title: '命名后的新项目' } })
      : route.fulfill({ json: { items: [{ id: 999, title: '命名后的新项目' }] } }),
  )
  await page.route('**/api/v1/canvases/999**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/elements')) {
      if (route.request().method() === 'PATCH') {
        for (const mutation of route.request().postDataJSON()?.mutations || []) {
          if (mutation.op === 'delete') persistedElements.delete(String(mutation.element_id))
          else persistedElements.set(String(mutation.element_id), mutation)
        }
        return route.fulfill({ json: { sync_revision: 2 } })
      }
      return route.fulfill({
        json: {
          elements: [...persistedElements.values()],
          sync_revision: persistedElements.size ? 2 : 1,
          history_floor_revision: 0,
          has_more: false,
        },
      })
    }
    return route.fulfill({ json: { id: 999, title: '命名后的新项目', revision: 1 } })
  })

  await page.goto('/canvas')
  await page.getByRole('region', { name: '开始创作' }).getByRole('button', { name: '创建脚本' }).click()
  const dialog = page.getByRole('dialog', { name: '创建新画布' })
  await dialog.getByPlaceholder('请输入画布名称').fill('脚本项目验收')
  await dialog.getByRole('button', { name: '创建画布' }).click()
  await expect(page).toHaveURL(/\/canvas\/999$/)
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '剧本创作' })).toBeVisible()
  await expect.poll(() => persistedElements.size).toBeGreaterThan(0)
  await page.getByRole('button', { name: '返回无限画布' }).click()
  await page.getByRole('button', { name: '打开画布 命名后的新项目' }).click()
  await expect(page).toHaveURL(/\/canvas\/999$/)
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '剧本创作' })).toBeVisible()
  expectNoUnexpectedApi(api)
})

test('宽屏两张有封面的画布保持缩略卡片尺寸', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 2160, height: 1200 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases?**', (route) =>
    route.fulfill({
      json: {
        items: [
          { id: 701, title: '空间光影' },
          { id: 702, title: '人物视觉' },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/*/elements?**', (route) =>
    route.fulfill({
      json: {
        elements: [
          {
            element_id: 'cover',
            kind: 'node',
            op: 'upsert',
            payload: { type: 'image', data: { kind: 'image', assetId: 981 } },
          },
        ],
        has_more: false,
        sync_revision: 1,
      },
    }),
  )
  await page.route('**/api/v1/assets/981/download?**', (route) =>
    route.fulfill({ path: 'src/assets/login-hero.webp', contentType: 'image/webp' }),
  )
  await page.goto('/canvas?manage=1')
  const cards = page.locator('[data-canvas-id]')
  await expect(cards).toHaveCount(2)
  await expect(page.locator('.cl-cover-media')).toHaveCount(2)
  for (const image of await page.locator('.cl-cover-media').all()) {
    await expect(image).toHaveJSProperty('complete', true)
    expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  }
  for (const card of await cards.all()) {
    const bounds = await card.boundingBox()
    expect(bounds!.width).toBeLessThanOrEqual(380)
    expect(bounds!.height).toBeLessThan(310)
  }
  await page.screenshot({ path: testInfo.outputPath('canvas-two-covers.png'), fullPage: true })
  expectNoUnexpectedApi(api)
})
