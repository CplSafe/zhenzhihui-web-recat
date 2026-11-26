import { expect, test } from '@playwright/test'
import {
  expectNoUnexpectedApi,
  installStrictAuthenticatedApp,
  SECOND_TEAM_WORKSPACE_ID,
  SECOND_TEAM_WORKSPACE_NAME,
  WORKSPACE_ID,
} from './fixtures/strict-authenticated-app'

const imageOperation = 'image.text_to_image'
const failedOperation = 'image.image_to_image'
const videoOperation = 'video.generate'
const imageTask = {
  id: 923,
  operation_code: imageOperation,
  prompt: '纸鸢穿过云边',
  status: 'running',
  created_at: '2026-11-26T10:00:00Z',
}

for (const [scenario, title] of [
  ['lookup', '建单响应不明确时保留幂等键，刷新后继续查原图像任务'],
  ['retry', '建单响应不明确时可在刷新后手动重试原请求'],
  ['failed', '重试原请求收到嵌套审核终态时解除核对和生成锁'],
] as const) {
  test(title, async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
    const keys: string[] = []
    const bodies: string[] = []
    let remoteVisible = false
    let allowReplay = false
    const manual = scenario !== 'lookup'
    await page.route('**/api/v1/ai/models?**', (route) => {
      const operation = new URL(route.request().url()).searchParams.get('operation_code')
      return route.fulfill({
        json: {
          items:
            operation === imageOperation
              ? [{ id: 43, display_name: '测试图像模型', operation_codes: [imageOperation] }]
              : [],
        },
      })
    })
    await page.route(/\/api\/v1\/ai\/tasks(?:\?|$)/, (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        expect(body).toMatchObject({ workspace_id: WORKSPACE_ID, operation_code: imageOperation })
        keys.push(body.idempotency_key)
        bodies.push(route.request().postData() || '')
        if (allowReplay) {
          if (scenario === 'failed') {
            return route.fulfill({
              status: 502,
              json: {
                code_string: 'PROVIDER_FAILED',
                message: '生成内容未通过安全审核',
                data: { ...imageTask, status: 'failed', outputs: [], actual_cost: 0 },
              },
            })
          }
          if (new URL(route.request().url()).searchParams.get('stream') !== 'true') {
            return route.fulfill({ json: imageTask })
          }
          return route.fulfill({
            contentType: 'text/event-stream',
            body: `event: response.created\ndata: ${JSON.stringify({ task: imageTask })}\n\n`,
          })
        }
        return route.fulfill({
          status: keys.length === 1 ? 503 : 422,
          json: { message: '模拟建单结果不明确' },
        })
      }
      const url = new URL(route.request().url())
      const found =
        remoteVisible &&
        url.searchParams.get('operation_code') === imageOperation &&
        url.searchParams.get('mine') === 'true'
      return route.fulfill({ json: { items: found ? [{ ...imageTask, idempotency_key: keys[0] }] : [] } })
    })
    await page.route('**/api/v1/ai/tasks/923?**', (route) =>
      route.fulfill({
        json: { ...imageTask, status: 'succeeded', outputs: [{ type: 'image', asset_id: 701 }] },
      }),
    )

    const openImageMode = async () => page.getByRole('tab', { name: '图片生成' }).click()
    const submit = page.locator('.studio-submit')
    await page.goto('/studio', { waitUntil: 'domcontentloaded' })
    await openImageMode()
    await expect(page.getByText('测试图像模型').first()).toBeVisible()
    await page.getByPlaceholder(/直接描述想生成的图片/).fill(imageTask.prompt)
    await submit.click()
    await expect(submit).toHaveText('正在核对原任务…')
    await expect(submit).toBeDisabled()
    await expect(page.getByRole('region', { name: '创作结果' }).getByText('正在核对原任务，请勿重复提交')).toBeVisible()
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(/^studio_/)
    expect(new Set(keys).size).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('studio-pending-submission.png'), animations: 'disabled' })

    await page.reload({ waitUntil: 'domcontentloaded' })
    await openImageMode()
    await expect(submit).toBeDisabled()
    await expect(submit).toHaveText('正在核对原任务…')
    expect(bodies).toHaveLength(2)
    if (manual) {
      await expect(page.getByText('已受理会复用原任务，尚未建单时按原请求计费。')).toBeVisible()
      await page.getByPlaceholder(/直接描述想生成的图片/).fill('刷新后草稿已不同')
      allowReplay = true
      await page.getByRole('button', { name: '重试原请求', exact: true }).click()
    } else {
      remoteVisible = true
    }
    if (scenario === 'failed') {
      await expect(page.getByRole('region', { name: '创作结果' }).getByText(/内容安全审核/)).toBeVisible()
      await expect(page.getByRole('button', { name: '重试原请求', exact: true })).toHaveCount(0)
    } else {
      await expect(page.getByRole('img', { name: '生成结果' })).toBeVisible({ timeout: 20000 })
    }
    await expect(submit).toBeEnabled()
    expect(bodies).toHaveLength(manual ? 3 : 2)
    expect(new Set(bodies).size).toBe(1)
    expectNoUnexpectedApi(api)
  })
}

