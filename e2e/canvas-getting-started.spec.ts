import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`空画布隐藏上一轮引导和导入 ${width}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    let revision = 1
    const saved = new Map<string, any>()
    await page.route('**/api/v1/canvases/142**', (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'PATCH') {
        for (const item of route.request().postDataJSON().mutations || []) {
          if (item.op === 'delete') saved.delete(item.element_id)
          else saved.set(item.element_id, item)
        }
        return route.fulfill({ json: { sync_revision: ++revision } })
      }
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [...saved.values()],
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 142, title: '开始创作验收', revision, status: 'active' },
      })
    })
    await page.goto('/canvas/142')
    const guide = page.getByRole('region', { name: '画布开始指南' })
    await expect(page.locator('.canvas-view')).toBeVisible()
    await expect(guide).toHaveCount(0)
    if (width <= 760) await page.getByRole('button', { name: '画布操作', exact: true }).click()
    await expect(page.getByRole('button', { name: '开始指南', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '导入文字或分镜', exact: true })).toHaveCount(0)
    await expect(page.getByRole('toolbar', { name: '画布视图控制' })).toHaveCount(0)
    const createRegion = page.getByRole('region', { name: '开始创作' })
    await expect(createRegion).toHaveCSS('border-top-width', '0px')
    await expect(createRegion).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    for (const label of ['创建脚本', '图片生成', '视频生成', '导入素材']) {
      const button = createRegion.getByRole('button', { name: new RegExp(label) })
      await expect(button).toBeVisible()
      await expect(button).toHaveCSS('min-height', width <= 420 ? '60px' : width <= 760 ? '62px' : '68px')
    }
    await expect(createRegion.getByText('双击画布自由生成节点')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('empty-studio.png') })
    await createRegion.getByRole('button', { name: '创建脚本' }).click()
    await expect(page.locator('.react-flow__node')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '生成分镜' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('hidden-extras.png') })
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}

test('空白画布提供贴近工作台的创建入口，点击后创建文本节点', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/143**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 143, title: '创作工作台', status: 'active', revision: 1 },
    })
  })
  await page.goto('/canvas/143')
  const studio = page.getByRole('region', { name: '开始创作' })
  await expect(studio).toBeVisible()
  await expect(studio.getByRole('button', { name: /图片生成/ })).toBeVisible()
  const toolbar = page.locator('.canvas-view [class*="toolbar"]')
  await expect(toolbar).toBeVisible()
  const panButton = toolbar.getByRole('button', { name: /拖动/ })
  await panButton.hover()
  const panLabel = panButton.locator('[class*="toolLabel"]')
  await expect(panLabel).toHaveCSS('opacity', '1')
  const [panButtonBounds, panLabelBounds] = await Promise.all([panButton.boundingBox(), panLabel.boundingBox()])
  expect(panButtonBounds).not.toBeNull()
  expect(panLabelBounds).not.toBeNull()
  expect(
    Math.abs(panLabelBounds!.x + panLabelBounds!.width / 2 - (panButtonBounds!.x + panButtonBounds!.width / 2)),
  ).toBeLessThan(1)
  expect(panLabelBounds!.y + panLabelBounds!.height).toBeLessThan(panButtonBounds!.y)
  const studioBounds = await studio.boundingBox()
  expect(studioBounds).not.toBeNull()
  expect(Math.abs(studioBounds!.x + studioBounds!.width / 2 - 720)).toBeLessThan(1)
  expect(Math.abs(studioBounds!.y + studioBounds!.height / 2 - 450)).toBeLessThan(1)
  const firstAction = studio.getByRole('button', { name: '创建脚本' })
  const icon = firstAction.locator('span').first()
  const label = firstAction.locator('strong')
  const [actionBounds, iconBounds, labelBounds] = await Promise.all([
    firstAction.boundingBox(),
    icon.boundingBox(),
    label.boundingBox(),
  ])
  expect(actionBounds).not.toBeNull()
  expect(iconBounds).not.toBeNull()
  expect(labelBounds).not.toBeNull()
  expect(iconBounds!.x).toBeGreaterThanOrEqual(actionBounds!.x)
  expect(iconBounds!.x + iconBounds!.width).toBeLessThan(labelBounds!.x)
  expect(Math.abs(labelBounds!.x + labelBounds!.width / 2 - (actionBounds!.x + actionBounds!.width / 2))).toBeLessThan(
    1,
  )
  await expect(icon).toHaveCSS('color', 'rgb(6, 17, 15)')
  const viewport = page.locator('.react-flow__viewport')
  const transformBeforeDoubleClick = await viewport.evaluate((element) => getComputedStyle(element).transform)
  await page.locator('.react-flow__pane').dispatchEvent('dblclick', { bubbles: true })
  await expect
    .poll(() => viewport.evaluate((element) => getComputedStyle(element).transform))
    .toBe(transformBeforeDoubleClick)
  await page.screenshot({ path: testInfo.outputPath('canvas-empty-studio.png') })
  await studio.getByRole('button', { name: '创建脚本' }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  const selectedNode = page.locator('.react-flow__node.selected')
  await expect(selectedNode).toBeVisible()
  await expect
    .poll(() => selectedNode.evaluate((element) => getComputedStyle(element, '::after').animationName))
    .toBe('canvas-node-selection-ripple')
  await expect(page.getByRole('button', { name: '生成分镜' })).toBeVisible()
  await expect(studio).toHaveCount(0)
  expectNoUnexpectedApi(api)
})

test('旧版首次剧本引导标记不会遮挡完整创作节点入口', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  await page.addInitScript(() => localStorage.setItem('zzh_canvas_script_creation_pending_144', '1'))
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  let revision = 1
  const saved = new Map<string, any>()
  await page.route('**/api/v1/canvases/144**', (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON()
      for (const item of body.mutations || []) {
        if (item.op === 'delete') saved.delete(item.element_id)
        else saved.set(item.element_id, item)
      }
      revision++
      return route.fulfill({ json: { sync_revision: revision } })
    }
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: [...saved.values()],
            state: {},
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 144, title: '首次脚本创作', status: 'active', revision },
    })
  })

  await page.goto('/canvas/144')
  const studio = page.getByRole('region', { name: '开始创作' })
  await expect(studio).toBeVisible()
  for (const label of ['创建脚本', '图片生成', '视频生成', '导入素材']) {
    await expect(studio.getByRole('button', { name: new RegExp(label) })).toBeVisible()
  }
  await expect(page.getByRole('region', { name: '画布开始指南' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('first-creation-entry.png') })
  await studio.getByRole('button', { name: '创建脚本' }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '生成分镜' })).toBeVisible()
  await expect(studio).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('script-node-created.png') })
  await page.reload()
  await expect(page.locator('.canvas-view')).toBeVisible()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByRole('region', { name: '画布开始指南' })).toHaveCount(0)
  expectNoUnexpectedApi(api)
})
