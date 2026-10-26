import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('分组描边和半透明底色可见，名称可见且仍可拖动撤销', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  const patches: Array<{ mutations?: Array<{ kind: string; payload?: { position?: unknown } }> }> = []
  const savedNames = new Map<string, string>()
  const sourceNodes = [
    { id: 'a', x: 0, y: 0, groupId: 'one' },
    { id: 'b', x: 600, y: 500, groupId: 'one' },
    { id: 'c', x: 0, y: 150 },
    { id: 'd', x: 700, y: 0 },
    { id: 'loose1', x: 300, y: 70 },
    { id: 'loose2', x: 400, y: 90 },
    { id: 'loose3', x: 500, y: 110 },
  ]
  let revision = 1
  await page.route('**/api/v1/canvases/125**', async (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON()
      patches.push(patch)
      for (const mutation of patch.mutations || []) {
        if (mutation.kind === 'node' && mutation.op === 'upsert') {
          savedNames.set(mutation.element_id, mutation.payload?.data?.groupName || '')
        }
      }
      return route.fulfill({ json: { revision: ++revision, sync_revision: revision } })
    }
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              ...sourceNodes.map((n) => ({
                element_id: n.id,
                kind: 'node',
                op: 'upsert',
                payload: {
                  id: n.id,
                  type: 'image',
                  position: { x: n.x, y: n.y },
                  style: { width: 200, height: 150 },
                  data: { kind: 'image', title: n.id, groupId: n.groupId, groupName: savedNames.get(n.id) },
                },
              })),
              ...[
                ['a', 'b'],
                ['c', 'd'],
              ].map(([source, target]) => ({
                element_id: `${source}-${target}`,
                kind: 'edge',
                op: 'upsert',
                payload: {
                  id: `${source}-${target}`,
                  source,
                  target,
                  sourceHandle: `${source}-right-source`,
                  targetHandle: `${target}-left-target`,
                },
              })),
            ],
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 125, title: '整理布局回归', revision },
    })
  })
  await page.goto('/canvas/125')
  const nodes = page.locator('.react-flow__node')
  await expect(nodes).toHaveCount(sourceNodes.length)
  const positions = () =>
    nodes.evaluateAll((elements) =>
      Object.fromEntries(elements.map((el) => [el.getAttribute('data-id'), (el as HTMLElement).style.transform])),
    )

  const frame = page.locator('.canvas-group-frame')
  await expect(frame).toHaveCSS('border-top-style', 'solid')
  await expect(frame).toHaveCSS('border-top-color', 'rgba(8, 127, 104, 0.35)')
  await expect(frame).toHaveCSS('background-color', 'rgba(31, 207, 169, 0.03)')
  await expect(frame).toHaveCSS('box-shadow', 'none')
  const headerArea = page.locator('.canvas-group-frame__header')
  await expect(headerArea).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(headerArea).toHaveCSS('border-top-width', '0px')
  await expect(headerArea).toHaveCSS('box-shadow', 'none')
  await expect(headerArea.getByRole('button', { name: '分组 1', exact: true })).toBeVisible()
  const drag = async (selector: string) => {
    const box = await page.locator(selector).boundingBox()
    if (!box) throw new Error('分组拖动入口不可见')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 35, { steps: 8 })
    await page.mouse.up()
  }
  await page.getByRole('button', { name: '缩小', exact: true }).click()
  await expect.poll(async () => (await frame.boundingBox())?.y || 0).toBeGreaterThan(90)
  const before = await positions()
  await drag('.canvas-group-frame__edge.is-top')
  await expect.poll(positions).not.toEqual(before)
  await expect(frame).toHaveClass(/is-selected/)
  await expect(frame).toHaveCSS('background-color', 'rgba(31, 207, 169, 0.07)')
  const after = await positions()
  const point = (value: string) =>
    value
      .match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!
      .slice(1)
      .map(Number)
  const delta = (id: string) => point(after[id]).map((v, i) => v - point(before[id])[i])
  expect(delta('a')[0]).toBeGreaterThan(0)
  expect(delta('a')[1]).toBeGreaterThan(0)
  expect(delta('b')[0]).toBeCloseTo(delta('a')[0], 3)
  expect(delta('b')[1]).toBeCloseTo(delta('a')[1], 3)
  expect(after.c).toEqual(before.c)
  await expect(page.locator('.react-flow__edge')).toHaveCount(2)
  await expect.poll(() => patches.some((p) => p.mutations?.some((m) => m.payload?.position))).toBe(true)
  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Control+z')
  await expect.poll(positions).toEqual(before)
  await drag('.canvas-group-frame__header')
  await expect.poll(positions).not.toEqual(before)
  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Control+z')
  await expect.poll(positions).toEqual(before)
  await expect(page.getByText('拖动移动整组', { exact: true })).toBeHidden()
  const label = frame.locator('.canvas-group-frame__label')
  await label.dblclick()
  const input = frame.getByRole('textbox', { name: '分组名' })
  await input.fill('产品展示镜头')
  await input.press('Enter')
  await expect(label).toHaveText('产品展示镜头')
  await label.dblclick()
  await input.fill('取消的名字')
  await input.press('Escape')
  await expect(label).toHaveText('产品展示镜头')
  await frame.getByRole('button', { name: '分组操作：产品展示镜头' }).click()
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  await input.fill('产品展示镜头二')
  await page.locator('.canvas-view').focus()
  await expect(label).toHaveText('产品展示镜头二')
  await page.keyboard.press('Control+z')
  await expect(label).toHaveText('产品展示镜头')
  await page.keyboard.press('Control+f')
  await page.getByRole('textbox', { name: '搜索分组、节点名称或提示词' }).fill('产品展示')
  const result = page.getByRole('option', { name: /产品展示镜头/ })
  await expect(result).toContainText('2 个节点')
  await result.click()
  await expect(frame).toHaveClass(/is-selected/)
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
  await expect
    .poll(async () => {
      const box = await frame.boundingBox()
      const size = page.viewportSize()!
      return !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height
    })
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('mint-group.png') })
  await page.setViewportSize({ width: 760, height: 800 })
  await page.getByRole('button', { name: '复位视图', exact: true }).click()
  await expect(frame).toBeVisible()
  await expect
    .poll(async () => {
      const box = await frame.boundingBox()
      return box ? box.x >= 0 && box.x + box.width <= 760 : false
    })
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('mint-group-narrow.png') })
  await expect.poll(() => savedNames.get('a')).toBe('产品展示镜头')
  expect(savedNames.get('b')).toBe('产品展示镜头')
  await page.reload()
  await expect(frame.locator('.canvas-group-frame__label')).toHaveText('产品展示镜头')
  await frame.locator('.canvas-group-frame__label').click()
  await frame.getByRole('button', { name: '分组操作：产品展示镜头' }).click()
  await page.getByRole('menuitem', { name: '解组', exact: true }).click()
  await expect(frame).toHaveCount(0)
  await expect(nodes).toHaveCount(sourceNodes.length)
  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Control+z')
  await expect(frame.locator('.canvas-group-frame__label')).toHaveText('产品展示镜头')
  expectNoUnexpectedApi(api)
})

