import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`画布直达自动定位已授权空间 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { code: 0, data: [] } }))
    const reads: number[] = []
    const writes: number[] = []
    await page.route('**/api/v1/canvases/110/elements**', (route) => {
      const url = new URL(route.request().url())
      const ws = Number(url.searchParams.get('workspace_id'))
      if (route.request().method() !== 'GET') {
        writes.push(ws)
        return route.fulfill({ json: { revision: 2 } })
      }
      reads.push(ws)
      if (ws !== 22)
        return route.fulfill({ status: 404, json: { code_string: 'CANVAS_NOT_FOUND', message: '画布不存在' } })
      return route.fulfill({
        json: {
          elements: [
            {
              element_id: 'image-1',
              kind: 'node',
              op: 'upsert',
              payload: {
                id: 'image-1',
                type: 'image',
                position: { x: 200, y: 100 },
                data: { kind: 'image', prompt: '目标空间画布' },
              },
            },
          ],
          sync_revision: 1,
          history_floor_revision: 0,
          has_more: false,
        },
      })
    })
    await page.goto('/canvas/110')
    await expect(page.getByRole('button', { name: '图片 · 目标空间画布' })).toBeVisible()
    expect(reads).toContain(21)
    expect(reads).toContain(22)
    expect(writes).toEqual([])
    await expect(page.getByText('暂时无法读取已保存内容', { exact: false })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`resolved-${width}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '添加节点' }).click()
    await page
      .getByRole('menu', { name: '创建或添加节点' })
      .getByRole('menuitem', { name: /文本节点/ })
      .click()
    await expect.poll(() => writes.length).toBeGreaterThan(0)
    expect(writes.every((workspace) => workspace === 22)).toBe(true)
  })
}

for (const width of [1440, 768, 390]) {
  test(`画布不存在时不展示旧草稿或声称已保存 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.addInitScript(() =>
      localStorage.setItem(
        'zzh_canvas_draft_p110',
        JSON.stringify({
          boundCanvasId: 110,
          nodes: [
            { id: 'old', type: 'text', data: { kind: 'text', text: '其他空间的草稿' }, position: { x: 0, y: 0 } },
          ],
          edges: [],
        }),
      ),
    )
    await page.route('**/api/v1/canvases/110/elements**', (route) =>
      route.fulfill({ status: 404, json: { message: '画布不存在' } }),
    )
    await page.goto('/canvas/110')
    await expect(page.getByRole('alert')).toContainText('画布不存在或当前账号无权访问')
    await expect(page.getByText('其他空间的草稿')).toHaveCount(0)
    await expect(page.getByText('已保存到云端')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '画布不存在或当前账号无权访问' })).toBeVisible()
    await expect(page.getByRole('button', { name: '返回画布列表' })).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`canvas-missing-${width}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '返回画布列表' }).click()
    await expect(page).toHaveURL(/\/canvas$/)
  })
}

test('查询异常时允许重试而不是判断画布不存在', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  let fail = true
  await page.route('**/api/v1/canvases/110/elements**', (route) =>
    fail
      ? route.fulfill({ status: 503, json: { message: '服务不可用' } })
      : route.fulfill({ json: { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false } }),
  )
  await page.goto('/canvas/110')
  await expect(page.getByRole('alert')).toContainText('暂时无法确认画布')
  fail = false
  await page.getByRole('button', { name: '重试' }).click()
  await expect(page.getByText('开启你的漫剧创作')).toBeVisible()
})

test('其他空间查询异常时不能断言画布不存在', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases/110/elements**', (route) => {
    const workspace = new URL(route.request().url()).searchParams.get('workspace_id')
    return route.fulfill({ status: workspace === '22' ? 503 : 404, json: { message: '读取失败' } })
  })
  await page.goto('/canvas/110')
  await expect(page.getByRole('alert')).toContainText('暂时无法确认画布')
})

test('多个空间具有相同编号时不自动切换', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases/110/elements**', (route) => {
    const workspace = new URL(route.request().url()).searchParams.get('workspace_id')
    return workspace === '21'
      ? route.fulfill({ status: 404, json: { message: '画布不存在' } })
      : route.fulfill({ json: { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false } })
  })
  await page.goto('/canvas/110')
  await expect(page.getByRole('alert')).toContainText('多个空间中存在相同编号的画布')
  await expect(page.getByText('已保存到云端')).toHaveCount(0)
})

test('从空画布打开最近项目会重新绑定画布', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases?**', (route) =>
    route.fulfill({ json: { items: [{ id: 111, title: '另一个画布' }] } }),
  )
  const requests: number[] = []
  await page.route('**/api/v1/canvases/*/elements**', (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/')[4])
    requests.push(id)
    const elements =
      id === 111
        ? [
            {
              element_id: 'other',
              kind: 'node',
              op: 'upsert',
              payload: {
                id: 'other',
                type: 'image',
                position: { x: 100, y: 100 },
                data: { kind: 'image', prompt: '另一个画布内容' },
              },
            },
          ]
        : []
    return route.fulfill({ json: { elements, sync_revision: 1, history_floor_revision: 0, has_more: false } })
  })
  await page.goto('/canvas/110')
  await page.getByRole('button', { name: '打开画布 另一个画布' }).click()
  await expect(page).toHaveURL(/\/canvas\/111$/)
  await expect(page.getByRole('button', { name: '图片 · 另一个画布内容' })).toBeVisible()
  expect(requests).toContain(111)
})
