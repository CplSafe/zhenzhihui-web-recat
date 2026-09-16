import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('retrying a canvas image does not poll or display the previous failed task', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const oldError = 'read google image response: context canceled'
  const currentError = 'Current generation failed'
  let revision = 1
  let oldTaskQueries = 0
  let submissions = 0
  let releaseSubmission: (() => void) | undefined
  const pendingSubmission = new Promise<void>((resolve) => {
    releaseSubmission = resolve
  })
  const node = {
    element_id: 'image-retry',
    kind: 'node',
    op: 'upsert',
    payload: {
      id: 'image-retry',
      type: 'image',
      position: { x: 180, y: 100 },
      style: { width: 250, height: 250 },
      data: {
        kind: 'image',
        prompt: 'Canvas retry regression',
        ratio: '1:1',
        modelVersionId: 27,
        taskId: 15318,
        taskStatus: 'failed',
        taskError: oldError,
      },
    },
  }
  await page.route('**/api/v1/canvases/108**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    if (url.pathname.endsWith('/elements')) {
      if (route.request().method() === 'PATCH') {
        revision += 1
        await route.fulfill({ json: { revision } })
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
    } else {
      await route.fulfill({ json: { id: 108, title: 'Canvas regression', status: 'active', revision } })
    }
  })
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 27,
            provider: 'google',
            version: 'gemini-2.5-flash-image',
            capability: 'image',
            enabled: true,
            display_name: 'Test image model',
            operation_codes: ['image.text_to_image'],
            params_schema: { type: 'object', properties: { ratio: { type: 'string', enum: ['1:1'] } } },
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/ai/tasks', async (route) => {
    submissions += 1
    await pendingSubmission
    await route.fulfill({ json: { id: 15320, status: 'pending' } })
  })
  await page.route('**/api/v1/ai/tasks/15318?**', async (route) => {
    oldTaskQueries += 1
    await route.fulfill({ json: { id: 15318, status: 'failed', error_message: oldError } })
  })
  await page.route('**/api/v1/ai/tasks/15320?**', (route) =>
    route.fulfill({
      json: { id: 15320, status: 'failed', error_message: currentError },
    }),
  )

  await page.clock.install()
  await page.goto('/canvas/108')
  await expect(page.getByText(oldError, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /当前缩放/ }).click()
  await page.locator('.react-flow__node-image').click()
  const send = page.getByRole('button', { name: /约.*元/ })
  await expect(send).toBeEnabled()
  await send.click()
  await expect.poll(() => submissions).toBe(1)
  try {
    await page.clock.runFor(7000)
    expect(oldTaskQueries).toBe(0)
    await expect(page.getByText(oldError, { exact: true })).toHaveCount(0)
    await expect(page.getByText('正在提交任务', { exact: true })).toBeVisible()
    await expect(page.getByTitle('生成过程中不能修改，请添加新的节点使用其他模型')).toBeDisabled()
    expect(submissions).toBe(1)
  } finally {
    releaseSubmission?.()
  }
  await expect(page.getByText(currentError, { exact: true })).toBeVisible()
  expect(oldTaskQueries).toBe(0)
  expect(submissions).toBe(1)
  expectNoUnexpectedApi(api)
})
