import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const accepted of [false, true]) {
  test(`音频提交${accepted ? '已取得任务编号只查询原任务' : '编号未知时刷新禁止再次生成'}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const api = await installStrictAuthenticatedApp(page)
    const canvasId = 116
    const nodeId = 'audio-recovery'
    const oldResult = 715
    const taskId = 819
    let revision = 1
    let submissions = 0
    let queries = 0
    let allowTaskQuery = false
    let node = {
      id: nodeId,
      type: 'audio',
      position: { x: 260, y: 140 },
      style: { width: 320, height: 120 },
      data: {
        kind: 'audio',
        modelVersionId: 92,
        operationCode: 'audio.music',
        prompt: '生成一段音乐',
        assetId: oldResult,
        assetWorkspaceId: WORKSPACE_ID,
        taskId: 718,
        taskStatus: 'succeeded',
      },
    }
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({ json: [{ id: 92, display_name: '音乐模型', operation_codes: ['audio.music'] }] }),
    )
    await page.route(`**/api/v1/canvases/${canvasId}**`, async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
      if (url.pathname.endsWith('/events')) return route.fulfill({ status: 204 })
      if (!url.pathname.endsWith('/elements')) {
        return route.fulfill({ json: { id: canvasId, title: '音频任务恢复', status: 'active', revision } })
      }
      if (route.request().method() === 'PATCH') {
        for (const mutation of route.request().postDataJSON().mutations || []) {
          if (mutation.element_id === nodeId) node = mutation.payload
        }
        revision += 1
        return route.fulfill({ json: { sync_revision: revision } })
      }
      await route.fulfill({
        json: {
          elements:
            Number(url.searchParams.get('after_revision')) > 0
              ? []
              : [{ element_id: nodeId, kind: 'node', op: 'upsert', payload: node }],
          sync_revision: revision,
          has_more: false,
        },
      })
    })
    await page.route('**/api/v1/ai/tasks', async (route) => {
      submissions += 1
      const { idempotency_key } = route.request().postDataJSON()
      expect(node.data).toMatchObject({
        taskId: 0,
        taskStatus: 'submitting',
        taskIdempotencyKey: idempotency_key,
        taskRunId: idempotency_key,
        taskSubmissionFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        assetId: oldResult,
      })
      await route.fulfill({ json: { data: { status: 'queued', ...(accepted ? { id: taskId } : {}) } } })
    })
    await page.route(`**/api/v1/ai/tasks/${taskId}?**`, (route) => {
      queries += 1
      if (!allowTaskQuery) return route.fulfill({ status: 404, json: { message: '暂时无法获取任务结果' } })
      return route.fulfill({
        json: { data: { id: taskId, status: 'failed', error_message: '模拟任务终态' } },
      })
    })

    const audioNode = page.locator(`.react-flow__node[data-id="${nodeId}"]`)
    const selectAudio = async () => {
      const header = audioNode.locator('.canvas-node-header')
      await expect(header).toBeInViewport()
      await header.click()
      await expect(audioNode.getByRole('region', { name: '音频参数' })).toBeVisible()
    }
    await page.goto(`/canvas/${canvasId}`)
    await selectAudio()
    await audioNode.getByRole('button', { name: '重新制作', exact: true }).click()
    await expect.poll(() => node.data.taskStatus).toBe(accepted ? 'result_pending' : 'submission_unknown')
    expect(node.data.taskId).toBe(accepted ? taskId : 0)
    expect(node.data.assetId).toBe(oldResult)
    expect(submissions).toBe(1)

    if (accepted) allowTaskQuery = true
    const previousQueries = queries
    await page.reload()
    await selectAudio()
    if (accepted) {
      await expect.poll(() => queries).toBeGreaterThan(previousQueries)
      await expect.poll(() => node.data.taskStatus).toBe('failed')
      expect(node.data.taskId).toBe(taskId)
    } else {
      await expect(audioNode.getByText(/尚未确认本次提交/)).toBeVisible()
      await expect(audioNode.getByRole('button', { name: '重新制作', exact: true })).toBeDisabled()
      expect(node.data.taskId).toBe(0)
      expect(queries).toBe(0)
    }
    expect(node.data.assetId).toBe(oldResult)
    expect(submissions).toBe(1)
    expectNoUnexpectedApi(api)
    await testInfo.attach('刷新后的音频任务状态', { body: await page.screenshot(), contentType: 'image/png' })
  })
}
