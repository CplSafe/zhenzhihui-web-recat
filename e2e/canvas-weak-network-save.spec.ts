import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

const baseNode = { id: 'one', type: 'text', position: { x: 120, y: 120 }, data: { text: '原始内容', kind: 'text' } }
const remoteNode = { id: 'two', type: 'text', position: { x: 460, y: 120 }, data: { kind: 'text', text: '同事新内容' } }

test('恢复未同步草稿并保留团队新增节点，云端确认前显示等待', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(
    ({ baseNode }) => {
      localStorage.setItem(
        'zzh_canvas_draft_u7_w21_p151',
        JSON.stringify({
          nodes: [{ ...baseNode, data: { ...baseNode.data, text: '本机未同步内容' } }],
          edges: [],
          textContents: { one: '本机未同步内容' },
          boundCanvasId: 151,
          pendingSync: true,
          syncBaseline: { nodes: [baseNode], edges: [] },
          updatedAt: Date.now(),
        }),
      )
    },
    { baseNode },
  )
  let savedBody: any
  let releaseSave!: () => void
  const pendingSave = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/151**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') {
      savedBody = route.request().postDataJSON()
      await pendingSave
      return route.fulfill({ json: { sync_revision: 3 } })
    }
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: [baseNode, remoteNode].map((node) => ({
              element_id: node.id,
              kind: 'node',
              op: 'upsert',
              payload: node,
            })),
            sync_revision: 2,
            has_more: false,
          }
        : { id: 151, title: '弱网恢复', revision: 2 },
    })
  })
  await page.goto('/canvas/151')
  await expect(page.getByText('本机未同步内容', { exact: true })).toBeVisible()
  await expect(page.getByText('同事新内容', { exact: true })).toBeVisible()
  await expect.poll(() => Boolean(savedBody)).toBe(true)
  await expect(page.getByText('云端保存中…')).toBeVisible()
  expect(savedBody.mutations).toEqual([expect.objectContaining({ element_id: 'one', op: 'upsert' })])
  await page.screenshot({ path: testInfo.outputPath('recovery-saving.png') })
  releaseSave()
  await expect(page.getByText('已保存到云端')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('zzh_canvas_draft_u7_w21_p151') || '{}').pendingSync),
    )
    .toBe(false)
})

test('确定性错误不被后台同步循环反复提交', async ({ page }) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(
    ({ baseNode }) => {
      localStorage.setItem(
        'zzh_canvas_draft_u7_w21_p152',
        JSON.stringify({
          nodes: [{ ...baseNode, data: { ...baseNode.data, text: '修改内容' } }],
          edges: [],
          textContents: { one: '修改内容' },
          boundCanvasId: 152,
          pendingSync: true,
          syncBaseline: { nodes: [baseNode], edges: [] },
          updatedAt: Date.now(),
        }),
      )
    },
    { baseNode },
  )
  let saves = 0
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/152**', (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') {
      saves++
      return route.fulfill({ status: 400, json: { message: '请求内容无效' } })
    }
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: [{ element_id: baseNode.id, kind: 'node', op: 'upsert', payload: baseNode }],
            sync_revision: 1,
            has_more: false,
          }
        : { id: 152, title: '错误恢复', revision: 1 },
    })
  })
  await page.clock.install()
  await page.goto('/canvas/152')
  await expect(page.getByText('保存失败，修改暂存在本机；请检查内容后重试')).toBeVisible()
  expect(saves).toBe(1)
  await page.clock.runFor(15000)
  expect(saves).toBe(1)
  await page.getByRole('button', { name: '返回无限画布' }).click()
  await expect(page.getByRole('alertdialog', { name: '画布尚未保存' })).toBeVisible()
})

test('同一节点的本机和云端修改冲突时，拒绝覆盖保留草稿', async ({ page }) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(
    ({ baseNode }) => {
      localStorage.setItem(
        'zzh_canvas_draft_u7_w21_p153',
        JSON.stringify({
          nodes: [{ ...baseNode, data: { ...baseNode.data, text: '本机内容' } }],
          edges: [],
          textContents: { one: '本机内容' },
          boundCanvasId: 153,
          pendingSync: true,
          syncBaseline: { nodes: [baseNode], edges: [] },
          updatedAt: Date.now(),
        }),
      )
    },
    { baseNode },
  )
  let saves = 0
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/153**', (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') {
      saves++
      return route.fulfill({ json: { sync_revision: 3 } })
    }
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'one',
                kind: 'node',
                op: 'upsert',
                payload: { ...baseNode, data: { ...baseNode.data, text: '同事更新' } },
              },
            ],
            sync_revision: 2,
            has_more: false,
          }
        : { id: 153, title: '冲突恢复', revision: 2 },
    })
  })
  await page.goto('/canvas/153')
  const dialog = page.getByRole('alertdialog', { name: '恢复本机修改' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '暂不恢复' }).click()
  await expect(page.getByText('本机修改尚未恢复，暂不能保存；请返回后重新打开画布')).toBeVisible()
  expect(saves).toBe(0)
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('zzh_canvas_draft_u7_w21_p153') || '{}'))
  expect(draft.pendingSync).toBe(true)
  expect(draft.textContents.one).toBe('本机内容')
})