test('打组后统一加号、空白和标题可拖，双击进入成员编辑且缩小后仍容易拖', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  const fixtures = [
    { id: 'member-a', x: 100, y: 100, width: 250, height: 200, groupId: '' },
    { id: 'member-b', x: 600, y: 100, width: 250, height: 200, groupId: '' },
    { id: 'outside', x: 450, y: 100, width: 70, height: 90, groupId: '' },
  ]
  let revision = 1
  await page.route('**/api/v1/canvases/128**', async (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: ++revision } })
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements:
              Number(new URL(route.request().url()).searchParams.get('after_revision')) > 0
                ? []
                : fixtures.map((n) => ({
                    element_id: n.id,
                    kind: 'node',
                    op: 'upsert',
                    payload: {
                      id: n.id,
                      type: 'image',
                      position: { x: n.x, y: n.y },
                      style: { width: n.width, height: n.height },
                      data: { kind: 'image', groupId: n.groupId, title: n.id },
                    },
                  })),
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 128, title: '分组交互验收', status: 'active', revision },
    })
  })
  await page.goto('/canvas/128')
  const nodes = page.locator('.react-flow__node')
  await expect(nodes).toHaveCount(3)
  const a = page.locator('.react-flow__node[data-id="member-a"]')
  const b = page.locator('.react-flow__node[data-id="member-b"]')
  const outside = page.locator('.react-flow__node[data-id="outside"]')
  const group = page.locator('.canvas-group-frame')
  await a.click({ position: { x: 60, y: 70 } })
  await b.locator('.canvas-node-header').click({ modifiers: ['Control'] })
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
  await page.getByRole('button', { name: '打组', exact: true }).click()
  await expect(group).toHaveCount(1)
  await a.hover()
  await expect(a.locator('.canvas-handle-mover').first()).toBeHidden()
  await expect(b.locator('.canvas-handle-mover').first()).toBeHidden()
  const plus = page.getByRole('button', { name: '从所选节点创建下游节点' })
  await expect(plus).toBeVisible()
  await page.mouse.move(900, 180)
  await expect
    .poll(async () => {
      const frame = await group.boundingBox()
      const button = await plus.boundingBox()
      return frame && button ? Math.abs(button.x + button.width / 2 - frame.x - frame.width) : Infinity
    })
    .toBeLessThan(1)
  const positions = () =>
    nodes.evaluateAll((items) =>
      Object.fromEntries(items.map((node) => [node.getAttribute('data-id'), (node as HTMLElement).style.transform])),
    )
  const before = await positions()
  const dragAt = async (x: number, y: number) => {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 60, y + 35, { steps: 10 })
    await page.mouse.up()
  }
  const ab = await a.boundingBox()
  const bb = await b.boundingBox()
  if (!ab || !bb) throw new Error('缺少节点位置')
  // 两个成员之间的空白区域；组框里还有无关节点，不能被一起带走。
  await dragAt((ab.x + ab.width + bb.x) / 2, ab.y + ab.height * 0.85)
  await expect.poll(positions).not.toEqual(before)
  const after = await positions()
  expect(after['member-a']).not.toEqual(before['member-a'])
  expect(after['member-b']).not.toEqual(before['member-b'])
  expect(after.outside).toEqual(before.outside)
  await expect(page.locator('.canvas-view')).toBeFocused()
  await page.keyboard.press('Control+z')
  await expect.poll(positions).toEqual(before)
  const header = await page.locator('.canvas-group-frame__header').boundingBox()
  if (!header) throw new Error('缺少组标题栏')
  await dragAt(header.x + header.width * 0.7, header.y + header.height / 2)
  await expect.poll(positions).not.toEqual(before)
  await expect(page.locator('.canvas-view')).toBeFocused()
  await page.keyboard.press('Control+z')
  await expect.poll(positions).toEqual(before)
  // 同框中的无关节点仍然可以独立点击，不被分组背景吞掉。
  await outside.click({ position: { x: 30, y: 40 } })
  await expect(outside).toHaveClass(/selected/)
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
  await a.locator('.canvas-node-body').dblclick({ position: { x: 50, y: 60 } })
  await expect(group).toHaveClass(/is-editing/)
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
  await a.hover()
  await expect(a.getByRole('button', { name: '添加下一步' }).last()).toBeVisible()
  await expect(plus).toBeHidden()
  const memberBefore = await positions()
  const memberHeader = await a.locator('.canvas-node-body').boundingBox()
  if (!memberHeader) throw new Error('缺少成员拖动入口')
  await dragAt(memberHeader.x + 20, memberHeader.y + 30)
  await expect.poll(positions).not.toEqual(memberBefore)
  expect((await positions())['member-b']).toEqual(memberBefore['member-b'])
  expect((await positions()).outside).toEqual(memberBefore.outside)
  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Control+z')
  await expect.poll(positions).toEqual(memberBefore)
  await expect(group).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('group-member-editing.png') })
  await expect(group.getByRole('button', { name: '退出编辑' })).toBeVisible()
  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Escape')
  await expect(group).not.toHaveClass(/is-editing/)
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
  await a.locator('.canvas-node-body').dblclick({ position: { x: 50, y: 60 } })
  await expect(group).toHaveClass(/is-editing/)
  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Escape')
  await expect(group).not.toHaveClass(/is-editing/)
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
  await a.locator('.canvas-node-body').dblclick({ position: { x: 50, y: 60 } })
  await expect(group).toHaveClass(/is-editing/)
  await page.locator('.react-flow__pane').click({ position: { x: 1100, y: 180 } })
  await expect(group).not.toHaveClass(/is-editing/)
  await a.click({ position: { x: 60, y: 70 } })
  await page.getByRole('button', { name: '缩小', exact: true }).click({ clickCount: 3, delay: 150 })
  const edge = page.locator('.canvas-group-frame__edge.is-bottom')
  await expect.poll(async () => (await edge.boundingBox())?.height || 0).toBeCloseTo(16, 0)
  const edgeBox = await edge.boundingBox()
  if (!edgeBox) throw new Error('缺少拖动边缘')
  const lowZoomBefore = await positions()
  await dragAt(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2)
  await expect.poll(positions).not.toEqual(lowZoomBefore)
  await page.screenshot({ path: testInfo.outputPath('group-drag-low-zoom.png') })
  await plus.click()
  await expect(page.locator('.canvas-add-menu')).toBeVisible()
  const finalHeader = await page.locator('.canvas-group-frame__header').boundingBox()
  if (!finalHeader) throw new Error('缺少标题栏')
  await dragAt(finalHeader.x + finalHeader.width / 2, finalHeader.y + finalHeader.height / 2)
  await expect(page.locator('.canvas-add-menu')).toBeHidden()
  await expect(nodes).toHaveCount(3)
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
