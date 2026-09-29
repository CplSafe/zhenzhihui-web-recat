import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

/**
 * 右键菜单的「添加节点」必须和左侧工具栏给出同一份类型清单。
 *
 * 锁的是用户实测反馈：右键菜单只有文本/图片/视频，漏了「视频剪辑」，
 * 于是时间线节点只能从左侧工具栏建——右键这条路看起来根本没有这个功能。
 * 顺带锁住尺寸：时间线卡片要按 460×400 建出来，不能落成默认的 250×250
 * 再靠「把过小的时间线撑大」的副作用事后补救。
 */
test('右键菜单能建出视频剪辑节点，且按时间线尺寸落位', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases/112**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 112, title: 'Add node menu', status: 'active', revision: 1 },
    })
  })

  await page.goto('/canvas/112')
  const pane = page.locator('.react-flow__pane')
  await expect(pane).toBeVisible()
  await expect(page.locator('.react-flow__node')).toHaveCount(0)

  await pane.click({ button: 'right', position: { x: 700, y: 420 } })
  const menu = page.locator('.canvas-context-menu')
  await expect(menu).toBeVisible()
  // 四种类型齐全，且与左侧工具栏同名同序
  await expect(menu.getByRole('button', { name: '文本节点' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '图片节点' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '视频节点' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '视频剪辑' })).toBeVisible()

  await menu.getByRole('button', { name: '视频剪辑' }).click()
  await expect(menu).toBeHidden()

  const node = page.locator('.react-flow__node')
  await expect(node).toHaveCount(1)
  // 尺寸写在节点内联样式上（React Flow 把 node.style 直接铺到包裹元素），不受画布缩放影响
  await expect(node).toHaveAttribute('style', /width:\s*460px/)
  await expect(node).toHaveAttribute('style', /height:\s*400px/)

  expectNoUnexpectedApi(api)
})

test('文本节点可以连接到另一个文本节点', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases/113**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 113, title: 'Text connection', status: 'active', revision: 1 },
    })
  })

  await page.goto('/canvas/113')
  const pane = page.locator('.react-flow__pane')
  await pane.click({ button: 'right', position: { x: 520, y: 420 } })
  await page.locator('.canvas-context-menu').getByRole('button', { name: '文本节点' }).click()

  const firstNode = page.locator('.react-flow__node').first()
  await expect(firstNode).toBeVisible()
  await firstNode.hover()
  await firstNode.getByRole('button', { name: '添加下一步' }).last().click()

  const addMenu = page.locator('.canvas-add-menu')
  const textTarget = addMenu.getByRole('button', { name: /^文本节点/ })
  await expect(textTarget).toBeEnabled()
  await textTarget.click()

  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  const headersStayAboveNodesInOneLine = await page.locator('.react-flow__node').evaluateAll((nodeElements) =>
    nodeElements.every((nodeElement) => {
      const card = nodeElement.querySelector<HTMLElement>('.canvas-default-node')
      const header = nodeElement.querySelector<HTMLElement>('.canvas-node-header')
      const label = nodeElement.querySelector<HTMLElement>('.canvas-node-header__label')
      if (!card || !header || !label) return false
      const cardBounds = card.getBoundingClientRect()
      const headerBounds = header.getBoundingClientRect()
      return headerBounds.bottom <= cardBounds.top + 0.5 && getComputedStyle(label).whiteSpace === 'nowrap'
    }),
  )
  expect(headersStayAboveNodesInOneLine).toBe(true)
  const bodiesKeepNodeSize = await page.locator('.react-flow__node').evaluateAll((nodeElements) =>
    nodeElements.every((nodeElement) => {
      const card = nodeElement.querySelector<HTMLElement>('.canvas-default-node')
      const body = nodeElement.querySelector<HTMLElement>('.canvas-node-body')
      if (!card || !body) return false
      const cardBounds = card.getBoundingClientRect()
      const bodyBounds = body.getBoundingClientRect()
      return Math.abs(bodyBounds.width - cardBounds.width) < 1 && Math.abs(bodyBounds.height - cardBounds.height) < 1
    }),
  )
  expect(bodiesKeepNodeSize).toBe(true)
  expectNoUnexpectedApi(api)
})

