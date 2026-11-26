import { expect, test, type Page } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

function textNode(text = '云端草稿') {
  return {
    id: 'shared',
    type: 'text',
    position: { x: 100, y: 100 },
    data: { kind: 'text', text },
  }
}

type TextMutation = { element_id: string; kind: string; op: string; payload: ReturnType<typeof textNode> }

async function mockCanvas(page: Page, canvasId: number) {
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => localStorage.setItem('zzh_guide_seen_home_u7', '1'))
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.routeWebSocket(`**/api/v1/canvases/${canvasId}/node-locks/socket?**`, (socket) => {
    socket.onMessage(() => socket.send(JSON.stringify({ type: 'state', data: { granted: true, nodes: {} } })))
  })
  return api
}

const pendingJournal = (page: Page, canvasId: number) =>
  page.evaluate((id) => Object.keys(localStorage).some((key) => key.includes(`_p${id}:pending:`)), canvasId)

async function addTextNode(page: Page) {
  await page.getByTitle('添加节点').click()
  await page
    .getByRole('menu', { name: '创建或添加节点' })
    .getByRole('menuitem', { name: /^文本节点/ })
    .click()
}

test('首次云端快照返回前仅预览已有草稿，同步后可以正常新增节点', async ({ page }, testInfo) => {
  const canvasId = 801
  const api = await mockCanvas(page, canvasId)
  const base = textNode()
  await page.addInitScript(
    ({ canvasId, workspaceId, base }) => {
      localStorage.setItem(
        `zzh_canvas_draft_u7_w${workspaceId}_p${canvasId}`,
        JSON.stringify({ nodes: [base], edges: [], boundCanvasId: canvasId, pendingSync: false }),
      )
    },
    { canvasId, workspaceId: WORKSPACE_ID, base },
  )
  let releaseRead!: () => void
  const pendingRead = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  let blockedRead = false
  let saves = 0
  await page.route(`**/api/v1/canvases/${canvasId}**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/events')) return route.fulfill({ status: 204 })
    if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
    if (!url.pathname.endsWith('/elements')) return route.fulfill({ json: { id: canvasId, title: '延迟加载验证' } })
    if (route.request().method() === 'PATCH') {
      saves++
      return route.fulfill({ json: { sync_revision: 8 } })
    }
    if (url.searchParams.get('limit') !== '1' && !saves) {
      blockedRead = true
      await pendingRead
    }
    return route.fulfill({
      json: {
        elements: [{ element_id: base.id, kind: 'node', op: 'upsert', payload: base }],
        sync_revision: 7,
        has_more: false,
      },
    })
  })
  try {
    await page.goto(`/canvas/${canvasId}`)
    await expect.poll(() => blockedRead).toBe(true)
    const body = page.locator('.react-flow__node[data-id="shared"] .canvas-node-body')
    await expect(body).toHaveText('云端草稿')
    await expect(page.getByText('正在读取云端画布，载入后可编辑')).toBeVisible()
    await expect(page.getByTitle('添加节点')).toHaveCount(0)
    await body.dblclick()
    await expect(body.locator('textarea')).toHaveCount(0)
    await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 25, y: 200 } })
    await expect(page.locator('.canvas-context-menu')).toHaveCount(0)
    await expect(page.locator('.react-flow__node')).toHaveCount(1)
    expect(saves).toBe(0)
    await page.screenshot({ path: testInfo.outputPath('canvas-loaded-draft-read-only.png') })
  } finally {
    releaseRead()
  }
  await addTextNode(page)
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect.poll(() => saves).toBe(1)
  expectNoUnexpectedApi(api)
})

test('团队锁拒绝后保留未保存文字，其他节点可保存，原文字可手动重试', async ({ page }, testInfo) => {
  const canvasId = 802
  const api = await mockCanvas(page, canvasId)
  const base = textNode()
  const pendingText = '被锁的本机修改'
  let locked = true
  let revision = 1
  const received: Array<{ blocked: boolean; ids: string[] }> = []
  const elements = new Map([[base.id, { element_id: base.id, kind: 'node', op: 'upsert', payload: base }]])
  await page.route(`**/api/v1/canvases/${canvasId}**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/events')) return route.fulfill({ status: 204 })
    if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
    if (!url.pathname.endsWith('/elements')) return route.fulfill({ json: { id: canvasId, title: '协作锁恢复验证' } })
    if (route.request().method() === 'PATCH') {
      const { mutations } = route.request().postDataJSON() as { mutations: TextMutation[] }
      const blocked = locked && mutations.some(({ element_id }) => element_id === base.id)
      received.push({ blocked, ids: mutations.map(({ element_id }) => element_id) })
      if (blocked) {
        return route.fulfill({
          status: 423,
          json: { code_string: 'CANVAS_NODE_LOCKED', message: '节点已被协作者锁定', data: { element_ids: [base.id] } },
        })
      }
      for (const mutation of mutations) elements.set(mutation.element_id, mutation)
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    return route.fulfill({
      json: {
        elements: Number(url.searchParams.get('after_revision')) ? [] : [...elements.values()],
        sync_revision: revision,
        has_more: false,
      },
    })
  })
  await page.goto(`/canvas/${canvasId}`)
  await expect(page.getByTitle('添加节点')).toBeVisible()
  const body = page.locator('.react-flow__node[data-id="shared"] .canvas-node-body')
  await body.dblclick()
  await body.locator('textarea').fill(pendingText)
  await body.locator('textarea').blur()
  const retry = page.getByRole('button', { name: '保存画布' })
  await expect(retry).toBeVisible()
  await expect(body).toContainText(pendingText)
  await expect.poll(() => pendingJournal(page, canvasId)).toBe(true)
  expect(received.filter(({ blocked }) => blocked)).toHaveLength(1)
  await page.screenshot({ path: testInfo.outputPath('canvas-lock-edit-preserved.png') })

  await page.locator('.react-flow__pane').click({ position: { x: 25, y: 200 } })
  await addTextNode(page)
  await expect.poll(() => elements.size).toBe(2)
  expect(received.at(-1)?.ids).not.toContain(base.id)
  expect(elements.get(base.id)?.payload.data.text).toBe('云端草稿')
  await expect(retry).toBeVisible()
  await expect(body).toContainText(pendingText)
  await expect.poll(() => pendingJournal(page, canvasId)).toBe(true)

  locked = false
  await retry.click()
  await expect(page.getByText('已保存到云端')).toBeVisible()
  expect(elements.get(base.id)?.payload.data.text).toBe(pendingText)
  await expect.poll(() => pendingJournal(page, canvasId)).toBe(false)
  expectNoUnexpectedApi(api)
})

