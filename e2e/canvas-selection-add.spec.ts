import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'
type CanvasElementMutation = {
  element_id: string
  kind: string
  op: 'upsert' | 'delete'
  payload?: Record<string, unknown>
}

for (const width of [1440, 900]) {
  test(`多选加号创建下游、取消、缩放、撤销和保存恢复 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    const elements = new Map<string, CanvasElementMutation>(
      ['A', 'B'].map((id, index) => [
        id,
        {
          element_id: id,
          kind: 'node',
          op: 'upsert',
          payload: {
            id,
            type: 'text',
            position: { x: 100 + index * 400, y: 100 },
            style: { width: 250, height: 200 },
            data: { kind: 'text', title: id, text: `来源${id}` },
          },
        },
      ]),
    )
    let revision = 1
    await page.route('**/api/v1/canvases/126**', async (route) => {
      if (route.request().method() === 'PATCH') {
        const { mutations = [] } = route.request().postDataJSON()
        for (const item of mutations as CanvasElementMutation[]) {
          if (item.op === 'delete') elements.delete(item.element_id)
          else elements.set(item.element_id, item)
        }
        return route.fulfill({ json: { sync_revision: ++revision } })
      }
      const url = new URL(route.request().url())
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [...elements.values()],
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 126, title: '多选创建下游验收', status: 'active', revision },
      })
    })
    await page.goto('/canvas/126')
    const nodes = page.locator('.react-flow__node')
    await expect(nodes).toHaveCount(2)
    const a = nodes.filter({ has: page.locator('.canvas-node-header', { hasText: 'A' }) })
    const b = page.locator('.react-flow__node[data-id="B"]')
    // 真正从空白区域拖出选框。
    let previous = ''
    let stable = 0
    await expect
      .poll(async () => {
        const current = JSON.stringify(await a.boundingBox())
        stable = current === previous ? stable + 1 : 0
        previous = current
        return stable
      })
      .toBeGreaterThanOrEqual(3)
    const ab = await a.boundingBox()
    const bb = await b.boundingBox()
    if (!ab || !bb) throw new Error('缺少节点位置')
    await page.mouse.move(ab.x - 20, ab.y - 90)
    await page.mouse.down()
    await page.mouse.move(bb.x + bb.width + 15, ab.y + 60, { steps: 15 })
    await page.mouse.up()
    const selected = page.locator('.react-flow__node.selected')
    await expect(selected).toHaveCount(2)
    const add = page.getByRole('button', { name: '从所选节点创建下游节点' })
    await expect(add).toBeVisible()
    const face = add.locator('.canvas-selection-frame__add-face')
    const hitBox = await add.boundingBox()
    if (!hitBox) throw new Error('缺少加号点击区域')
    const faceOffset = async () => {
      const visual = await face.boundingBox()
      const hit = await add.boundingBox()
      if (!visual || !hit) throw new Error('缺少加号位置')
      return {
        x: visual.x + visual.width / 2 - hit.x - hit.width / 2,
        y: visual.y + visual.height / 2 - hit.y - hit.height / 2,
      }
    }
    await page.mouse.move(hitBox.x + 47, hitBox.y + 12)
    await expect.poll(async () => (await faceOffset()).x).toBeGreaterThan(4)
    await expect.poll(async () => (await faceOffset()).y).toBeLessThan(-4)
    const offset = await faceOffset()
    expect(Math.abs(offset.x)).toBeLessThanOrEqual(8)
    expect(Math.abs(offset.y)).toBeLessThanOrEqual(8)
    expect(await add.boundingBox()).toEqual(hitBox)
    await page.screenshot({ path: testInfo.outputPath('selection-add-magnetic-hover.png') })
    await page.mouse.move(400, 180)
    await expect.poll(async () => Math.abs((await faceOffset()).x)).toBeLessThan(0.2)
    await expect.poll(async () => Math.abs((await faceOffset()).y)).toBeLessThan(0.2)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.mouse.move(hitBox.x + 47, hitBox.y + 12)
    await expect(face).toHaveCSS('transform', 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.mouse.move(400, 180)
    // 固定命中区边缘也能点击，不需要追逐发生位移的圆面。
    await page.mouse.click(hitBox.x + 47, hitBox.y + 12)
    const menu = page.locator('.canvas-add-menu')
    await expect(menu.getByRole('button', { name: /^文本节点/ })).toContainText('连接 2/2')
    await expect(menu.getByRole('button', { name: /^视频剪辑/ })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(selected).toHaveCount(2)
    await page.getByRole('button', { name: '缩小', exact: true }).click()
    const frame = page.locator('.canvas-selection-frame')
    await expect
      .poll(async () => {
        const frameBox = await frame.boundingBox()
        const bBox = await b.boundingBox()
        if (!frameBox || !bBox) return Infinity
        return Math.abs(frameBox.x + frameBox.width - bBox.x - bBox.width - 12)
      })
      .toBeLessThan(1)
    await add.click()
    await page.screenshot({ path: testInfo.outputPath('selection-add-menu.png') })
    await menu.getByRole('button', { name: /^文本节点/ }).click()
    await expect(nodes).toHaveCount(3)
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)
    await expect(selected).toHaveCount(1)
    await expect(add).toBeHidden()
    await expect.poll(() => [...elements.values()].filter((item) => item.kind === 'edge').length).toBe(2)
    await page.locator('.canvas-view').focus()
    await page.keyboard.press('Control+z')
    await expect(nodes).toHaveCount(2)
    await expect(page.locator('.react-flow__edge')).toHaveCount(0)
    await page.keyboard.press('Control+Shift+z')
    await expect(nodes).toHaveCount(3)
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)
    await expect.poll(() => [...elements.values()].filter((item) => item.kind === 'edge').length).toBe(2)
    await page.reload()
    await expect(nodes).toHaveCount(3)
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)
    await page.screenshot({ path: testInfo.outputPath('selection-created-restored.png') })
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}

test('分组多选按整批来源校验视频上限，混合类型明确连接数量', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/127**', async (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    const url = new URL(route.request().url())
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: ['video', 'video', 'text'].map((kind, i) => ({
              element_id: `source-${i}`,
              kind: 'node',
              op: 'upsert',
              payload: {
                id: `source-${i}`,
                type: kind,
                position: { x: i * 350, y: 100 },
                style: { width: 250, height: 200 },
                data: { kind, title: `来源 ${i}`, groupId: 'sources' },
              },
            })),
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 127, title: '来源限制验收', status: 'active', revision: 1 },
    })
  })
  await page.goto('/canvas/127')
  await expect(page.locator('.react-flow__node')).toHaveCount(3)
  await page.locator('.react-flow__node[data-id="source-0"]').click({ position: { x: 80, y: 80 } })
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(3)
  await page.getByRole('button', { name: '从所选节点创建下游节点' }).click()
  const menu = page.locator('.canvas-add-menu')
  await expect(menu.getByRole('button', { name: /^视频节点/ })).toBeDisabled()
  await expect(menu).toContainText('多条视频请先汇入视频剪辑节点合成')
  await expect(menu.getByRole('button', { name: /^图片节点/ })).toContainText('连接 1/3')
  await expect(menu.getByRole('button', { name: /^视频剪辑/ })).toContainText('连接 2/3')
  await page.screenshot({ path: testInfo.outputPath('selection-limits.png') })
  await menu.getByRole('button', { name: /^图片节点/ }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge')).toHaveAttribute('data-id', /source-2/)
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
