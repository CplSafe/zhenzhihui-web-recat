import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const compacted of [false, true]) {
  test(`a late canvas snapshot cannot restore an error after image success (compacted=${compacted})`, async ({
    page,
  }) => {
    const api = await installStrictAuthenticatedApp(page)
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
    await expect(page.getByText('正在生成内容', { exact: true })).toBeVisible()
    await page.clock.runFor(2500)
    await expect.poll(() => snapshotWaiting).toBe(true)
    releaseTask()
    const image = page.locator('.react-flow__node-image').getByRole('img', { name: 'image', exact: true })
    await expect(image).toBeVisible()
    await expect(page.getByText('正在生成内容', { exact: true })).toHaveCount(0)
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