test('撤销删除已取消的视频只恢复原任务编号与状态', async ({ page }, testInfo) => {
  const canvasId = 803
  const taskId = 53213
  const api = await mockCanvas(page, canvasId)
  let revision = 1
  let cancels = 0
  let creations = 0
  let restoredTask: { taskId?: number; taskStatus?: string } | undefined
  const node = {
    id: 'running-video',
    type: 'video',
    position: { x: 150, y: 120 },
    data: {
      kind: 'video',
      prompt: '复现撤销后的任务',
      taskId,
      taskStatus: 'running',
      generationRequest: { kind: 'video', operationCode: 'video.generate', modelVersionId: 97, prompt: '剧情片段' },
    },
  }
  await page.route('**/api/v1/ai/tasks*', (route) => {
    if (route.request().method() === 'POST') creations++
    return route.fulfill({ json: { id: 53214, status: 'running' } })
  })
  await page.route(`**/api/v1/ai/tasks/${taskId}?**`, (route) =>
    route.fulfill({ json: { id: taskId, status: cancels ? 'cancelled' : 'running' } }),
  )
  await page.route(`**/api/v1/ai/tasks/${taskId}/cancel?**`, (route) => {
    cancels++
    return route.fulfill({ json: { id: taskId, status: 'cancelled' } })
  })
  await page.route(`**/api/v1/canvases/${canvasId}**`, (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/events')) return route.fulfill({ status: 204 })
    if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
    if (!url.pathname.endsWith('/elements')) return route.fulfill({ json: { id: canvasId, title: '视频撤销验证' } })
    if (route.request().method() === 'PATCH') {
      const { mutations } = route.request().postDataJSON() as {
        mutations: Array<{ element_id: string; op: string; payload: { data: typeof restoredTask } }>
      }
      const restored = mutations.find((mutation) => mutation.element_id === node.id && mutation.op === 'upsert')
      if (restored) restoredTask = restored.payload.data
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    return route.fulfill({
      json: {
        elements: Number(url.searchParams.get('after_revision'))
          ? []
          : [{ element_id: node.id, kind: 'node', op: 'upsert', payload: node }],
        sync_revision: revision,
        has_more: false,
      },
    })
  })
  await page.goto(`/canvas/${canvasId}`)
  await expect(page.getByTitle('添加节点')).toBeVisible()
  const video = page.locator('.react-flow__node[data-id="running-video"]')
  await video.locator('.canvas-node-header').click({ button: 'right' })
  await page
    .locator('.canvas-context-menu')
    .getByRole('button', { name: /^删除节点/ })
    .click()
  await page
    .getByRole('alertdialog', { name: '删除生成中的视频' })
    .getByRole('button', { name: '删除并停止生成' })
    .click()
  await expect(video).toHaveCount(0)
  await expect.poll(() => revision).toBeGreaterThan(1)
  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Control+z')
  await expect(video).toBeVisible()
  await expect.poll(() => restoredTask).toMatchObject({ taskId, taskStatus: 'cancelled' })
  expect(cancels).toBe(1)
  expect(creations).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('canvas-undo-cancelled-video.png') })
  expectNoUnexpectedApi(api)
})