test('历史分流失败后重试原页，历史中的活动图片自动续接', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  const requests: Array<[string, string]> = []
  let allowRetry = false
  await page.route(/\/api\/v1\/ai\/tasks\?/, (route) => {
    const params = new URL(route.request().url()).searchParams
    const operation = params.get('operation_code') || ''
    if (![imageOperation, failedOperation, videoOperation].includes(operation)) return route.fallback()
    requests.push([operation, params.get('offset') || '0'])
    if (operation === failedOperation && !allowRetry) {
      return route.fulfill({ status: 503, json: { message: '模拟历史暂不可读' } })
    }
    const items = operation === failedOperation ? [{ ...imageTask, operation_code: failedOperation }] : []
    return route.fulfill({ json: { items } })
  })
  await page.route('**/api/v1/ai/tasks/923?**', (route) =>
    route.fulfill({
      json: {
        ...imageTask,
        operation_code: failedOperation,
        status: 'succeeded',
        outputs: [{ type: 'image', asset_id: 701 }],
      },
    }),
  )

  await page.goto('/studio', { waitUntil: 'domcontentloaded' })
  const feed = page.getByRole('region', { name: '创作结果' })
  await expect(feed.getByText('部分创作记录未加载')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('studio-history-retry.png'), animations: 'disabled' })
  const previousRequests = requests.length
  allowRetry = true
  await feed.getByRole('button', { name: '重试加载历史' }).click()
  await expect(feed.getByText(imageTask.prompt)).toBeVisible()
  await expect(feed.getByRole('img', { name: '生成结果' })).toBeVisible({ timeout: 15000 })
  expect(requests.slice(0, previousRequests)).toContainEqual([videoOperation, '0'])
  expect(requests.slice(previousRequests)).toEqual([[failedOperation, '0']])
  expectNoUnexpectedApi(api)
})