test('文本转为本节点提示词写入正文而不是重命名字段', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases/114**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? Number(url.searchParams.get('after_revision')) > 0
          ? { elements: [], sync_revision: 2, history_floor_revision: 0, has_more: false }
          : {
              elements: [
                {
                  element_id: 'text-source',
                  kind: 'node',
                  op: 'upsert',
                  payload: {
                    id: 'text-source',
                    type: 'text',
                    position: { x: 220, y: 300 },
                    data: { kind: 'text', text: '上游篮球文案' },
                  },
                },
                {
                  element_id: 'text-target',
                  kind: 'node',
                  op: 'upsert',
                  payload: {
                    id: 'text-target',
                    type: 'text',
                    position: { x: 620, y: 300 },
                    data: { kind: 'text', text: '本节点已有正文' },
                  },
                },
                {
                  element_id: 'text-edge',
                  kind: 'edge',
                  op: 'upsert',
                  payload: {
                    id: 'text-edge',
                    source: 'text-source',
                    target: 'text-target',
                    data: { slotIndex: 0 },
                  },
                },
              ],
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
        : { id: 114, title: 'Adopt text', status: 'active', revision: 1 },
    })
  })

  await page.goto('/canvas/114')
  await page.locator('.react-flow__node[data-id="text-target"]').click()
  const panel = page.locator('[class*="panel"]').filter({ has: page.getByRole('button', { name: '转为本节点提示词' }) })
  const textBody = page.locator('.canvas-panel-area textarea')
  await panel.getByRole('button', { name: '转为本节点提示词' }).click()

  await expect(textBody).toHaveValue('上游篮球文案\n\n本节点已有正文')
  await expect(page.locator('.react-flow__edge')).toHaveCount(0)
  await expect(page.locator('.canvas-node-header input')).toHaveCount(0)
  expectNoUnexpectedApi(api)
})

test('图片、文本、视频可以按语义反复接成新的下游节点', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases/115**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 115, title: 'Reusable connections', status: 'active', revision: 1 },
    })
  })

  await page.goto('/canvas/115')
  const pane = page.locator('.react-flow__pane')
  await pane.click({ button: 'right', position: { x: 360, y: 420 } })
  await page.locator('.canvas-context-menu').getByRole('button', { name: '图片节点' }).click()

  // 图片 → 文本：用于基于素材做视觉理解/分镜文案。
  const imageNode = page.locator('.react-flow__node').first()
  await imageNode.hover()
  await imageNode.getByRole('button', { name: '添加下一步' }).last().click()
  const imageNextMenu = page.locator('.canvas-add-menu')
  await expect(imageNextMenu.getByRole('button', { name: /^文本节点/ })).toBeEnabled()
  await imageNextMenu.getByRole('button', { name: /^文本节点/ }).click()
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  await expect(page.locator('.canvas-edge-role-label').filter({ hasText: '视觉理解' })).toHaveCount(1)

  // 文本 → 视频：文本作为视频提示词。
  const textNode = page.locator('.react-flow__node').nth(1)
  await textNode.hover()
  await textNode.getByRole('button', { name: '添加下一步' }).last().click()
  const textNextMenu = page.locator('.canvas-add-menu')
  await expect(textNextMenu.getByRole('button', { name: /^视频节点/ })).toBeEnabled()
  await textNextMenu.getByRole('button', { name: /^视频节点/ }).click()
  await expect(page.locator('.react-flow__edge')).toHaveCount(2)
  await expect(page.locator('.canvas-edge-role-label').filter({ hasText: '提示词' })).toHaveCount(1)

  // 已作为下游的视频仍可以继续回拉出文本节点，形成新的分支/处理链。
  const videoNode = page.locator('.react-flow__node').nth(2)
  await videoNode.hover()
  await videoNode.getByRole('button', { name: '添加下一步' }).last().click()
  const videoNextMenu = page.locator('.canvas-add-menu')
  await expect(videoNextMenu.getByRole('button', { name: /^文本节点/ })).toBeEnabled()
  await videoNextMenu.getByRole('button', { name: /^文本节点/ }).click()
  await expect(page.locator('.react-flow__edge')).toHaveCount(3)
  await expect(page.locator('.canvas-edge-role-label').filter({ hasText: '视觉理解' })).toHaveCount(2)

  expectNoUnexpectedApi(api)
})