async function mockLockedGroupSave(page: Page, canvasId: number, splitBatches: boolean) {
  const api = await mockCanvas(page, canvasId)
  const nodes = ['first', 'second'].map((id, index) => ({
    element_id: id,
    kind: 'node',
    op: 'upsert',
    payload: {
      id,
      type: 'image',
      position: { x: 100 + 350 * index, y: 100 },
      data: {
        kind: 'image',
        prompt: splitBatches ? 'a'.repeat(550_000) : '测试节点',
        groupId: undefined as string | undefined,
      },
    },
  }))
  const elements = new Map(nodes.map((node) => [node.element_id, node]))
  const submittedIds: string[][] = []
  let revision = 1
  let lockReplies = 0
  let lockSecond = true
  let recoveryFailures = 0
  let releaseLockReply!: () => void
  const lockReply = new Promise<void>((resolve) => {
    releaseLockReply = resolve
  })
  let releaseRecovery!: () => void
  const recovery = new Promise<void>((resolve) => {
    releaseRecovery = resolve
  })

  await page.route(`**/api/v1/canvases/${canvasId}**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/events')) return route.fulfill({ status: 204 })
    if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
    if (!url.pathname.endsWith('/elements')) return route.fulfill({ json: { id: canvasId, title: '分组锁恢复验证' } })
    if (route.request().method() === 'PATCH') {
      const { mutations } = route.request().postDataJSON() as { mutations: typeof nodes }
      const ids = mutations.map(({ element_id }) => element_id)
      submittedIds.push(ids)
      if (lockSecond && ids.includes('second')) {
        await lockReply
        lockReplies++
        return route.fulfill({
          status: 423,
          json: {
            code_string: 'CANVAS_NODE_LOCKED',
            message: '节点已被协作者锁定',
            data: { element_ids: splitBatches ? ['second'] : ['first', 'second'] },
          },
        })
      }
      for (const mutation of mutations) elements.set(mutation.element_id, mutation)
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    const known = Number(url.searchParams.get('after_revision'))
    if (!known && lockReplies && splitBatches) {
      if (!recoveryFailures++) return route.fulfill({ status: 500, json: { message: '暂时无法读取画布' } })
      await recovery
    }
    return route.fulfill({
      json: { elements: known >= revision ? [] : [...elements.values()], sync_revision: revision, has_more: false },
    })
  })
  await page.goto(`/canvas/${canvasId}`)
  await expect(page.getByTitle('添加节点')).toBeVisible()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Control+a')
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
  await page.keyboard.press('Control+g')

  return {
    api,
    elements,
    submittedIds,
    releaseLockReply,
    releaseRecovery,
    recoveryFailures: () => recoveryFailures,
    updateFirstFromCollaborator: (prompt: string) => {
      const first = elements.get('first')!
      elements.set('first', { ...first, payload: { ...first.payload, data: { ...first.payload.data, prompt } } })
      revision++
    },
    unlockSecond: () => {
      lockSecond = false
    },
  }
}

test('分批保存遇锁且回读暂时失败，撤销会补存已提交的部分', async ({ page }, testInfo) => {
  const canvasId = 806
  const canvas = await mockLockedGroupSave(page, canvasId, true)
  const group = page.getByText('分组 1', { exact: true })
  const saved = page.getByText('已保存到云端', { exact: true })
  try {
    await expect(group).toBeVisible()
    await expect.poll(() => canvas.submittedIds).toEqual([['first'], ['second']])
    expect(canvas.elements.get('first')?.payload.data.groupId).toBeTruthy()

    await page.keyboard.press('Control+z')
    await expect(group).toHaveCount(0)
    canvas.releaseLockReply()
    await expect.poll(canvas.recoveryFailures).toBeGreaterThanOrEqual(1)
    await expect(saved).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const key = Object.keys(localStorage).find((name) => name.includes(`_p${id}:pending:`))
          if (!key) return null
          const saved = JSON.parse(localStorage.getItem(key) || '{}')
          return { graphFromBaseline: saved.graphFromBaseline, acknowledgedMutationIds: saved.acknowledgedMutationIds }
        }, canvasId),
      )
      .toEqual({ graphFromBaseline: true, acknowledgedMutationIds: ['first'] })
    await expect(page.getByText(/本机草稿也未能保存/)).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('canvas-partial-save-awaiting-read.png') })
  } finally {
    canvas.releaseLockReply()
    canvas.releaseRecovery()
  }

  await expect.poll(() => canvas.submittedIds).toEqual([['first'], ['second'], ['first']])
  expect(canvas.elements.get('first')?.payload.data.groupId).toBeUndefined()
  expect(canvas.elements.get('second')?.payload.data.groupId).toBeUndefined()
  await expect(saved).toBeVisible()
  await expect.poll(() => pendingJournal(page, canvasId)).toBe(false)
  expectNoUnexpectedApi(canvas.api)
})

test('节点锁拒绝且云端画布无变化时，仍能撤销本机的分组', async ({ page }, testInfo) => {
  const canvasId = 807
  const canvas = await mockLockedGroupSave(page, canvasId, false)
  canvas.releaseLockReply()
  canvas.releaseRecovery()
  const group = page.getByText('分组 1', { exact: true })
  await expect(page.getByRole('button', { name: '保存画布' })).toBeVisible()
  await expect(group).toBeVisible()
  await expect.poll(() => pendingJournal(page, canvasId)).toBe(true)

  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Control+z')
  await expect(group).toHaveCount(0)
  await expect(page.getByText('已保存到云端', { exact: true })).toBeVisible()
  await expect.poll(() => pendingJournal(page, canvasId)).toBe(false)
  expect(canvas.submittedIds).toEqual([['first', 'second']])
  expect([...canvas.elements.values()].every(({ payload }) => !payload.data.groupId)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('canvas-locked-group-undone.png') })
  expectNoUnexpectedApi(canvas.api)
})

test('重开画布只补存被锁批次，保留已保存批次中协作者的新修改', async ({ page }, testInfo) => {
  const canvasId = 808
  const canvas = await mockLockedGroupSave(page, canvasId, true)
  const remotePrompt = '另一位协作者在第一批保存后修改了提示词'
  try {
    await expect.poll(() => canvas.submittedIds).toEqual([['first'], ['second']])
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const key = Object.keys(localStorage).find((name) => name.includes(`_p${id}:pending:`))
          const draft = key ? JSON.parse(localStorage.getItem(key) || '{}') : {}
          return {
            acknowledged: draft.acknowledgedMutationIds,
            compact: Boolean(draft.compactNodes?.length),
            submitted: Boolean(draft.submittedMutations?.length),
          }
        }, canvasId),
      )
      .toEqual({ acknowledged: ['first'], compact: true, submitted: false })
    canvas.releaseLockReply()
    await expect.poll(canvas.recoveryFailures).toBeGreaterThanOrEqual(1)

    canvas.updateFirstFromCollaborator(remotePrompt)
    canvas.unlockSecond()
    page.once('dialog', (dialog) => dialog.accept())
    await page.reload({ waitUntil: 'commit' })
  } finally {
    canvas.releaseLockReply()
    canvas.releaseRecovery()
  }

  await expect.poll(() => canvas.submittedIds).toEqual([['first'], ['second'], ['second']])
  expect(canvas.elements.get('first')?.payload.data.prompt).toBe(remotePrompt)
  expect(canvas.elements.get('second')?.payload.data.groupId).toBe(canvas.elements.get('first')?.payload.data.groupId)
  await expect(page.getByRole('alertdialog', { name: '恢复本机修改' })).toHaveCount(0)
  await expect(page.getByText('已保存到云端', { exact: true })).toBeVisible()
  await expect.poll(() => pendingJournal(page, canvasId)).toBe(false)
  await page.screenshot({ path: testInfo.outputPath('canvas-reopen-preserves-collaborator-edit.png') })
  expectNoUnexpectedApi(canvas.api)
})