test('原视频已完成但产物暂未入库时允许开始一次新创作', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const oldId = 925
  const original = {
    operation: videoOperation,
    idempotencyKey: 'studio_video_previously_completed',
    batch: { id: 'old-video', mode: 'video', prompt: '已经生成的原视频', summary: '5s', createdAt: 1 },
    itemId: 'old-video-item',
    taskId: oldId,
  }
  await page.addInitScript(
    ({ workspaceId, original }) => {
      const key = `zzh:studio-pending:v1:${workspaceId}:7:${original.itemId}`
      window.localStorage.setItem(key, JSON.stringify(original))
    },
    { workspaceId: WORKSPACE_ID, original },
  )
  await page.route('**/api/v1/ai/models?**', (route) => {
    const operation = new URL(route.request().url()).searchParams.get('operation_code')
    return route.fulfill({
      json: {
        items:
          operation === videoOperation
            ? [{ id: 44, display_name: '测试视频模型', operation_codes: [videoOperation] }]
            : [],
      },
    })
  })
  const submissions: Array<{ workspace_id: number; operation_code: string; idempotency_key: string; prompt: string }> =
    []
  await page.route(/\/api\/v1\/ai\/tasks(?:\?|$)/, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { items: [] } })
    submissions.push(route.request().postDataJSON())
    return route.fulfill({ json: { id: 926, status: 'succeeded', outputs: [{ type: 'video', asset_id: 601 }] } })
  })
  await page.route('**/api/v1/ai/tasks/925?**', (route) =>
    route.fulfill({ json: { id: oldId, status: 'succeeded', outputs: [] } }),
  )
  await page.route('**/api/v1/assets?**', (route) => route.fulfill({ json: { items: [], total: 0 } }))

  await page.goto('/studio', { waitUntil: 'domcontentloaded' })
  const feed = page.getByRole('region', { name: '创作结果' })
  const submit = page.locator('.studio-submit')
  await expect(feed.getByText(original.batch.prompt)).toBeVisible()
  await expect(submit).toBeDisabled()
  await expect(feed.getByText('任务已完成，正在等待产物可用')).toBeVisible({ timeout: 30_000 })
  await expect(submit).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('studio-media-pending.png'), animations: 'disabled' })
  expect(submissions).toHaveLength(0)

  await page.getByRole('switch', { name: '智能分镜' }).click()
  await page.getByPlaceholder(/描述你想生成的视频内容/).fill('开始独立的新视频创作')
  await submit.click()
  await expect.poll(() => submissions.length).toBe(1)
  expect(submissions[0]).toMatchObject({ workspace_id: WORKSPACE_ID, operation_code: videoOperation })
  expect(submissions[0].idempotency_key).not.toBe(original.idempotencyKey)
  expect(submissions[0].prompt).toContain('开始独立的新视频创作')
  await expect(feed.locator('video')).toBeVisible()
  expectNoUnexpectedApi(api)
})

test('切换工作空间时不把原空间的活动任务带入新空间', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  const nextTask = { ...imageTask, id: 924, prompt: '新团队的云间花园' }
  const details: Array<[number, number]> = []
  await page.route(/\/api\/v1\/ai\/tasks\?/, (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('operation_code') !== imageOperation) return route.fulfill({ json: { items: [] } })
    const workspace = Number(params.get('workspace_id'))
    return route.fulfill({ json: { items: [workspace === WORKSPACE_ID ? imageTask : nextTask] } })
  })
  await page.route(/\/api\/v1\/ai\/tasks\/(923|924)\?/, (route) => {
    const url = new URL(route.request().url())
    const id = Number(url.pathname.split('/').at(-1))
    details.push([id, Number(url.searchParams.get('workspace_id'))])
    return route.fulfill({
      json:
        id === imageTask.id
          ? imageTask
          : { ...nextTask, status: 'succeeded', outputs: [{ type: 'image', asset_id: 701 }] },
    })
  })

  await page.goto('/studio', { waitUntil: 'domcontentloaded' })
  const feed = page.getByRole('region', { name: '创作结果' })
  await expect(feed.getByText(imageTask.prompt)).toBeVisible()
  await expect.poll(() => details).toContainEqual([imageTask.id, WORKSPACE_ID])
  await page.getByRole('button', { name: /E2E 用户/ }).click()
  await page
    .getByRole('dialog', { name: '用户面板' })
    .getByRole('button', { name: SECOND_TEAM_WORKSPACE_NAME, exact: true })
    .click()
  await expect(feed.getByText(nextTask.prompt)).toBeVisible()
  await expect(feed.getByRole('img', { name: '生成结果' })).toBeVisible({ timeout: 15000 })
  await expect(feed.getByText(imageTask.prompt)).toHaveCount(0)
  expect(details).toContainEqual([nextTask.id, SECOND_TEAM_WORKSPACE_ID])
  expect(details).not.toContainEqual([imageTask.id, SECOND_TEAM_WORKSPACE_ID])
  expectNoUnexpectedApi(api)
})
