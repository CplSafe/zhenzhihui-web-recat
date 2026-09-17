import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const scenario of [
  { provider: 'google', version: 'gemini-2.5-flash-image', edit: false },
  { provider: 'google', version: 'gemini-2.5-flash-image', edit: true },
  { provider: 'openai', version: 'gpt-image-2', edit: true },
  { provider: 'volcengine', version: 'doubao-seedream-5-0-260128', edit: true },
  { provider: 'google', version: 'gemini-2.5-flash-image', edit: true, immediateFailure: true },
]) {
  test(`canvas ${scenario.version} edit=${scenario.edit} immediateFailure=${Boolean(scenario.immediateFailure)} sends correct inputs and isolates the previous failure`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const api = await installStrictAuthenticatedApp(page)
    const oldError = 'read google image response: context canceled'
    const currentError = 'Current generation failed'
    let revision = 1
    let oldTaskQueries = 0
    let submissions = 0
    let estimates = 0
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
              elements:
                Number(url.searchParams.get('after_revision')) > 0
                  ? []
                  : [
                      node,
                      ...(scenario.edit
                        ? [
                            {
                              element_id: 'image-source',
                              kind: 'node',
                              op: 'upsert',
                              payload: {
                                id: 'image-source',
                                type: 'image',
                                position: { x: -140, y: 100 },
                                style: { width: 200, height: 200 },
                                data: { kind: 'image', assetId: 12391, workspaceId: WORKSPACE_ID },
                              },
                            },
                            {
                              element_id: 'edge-reference',
                              kind: 'edge',
                              op: 'upsert',
                              payload: {
                                id: 'edge-reference',
                                source: 'image-source',
                                target: 'image-retry',
                                sourceHandle: 'image-source-right-source',
                                targetHandle: 'image-retry-left-target',
                              },
                            },
                          ]
                        : []),
                    ],
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
              provider: scenario.provider,
              version: scenario.version,
              capability: 'image',
              enabled: true,
              display_name: 'Test image model',
              operation_codes: ['image.text_to_image', 'image.image_to_image'],
              input_constraints: {
                'image.image_to_image': { roles: [{ role: 'reference_image', min_count: 1, max_count: 3 }] },
              },
              params_schema: { type: 'object', properties: { ratio: { type: 'string', enum: ['1:1'] } } },
            },
          ],
        },
      }),
    )
    if (scenario.edit) {
      await page.route('**/api/v1/ai/tasks/estimate-cost', async (route) => {
        const body = route.request().postDataJSON()
        expect(body.operation_code).toBe('image.image_to_image')
        expect(body.input_assets).toEqual([{ asset_id: 12391, role: 'reference_image' }])
        estimates += 1
        await route.fulfill({ json: { estimated_cost: 15, balance: 1000, can_afford: true } })
      })
    }
    await page.route('**/api/v1/ai/tasks', async (route) => {
      if (scenario.edit) {
        const body = route.request().postDataJSON()
        expect(body.operation_code).toBe('image.image_to_image')
        expect(body.input_assets).toEqual([{ asset_id: 12391, role: 'reference_image' }])
      }
      submissions += 1
      await pendingSubmission
      await route.fulfill({
        json: scenario.immediateFailure
          ? { id: 15320, status: 'failed', error_message: currentError }
          : { id: 15320, status: 'pending' },
      })
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
    await expect(page.getByText(`上次生成失败：${oldError}`, { exact: true })).toBeVisible()
    expect(oldTaskQueries).toBe(1)
    await page.getByRole('button', { name: /当前缩放/ }).click()
    await page.locator('.react-flow__node-image').filter({ hasText: oldError }).click()
    const send = page.getByRole('button', { name: /约.*元/ })
    await expect(send).toBeEnabled()
    await send.click()
    await expect.poll(() => submissions).toBe(1)
    const submitted = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/ai/tasks') && response.request().method() === 'POST',
    )
    try {
      await page.clock.runFor(7000)
      expect(oldTaskQueries).toBe(1)
      await expect(page.getByText(oldError, { exact: false })).toHaveCount(0)
      await expect(page.getByText('正在提交任务', { exact: true })).toBeVisible()
      await expect(page.getByTitle('生成过程中不能修改，请添加新的节点使用其他模型')).toBeDisabled()
      expect(submissions).toBe(1)
      if (scenario.edit) expect(estimates).toBeGreaterThan(0)
    } finally {
      releaseSubmission?.()
    }
    await submitted
    await expect(page.getByText('正在提交任务', { exact: true })).toHaveCount(0)
    await page.clock.runFor(7000)
    await expect(page.getByText(currentError, { exact: true })).toBeVisible()
    expect(oldTaskQueries).toBe(1)
    expect(submissions).toBe(1)
    expectNoUnexpectedApi(api)
  })
}
