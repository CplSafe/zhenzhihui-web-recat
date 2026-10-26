import { expect, test, type Page } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

async function setup(page: Page, third = false) {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  let revision = 1
  const mutations: Array<{ kind: string; op: string; payload?: { source?: string; target?: string } }> = []
  await page.route('**/api/v1/canvases/130**', (route) => {
    if (route.request().method() === 'PATCH') {
      mutations.push(...(route.request().postDataJSON().mutations || []))
      return route.fulfill({ json: { revision: ++revision, sync_revision: revision } })
    }
    const url = new URL(route.request().url())
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements:
              Number(url.searchParams.get('after_revision')) > 0
                ? []
                : [
                    ...(third ? ['A', 'B', 'C'] : ['A', 'B']).map((id, index) => ({
                      element_id: id,
                      kind: 'node',
                      op: 'upsert',
                      payload: {
                        id,
                        type: 'text',
                        position: { x: 80 + index * 400, y: 100 },
                        style: { width: 220, height: 160 },
                        data: { kind: 'text', title: id, text: `正文${id}` },
                      },
                    })),
                    ...(third
                      ? [
                          ['A', 'B'],
                          ['B', 'C'],
                        ]
                      : [['A', 'B']]
                    ).map(([source, target]) => ({
                      element_id: `${source}-${target}`,
                      kind: 'edge',
                      op: 'upsert',
                      payload: {
                        id: `${source}-${target}`,
                        source,
                        target,
                        sourceHandle: `${source}-right-source`,
                        targetHandle: `${target}-left-target`,
                        data: { slotIndex: 0 },
                      },
                    })),
                  ],
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 130, title: '参考快捷键回归', revision },
    })
  })
  await page.goto('/canvas/130')
  await expect(page.locator('.react-flow__node')).toHaveCount(third ? 3 : 2)
  await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('100')
  await expect
    .poll(() => page.locator('.react-flow__viewport').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a))
    .toBe(1)
  return { api, mutations }
}
async function dragA(page: Page) {
  const box = await page.locator('.react-flow__node[data-id="A"] .canvas-node-body').boundingBox()
  if (!box) throw new Error('A节点不可见')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 85, box.y + box.height / 2 + 35, { steps: 12 })
  await page.mouse.up()
}
const positions = (page: Page) =>
  page
    .locator('.react-flow__node')
    .evaluateAll((nodes) =>
      Object.fromEntries(nodes.map((n) => [n.getAttribute('data-id'), (n as HTMLElement).style.transform])),
    )

for (const width of [1440, 900]) {
  test(`截图快捷键：Tab、V/H、Ctrl+0、Alt整理、成组解组和删除撤销 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const { api } = await setup(page)
    const root = page.locator('.canvas-view')
    await root.focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('.canvas-context-menu').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.canvas-context-menu')).toHaveCount(0)
    await page.keyboard.press('Shift+Tab')
    await expect(root).not.toBeFocused()
    await root.focus()
    const original = await positions(page)
    await page.keyboard.press('h')
    await expect(root).toHaveClass(/is-space-panning/)
    const viewBefore = await page.locator('.react-flow__viewport').getAttribute('style')
    await dragA(page)
    await expect.poll(() => page.locator('.react-flow__viewport').getAttribute('style')).not.toBe(viewBefore)
    expect(await positions(page)).toEqual(original)
    await page.keyboard.press('v')
    await expect(root).not.toHaveClass(/is-space-panning/)
    await page.keyboard.press('Control+a')
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
    for (const [group, ungroup] of [
      ['Control+g', 'Alt+Shift+g'],
      ['Alt+g', 'Control+Shift+g'],
    ]) {
      await page.keyboard.press(group)
      await expect(page.locator('.canvas-group-frame')).toHaveCount(1)
      await page.keyboard.press(ungroup)
      await expect(page.locator('.canvas-group-frame')).toHaveCount(0)
    }
    await page.keyboard.press('Alt+Shift+f')
    await expect.poll(() => positions(page)).not.toEqual(original)
    await page.keyboard.press('Control+z')
    await expect.poll(() => positions(page)).toEqual(original)
    await page.keyboard.press('Control+0')
    await expect
      .poll(async () => {
        const boxes = await page.locator('.react-flow__node').evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect()
            return { x: r.x, right: r.right, y: r.y, bottom: r.bottom }
          }),
        )
        return boxes.every((b) => b.x >= 0 && b.right <= width && b.y >= 0 && b.bottom <= 900)
      })
      .toBe(true)
    // 撤销恢复布局后会清除选中态；重新选择再验证 Delete。
    await page.keyboard.press('Control+a')
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
    await page.keyboard.press('Delete')
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(page.locator('.react-flow__node')).toHaveCount(2)
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)
    await page.keyboard.press('Shift+/')
    const help = page.getByRole('dialog', { name: '画布快捷键' })
    for (const name of ['创作', '缩放', '移动画布', '其他'])
      await expect(help.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(help.getByText('Tab', { exact: true })).toBeVisible()
    await expect(help.getByText('Ctrl + 0', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`reference-shortcuts-${width}.png`) })
    expectNoUnexpectedApi(api)
  })
}

for (const withEdges of [false, true]) {
  test(`${withEdges ? 'Ctrl+Alt' : 'Alt'}拖动复制选中节点${withEdges ? '及内部连线' : '而不复制连线'}，不复制外部连线并可撤销`, async ({
    page,
  }, testInfo) => {
    const { api, mutations } = await setup(page, true)
    await page.locator('.react-flow__node[data-id="A"] .canvas-node-body').click()
    await page.keyboard.down('Control')
    await page.locator('.react-flow__node[data-id="B"] .canvas-node-body').click()
    await page.keyboard.up('Control')
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
    await page.locator('.canvas-view').focus()
    const before = await positions(page)
    if (withEdges) await page.keyboard.down('Control')
    await page.keyboard.down('Alt')
    await dragA(page)
    await page.keyboard.up('Alt')
    if (withEdges) await page.keyboard.up('Control')
    await expect(page.locator('.react-flow__node')).toHaveCount(5)
    await expect(page.locator('.react-flow__edge')).toHaveCount(withEdges ? 3 : 2)
    const created = await page
      .locator('.react-flow__node')
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('data-id')!).filter((id) => !['A', 'B', 'C'].includes(id)),
      )
    if (withEdges)
      await expect
        .poll(() =>
          mutations.some(
            (m) =>
              m.kind === 'edge' &&
              m.op === 'upsert' &&
              created.includes(m.payload?.source || '') &&
              created.includes(m.payload?.target || ''),
          ),
        )
        .toBe(true)
    const after = await positions(page)
    expect(after.C).toEqual(before.C)
    expect([after.A, after.B]).not.toEqual([before.A, before.B])
    await page.screenshot({
      path: testInfo.outputPath(withEdges ? 'ctrl-alt-drag-with-edges.png' : 'alt-drag-nodes-only.png'),
    })
    await page.locator('.canvas-view').focus()
    await page.keyboard.press('Control+z')
    await expect(page.locator('.react-flow__node')).toHaveCount(3)
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)
    await expect.poll(() => positions(page)).toEqual(before)
    expectNoUnexpectedApi(api)
  })
}
