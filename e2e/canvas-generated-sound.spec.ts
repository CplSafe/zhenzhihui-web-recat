import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

// 每例包含首次加载、保存和完整刷新，顺序执行以免多个重载同时争用本机浏览器资源。
test.describe.configure({ mode: 'default' })

const cases = [
  { field: 'generate_audio', sound: false, width: 1440, fresh: false },
  { field: 'audio', sound: true, width: 1440, fresh: false },
  { field: 'with_audio', sound: false, width: 760, fresh: false },
  { field: 'enable_audio', sound: true, width: 760, fresh: true },
]
for (const { field, sound, width, fresh } of cases) {
  test(`生成声音：${field}=${sound}，保存刷新与预估提交一致 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const api = await installStrictAuthenticatedApp(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: 42,
              display_name: '声音回归视频模型',
              capability: 'video',
              operation_codes: ['video.generate'],
              params_schema: {
                fields: [
                  { name: 'duration', display_name: '时长', options: [5, 10], default: 5 },
                  { name: field, display_name: '自动添加背景音', type: 'bool', default: false },
                ],
              },
            },
          ],
        },
      }),
    )
    let revision = 1
    let data: Record<string, any> = {
      kind: 'video',
      title: '声音设置',
      modelVersionId: 42,
      operationCode: 'video.generate',
      prompt: '测试声音选择',
      params: fresh ? {} : { [field]: false },
    }
    await page.route('**/api/v1/canvases/131**', (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'PATCH') {
        for (const mutation of route.request().postDataJSON().mutations || []) {
          if (mutation.element_id === 'sound-video' && mutation.kind === 'node' && mutation.op === 'upsert')
            data = { ...data, ...mutation.payload.data }
        }
        return route.fulfill({ json: { revision: ++revision, sync_revision: revision } })
      }
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements:
                Number(url.searchParams.get('after_revision')) > 0
                  ? []
                  : [
                      {
                        element_id: 'sound-video',
                        kind: 'node',
                        op: 'upsert',
                        payload: {
                          id: 'sound-video',
                          type: 'video',
                          position: { x: 180, y: 50 },
                          style: { width: 320, height: 240 },
                          data,
                        },
                      },
                    ],
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 131, title: '生成声音回归', revision },
      })
    })
    const estimates: Record<string, any>[] = []
    const submissions: Record<string, any>[] = []
    await page.route('**/api/v1/ai/tasks/estimate-cost', (route) => {
      estimates.push(route.request().postDataJSON())
      return route.fulfill({ json: { estimated_cost: 10, balance: 9000, can_afford: true } })
    })
    await page.route('**/api/v1/ai/tasks', (route) => {
      submissions.push(route.request().postDataJSON())
      return route.fulfill({ status: 400, json: { message: '声音回归模拟提交，保留设置' } })
    })
    await page.goto('/canvas/131')
    const node = page.locator('.react-flow__node[data-id="sound-video"]')
    const panel = page.locator('[data-canvas-node-panel]')
    await expect(node).toBeVisible()
    await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('100')
    await expect
      .poll(() =>
        page.locator('.react-flow__viewport').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a),
      )
      .toBe(1)
    await node.click()
    const modelTrigger = panel.getByRole('button', { name: '声音回归视频模型', exact: true })
    await modelTrigger.click()
    await expect(page.getByRole('listbox', { name: '生成模型列表' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox', { name: '生成模型列表' })).toHaveCount(0)
    const label = sound ? '有声音' : '无声音'
    await expect(
      panel.getByRole('button', { name: new RegExp(`自由生成.*${fresh ? '有声音' : '无声音'}`) }),
    ).toBeVisible()
    await panel.getByRole('button', { name: /自由生成/ }).click()
    const menu = page.getByRole('region', { name: '生成参数' })
    await expect(menu.getByRole('group', { name: '生成声音', exact: true })).toBeVisible()
    await expect(menu.getByRole('button', { name: fresh ? '有声音' : '无声音', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(menu.getByText(/自动添加背景音|有背景音|无背景音/)).toHaveCount(0)
    // 两次选择确保开关两向可用，也确保目标值真正经过保存链路。
    await menu.getByRole('button', { name: sound ? '无声音' : '有声音', exact: true }).click()
    await menu.getByRole('button', { name: label, exact: true }).click()
    await expect(menu.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: testInfo.outputPath(`sound-options-${field}-${width}.png`) })
    await menu.getByRole('button', { name: '关闭生成参数' }).click()
    await expect.poll(() => data.params?.[field]).toBe(sound)
    estimates.length = 0
    await page.reload()
    await expect(node).toBeVisible()
    await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('100')
    await expect
      .poll(() =>
        page.locator('.react-flow__viewport').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a),
      )
      .toBe(1)
    await node.click()
    await expect(panel.getByRole('button', { name: new RegExp(`自由生成.*${label}`) })).toBeVisible()
    await panel.getByRole('button', { name: /自由生成/ }).click()
    await expect(menu.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await menu.getByRole('button', { name: '关闭生成参数' }).click()
    await expect.poll(() => estimates.at(-1)?.params?.[field]).toBe(sound)
    await expect(panel.getByText('预计消耗：约0.2元', { exact: true })).toBeVisible()
    const send = panel.locator('[data-canvas-generate]')
    await expect(send).toBeEnabled()
    await send.click()
    const confirm = page.getByRole('alertdialog', { name: '确认生成费用' })
    await expect(confirm).toBeVisible()
    expect(submissions).toHaveLength(0)
    await confirm.getByRole('button', { name: '继续生成' }).click()
    await expect.poll(() => submissions.length).toBe(1)
    expect(submissions[0]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      operation_code: 'video.generate',
      params: { [field]: sound },
    })
    await expect(page.getByText('声音回归模拟提交，保留设置', { exact: false }).first()).toBeVisible()
    await expect(send).toBeEnabled()
    await expect(panel.getByRole('button', { name: new RegExp(`自由生成.*${label}`) })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`sound-restored-${field}-${width}.png`) })
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
