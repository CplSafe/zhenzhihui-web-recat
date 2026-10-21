import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('整理全部将工作流分区、保留分组，重复整理稳定且一步撤销', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  const patches: Array<{ mutations?: Array<{ kind: string; payload?: { position?: unknown } }> }> = []
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
      patches.push(route.request().postDataJSON())
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
                  data: { kind: 'image', title: n.id, groupId: n.groupId },
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
  const before = await positions()
  await page.locator('.react-flow__pane').click({ position: { x: 950, y: 550 }, button: 'right' })
  await page.getByRole('button', { name: '整理全部布局', exact: true }).click()
  await expect.poll(positions).not.toEqual(before)
  const arranged = await positions()
  await expect
    .poll(() => patches.some((p) => p.mutations?.some((m) => m.kind === 'node' && m.payload?.position)))
    .toBe(true)
  await expect(page.locator('.canvas-group-frame')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge')).toHaveCount(2)
  // fitView 的动画只改变视口；节点位置不能跟着发生第二次变化。
  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Alt+Shift+f')
  await expect(page.getByText('已经是整理好的布局', { exact: true })).toBeVisible()
  expect(await positions()).toEqual(arranged)
  await page.keyboard.press('Control+z')
  await expect.poll(positions).toEqual(before)
  expectNoUnexpectedApi(api)
})