test('旧版草稿与云端不同时不静默覆盖本机草稿', async ({ page }) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(
    ({ baseNode }) => {
      localStorage.setItem(
        'zzh_canvas_draft_u7_w21_p155',
        JSON.stringify({
          nodes: [{ ...baseNode, data: { ...baseNode.data, text: '旧版本本机内容' } }],
          edges: [],
          textContents: { one: '旧版本本机内容' },
          boundCanvasId: 155,
          updatedAt: Date.now(),
        }),
      )
    },
    { baseNode },
  )
  let saves = 0
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/155**', (route) => {
    if (route.request().method() === 'PATCH') {
      saves++
      return route.fulfill({ json: { sync_revision: 3 } })
    }
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [{ element_id: 'one', kind: 'node', op: 'upsert', payload: baseNode }],
            sync_revision: 1,
            has_more: false,
          }
        : { id: 155, title: '旧版草稿', revision: 1 },
    })
  })
  await page.goto('/canvas/155')
  const dialog = page.getByRole('alertdialog', { name: '发现本机草稿' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '暂不恢复' }).click()
  await expect(page.getByText('本机草稿已保留，暂不能保存；请返回后重新打开画布')).toBeVisible()
  expect(saves).toBe(0)
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('zzh_canvas_draft_u7_w21_p155') || '{}').textContents.one,
    ),
  ).toBe('旧版本本机内容')
})

test('409 合并过程中继续编辑的文本不会被覆盖', async ({ page }) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(
    ({ baseNode }) => {
      localStorage.setItem(
        'zzh_canvas_draft_u7_w21_p156',
        JSON.stringify({
          nodes: [{ ...baseNode, data: { ...baseNode.data, text: '第一次修改' } }],
          edges: [],
          textContents: { one: '第一次修改' },
          boundCanvasId: 156,
          pendingSync: true,
          syncBaseline: { nodes: [baseNode], edges: [] },
          updatedAt: Date.now(),
        }),
      )
    },
    { baseNode },
  )
  let saves = 0
  const submitted: any[] = []
  let releaseMerge!: () => void
  const waitForMerge = new Promise<void>((resolve) => {
    releaseMerge = resolve
  })
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/156**', async (route) => {
    if (route.request().method() === 'PATCH') {
      submitted.push(route.request().postDataJSON())
      saves++
      if (saves === 1) return route.fulfill({ status: 409, json: { message: 'revision conflict' } })
      if (saves === 2) await waitForMerge
      return route.fulfill({ json: { sync_revision: saves + 1 } })
    }
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [baseNode, remoteNode].map((node) => ({
              element_id: node.id,
              kind: 'node',
              op: 'upsert',
              payload: node,
            })),
            sync_revision: 1,
            has_more: false,
          }
        : { id: 156, title: '冲突保存', revision: 1 },
    })
  })
  await page.goto('/canvas/156')
  await expect.poll(() => saves).toBe(2)
  const node = page.locator('.react-flow__node[data-id="one"]')
  await node.locator('.canvas-node-body').dblclick()
  await node.locator('textarea').fill('合并期间的新文本')
  releaseMerge()
  await expect.poll(() => saves).toBeGreaterThanOrEqual(3)
  expect(submitted.at(-1).mutations).toContainEqual(
    expect.objectContaining({
      element_id: 'one',
      payload: expect.objectContaining({ data: expect.objectContaining({ text: '合并期间的新文本' }) }),
    }),
  )
  await expect(node.locator('textarea')).toHaveValue('合并期间的新文本')
})

test('临时故障展示暂存与重试时间，并在恢复后显示已保存', async ({ page }) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(
    ({ baseNode }) => {
      localStorage.setItem(
        'zzh_canvas_draft_u7_w21_p157',
        JSON.stringify({
          nodes: [{ ...baseNode, data: { ...baseNode.data, text: '等待同步' } }],
          edges: [],
          textContents: { one: '等待同步' },
          boundCanvasId: 157,
          pendingSync: true,
          syncBaseline: { nodes: [baseNode], edges: [] },
          updatedAt: Date.now(),
        }),
      )
    },
    { baseNode },
  )
  let saves = 0
  let releaseRetry!: () => void
  const retryResponse = new Promise<void>((resolve) => {
    releaseRetry = resolve
  })
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/157**', async (route) => {
    if (route.request().method() === 'PATCH') {
      saves++
      if (saves === 1) return route.fulfill({ status: 503, json: { message: '暂时不可用' } })
      await retryResponse
      return route.fulfill({ json: { sync_revision: 2 } })
    }
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [{ element_id: 'one', kind: 'node', op: 'upsert', payload: baseNode }],
            sync_revision: 1,
            has_more: false,
          }
        : { id: 157, title: '重试', revision: 1 },
    })
  })
  await page.clock.install()
  await page.goto('/canvas/157')
  await expect(page.getByText('云端保存未成功，本机已暂存；约 2 秒后重试')).toBeVisible()
  expect(saves).toBe(1)
  await page.clock.runFor(1400)
  expect(saves).toBe(1)
  await page.clock.runFor(200)
  await expect.poll(() => saves).toBe(2)
  await expect(page.getByText('云端保存中…')).toBeVisible()
  releaseRetry()
  await expect(page.getByText('已保存到云端')).toBeVisible()
})
