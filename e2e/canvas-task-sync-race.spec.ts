import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const compacted of [false, true]) {
  test(`a late canvas snapshot cannot restore an error after image success (compacted=${compacted})`, async ({
    page,
  }) => {
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    const oldError = 'Old asset is not suitable for this operation'
    const node = {
      element_id: 'generated-image',
      kind: 'node',
      op: 'upsert',
      payload: {
        id: 'generated-image',
        type: 'image',
        position: { x: 200, y: 100 },
        style: { width: 250, height: 250 },
        data: { kind: 'image', prompt: 'Successful image', taskId: 15334, taskStatus: 'processing', taskError: '' },
      },
    }
    let savedNode: unknown = node
    let revision = 1
    let pendingSnapshot = false
    let snapshotWaiting = false
    let deliveredSnapshot = false
    let releaseSnapshot!: () => void
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve
    })
    let releaseTask!: () => void
    const taskGate = new Promise<void>((resolve) => {
      releaseTask = resolve
    })
    let successSaved = false
    let submissions = 0
    await page.route('**/api/v1/canvases/112**', async (route) => {
      const url = new URL(route.request().url())
      if (!url.pathname.endsWith('/elements')) {
        return route.fulfill({ json: { id: 112, title: 'Task sync race', status: 'active', revision } })
      }
      if (route.request().method() === 'PATCH') {
        for (const mutation of route.request().postDataJSON().mutations || []) {
          if (mutation.element_id === node.element_id) {
            savedNode = mutation
            if (mutation.payload.data.taskStatus === 'succeeded') successSaved = true
          }
        }
        return route.fulfill({ json: { sync_revision: ++revision } })
      }
      const after = Number(url.searchParams.get('after_revision'))
      if (!deliveredSnapshot && (after > 0 || pendingSnapshot)) {
        if (compacted && after > 0) {
          pendingSnapshot = true
          return route.fulfill({
            json: {
              elements: [],
              sync_revision: revision + 1,
              history_floor_revision: after + 1,
              has_more: false,
            },
          })
        }
        pendingSnapshot = true
        const staleRevision = revision + 1
        snapshotWaiting = true
        await snapshotGate
        deliveredSnapshot = true
        return route.fulfill({
          json: {
            elements: [
              {
                ...node,
                payload: {
                  ...node.payload,
                  data: {
                    ...node.payload.data,
                    assetId: 701,
                    taskStatus: 'failed',
                    taskError: oldError,
                  },
                },
              },
            ],
            sync_revision: staleRevision,
            history_floor_revision: 0,
            has_more: false,
          },
        })
      }
      return route.fulfill({
        json: {
          elements: after > 0 ? [] : [savedNode],
          sync_revision: revision,
          history_floor_revision: 0,
          has_more: false,
        },
      })
    })
    await page.route('**/api/v1/ai/tasks/15334?**', async (route) => {
      await taskGate
      await route.fulfill({
        json: {
          id: 15334,
          status: 'succeeded',
          estimated_cost: 15,
          actual_cost: 15,
          outputs: [{ type: 'image', asset_id: 701, mime_type: 'image/png' }],
        },
      })
    })
    await page.route('**/api/v1/assets/701?**', (route) =>
      route.fulfill({
        json: {
          id: 701,
          workspace_id: WORKSPACE_ID,
          type: 'image',
          mime_type: 'image/png',
          status: 'active',
        },
      }),
    )
    await page.route('**/api/v1/ai/tasks', (route) => {
      submissions += 1
      return route.fulfill({ status: 500, json: { message: 'Must not generate again' } })
    })
    await page.clock.install()
    await page.goto('/canvas/112')
    await expect(page.getByRole('status', { name: '生成中', exact: true })).toBeVisible()
    await page.clock.runFor(2500)
    await expect.poll(() => snapshotWaiting).toBe(true)
    releaseTask()
    const image = page.locator('.react-flow__node-image').getByRole('img', { name: 'image', exact: true })
    await expect(image).toBeVisible()
    await expect(page.getByRole('status', { name: '生成中', exact: true })).toHaveCount(0)
    await page.clock.runFor(1500)
    await expect.poll(() => successSaved).toBe(true)
    releaseSnapshot()
    await expect.poll(() => deliveredSnapshot).toBe(true)
    await page.clock.runFor(1000)
    await expect(page.getByText(oldError, { exact: false })).toHaveCount(0)
    await expect(image).toBeVisible()
    expect(savedNode).toMatchObject({
      payload: { data: { taskId: 15334, taskStatus: 'succeeded', taskError: '', assetId: 701 } },
    })
    await page.reload()
    await expect(image).toBeVisible()
    await expect(page.getByText(oldError, { exact: false })).toHaveCount(0)
    expect(submissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}

for (const mode of ['增量同步', '压缩后全量同步', '刷新时读取草稿']) {
  test(`更高画布版本中的旧提交不能覆盖已保存的图片结果（${mode}）`, async ({ page }, testInfo) => {
    const compacted = mode === '压缩后全量同步'
    const coldReload = mode === '刷新时读取草稿'
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: coldReload })
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    const taskId = 15336
    const assetId = 701
    const taskRunId = 'same-image-run'
    const taskIdempotencyKey = 'same-image-submission'
    const remoteTitle = '协作者改过的结果名称'
    const siblingTitle = '协作者改过的另一个节点'
    const makeNode = (id: string, x: number, data: Record<string, unknown>) => {
      const nodeData: Record<string, unknown> = { kind: 'image', ...data }
      return {
        element_id: id,
        kind: 'node',
        op: 'upsert',
        payload: {
          id,
          type: 'image',
          position: { x, y: 150 },
          style: { width: 250, height: 250 },
          data: nodeData,
        },
      }
    }
    const original = makeNode('generated-image', 200, {
      title: '生成中的图片',
      prompt: '生成这张图片',
      taskId,
      taskRunId,
      taskIdempotencyKey,
      taskStatus: 'processing',
    })
    const sibling = makeNode('sibling', 600, { title: '旧的节点名称' })
    let savedTask = original
    let savedSibling = sibling
    let revision = 1
    let originalSuccessRevision = 0
    let staleRevision = 0
    let repairBaseRevision = 0
    let sawCompaction = false
    let staleDelivery: 'incremental' | 'full' | undefined
    let taskFinished = false
    let taskCreates = 0

    await page.route('**/api/v1/canvases/113**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      expect(url.searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
      if (!url.pathname.endsWith('/elements')) {
        return route.fulfill({ json: { id: 113, title: '协作任务状态', status: 'active', revision } })
      }
      if (request.method() === 'PATCH') {
        const {
          base_revision: baseRevision,
          mutations = [],
        }: {
          base_revision: number
          mutations?: (typeof savedTask)[]
        } = request.postDataJSON()
        expect(baseRevision).toBe(revision)
        revision += 1
        for (const mutation of mutations) {
          if (mutation.element_id === sibling.element_id) savedSibling = mutation
          if (mutation.element_id !== original.element_id) continue
          savedTask = mutation
          const { taskStatus, taskId: savedTaskId, assetId: savedAssetId } = mutation.payload.data
          if (taskStatus !== 'succeeded' || savedTaskId !== taskId || savedAssetId !== assetId) continue
          if (!staleRevision) originalSuccessRevision = revision
          else repairBaseRevision = baseRevision
        }
        return route.fulfill({ json: { sync_revision: revision } })
      }

      const after = Number(url.searchParams.get('after_revision'))
      const pageData = { sync_revision: revision, history_floor_revision: 0, has_more: false }
      if (staleRevision && after > 0 && after < staleRevision && compacted) {
        sawCompaction = true
        return route.fulfill({ json: { ...pageData, elements: [], history_floor_revision: staleRevision } })
      }
      if (staleRevision && !repairBaseRevision && (after < staleRevision || sawCompaction)) {
        staleDelivery ??= after > 0 ? 'incremental' : 'full'
        return route.fulfill({ json: { ...pageData, elements: [savedTask, savedSibling] } })
      }
      return route.fulfill({ json: { ...pageData, elements: after > 0 ? [] : [savedTask, savedSibling] } })
    })

    await page.route(`**/api/v1/ai/tasks/${taskId}?**`, (route) =>
      route.fulfill({
        json: {
          id: taskId,
          status: taskFinished ? 'succeeded' : 'processing',
          outputs: taskFinished ? [{ asset_id: assetId, type: 'image', mime_type: 'image/png' }] : [],
        },
      }),
    )
    await page.route(`**/api/v1/assets/${assetId}?**`, (route) =>
      route.fulfill({ json: { id: assetId, workspace_id: WORKSPACE_ID, type: 'image', status: 'active' } }),
    )
    await page.route(`**/api/v1/assets/${assetId}/download?**`, (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250"><rect width="250" height="250" fill="#eedbc1"/><circle cx="125" cy="125" r="61" fill="#385ad3"/></svg>',
      }),
    )
    await page.route('**/api/v1/ai/tasks', (route) => {
      taskCreates += 1
      return route.fulfill({ status: 409, json: { code_string: 'E2E_PAID_TASK_BLOCKED' } })
    })

    await page.clock.install()
    await page.goto('/canvas/113')
    const node = page.locator('.react-flow__node[data-id="generated-image"]')
    const result = node.getByRole('img', { name: 'image', exact: true })
    await expect(node.getByRole('status', { name: '生成中', exact: true })).toBeVisible()
    taskFinished = true
    await expect(result).toBeVisible()
    await expect.poll(() => originalSuccessRevision).toBeGreaterThan(1)
    await expect(page.getByText('已保存到云端', { exact: true })).toBeVisible()
    if (coldReload) {
      await expect
        .poll(() =>
          page.evaluate(
            ({ workspaceId, taskId, assetId }) => {
              const draft = JSON.parse(localStorage.getItem(`zzh_canvas_draft_u7_w${workspaceId}_p113`) || '{}')
              const data = draft.nodes?.find((node: { id: string }) => node.id === 'generated-image')?.data
              return draft.pendingSync === false && data?.taskId === taskId && data?.assetId === assetId
            },
            { workspaceId: WORKSPACE_ID, taskId, assetId },
          ),
        )
        .toBe(true)
    }

    // The server persists an older task state in a newer collaboration revision.
    savedTask = makeNode(original.element_id, 200, {
      title: remoteTitle,
      prompt: original.payload.data.prompt,
      taskRunId,
      taskIdempotencyKey,
      taskStatus: 'submitting',
    })
    savedSibling = makeNode(sibling.element_id, 600, { title: siblingTitle })
    staleRevision = ++revision
    expect(staleRevision).toBeGreaterThan(originalSuccessRevision)
    if (coldReload) await page.reload()
    else await page.clock.runFor(12_000)
    await expect(page.getByRole('button', { name: siblingTitle, exact: true })).toBeVisible()
    await expect(node.getByRole('button', { name: remoteTitle, exact: true })).toBeVisible()
    expect(staleDelivery).toBe(compacted || coldReload ? 'full' : 'incremental')
    await expect(result).toBeVisible()
    await expect(result).toHaveAttribute('src', /\/assets\/701\/download/)
    await expect(node.getByRole('status', { name: /提交中|提交待确认/ })).toHaveCount(0)
    await expect.poll(() => repairBaseRevision).toBeGreaterThanOrEqual(staleRevision)
    expect(savedTask.payload.data).toMatchObject({
      title: remoteTitle,
      taskId,
      taskRunId,
      taskIdempotencyKey,
      taskStatus: 'succeeded',
      assetId,
    })

    await page.reload()
    await expect(page.getByText('已保存到云端', { exact: true })).toBeVisible()
    await expect(result).toBeVisible()
    await expect(result).toHaveAttribute('src', /\/assets\/701\/download/)
    await expect.poll(() => result.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(250)
    await expect(node.getByRole('status', { name: /提交中|提交待确认/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: siblingTitle, exact: true })).toBeVisible()
    expect(taskCreates).toBe(0)
    expectNoUnexpectedApi(api)
    await page.screenshot({ path: testInfo.outputPath('retained-image-after-refresh.png'), animations: 'disabled' })
  })
}

test('unchanged generation polls do not dirty or sync the canvas', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  const node = {
    element_id: 'stable-progress',
    kind: 'node',
    op: 'upsert',
    payload: {
      id: 'stable-progress',
      type: 'image',
      position: { x: 200, y: 100 },
      style: { width: 250, height: 250 },
      data: {
        kind: 'image',
        prompt: 'Stable generation status',
        taskId: 15400,
        taskRunId: 'stable-run',
        taskStatus: 'processing',
        taskProgress: 30,
        taskError: '',
        taskStatusQueryFailures: 0,
      },
    },
  }
  let revision = 1
  let taskQueries = 0
  let canvasPatches = 0
  await page.route('**/api/v1/canvases/114**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/elements')) {
      if (route.request().method() === 'PATCH') {
        canvasPatches += 1
        await route.fulfill({ json: { sync_revision: ++revision } })
      } else {
        await route.fulfill({
          json: {
            elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [node],
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          },
        })
      }
      return
    }
    await route.fulfill({ json: { id: 114, title: 'Stable task polling', status: 'active', revision } })
  })
  await page.route('**/api/v1/ai/tasks/15400?**', async (route) => {
    taskQueries += 1
    await route.fulfill({ json: { id: 15400, status: 'processing', progress: 0.3, outputs: [] } })
  })
  await page.clock.install()
  await page.goto('/canvas/114')
  await expect(page.getByRole('button', { name: '图片 · Stable generation status' })).toBeVisible()
  await page.clock.runFor(6500)
  await expect.poll(() => taskQueries).toBeGreaterThanOrEqual(2)
  await expect(page.getByText('已保存到云端', { exact: true })).toBeVisible()
  expect(canvasPatches).toBe(0)
  expectNoUnexpectedApi(api)
})
