import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('创作入口的视频模型保持后台顺序', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.addInitScript(() => localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        data: [
          { id: 43, enabled: true, display_name: 'Seedance 2.5', operation_codes: ['video.generate'] },
          { id: 42, enabled: true, display_name: 'Framora 1.0', operation_codes: ['video.generate'] },
        ],
      },
    }),
  )
  await page.goto('/smart')
  await page.getByRole('button', { name: /^生成模型，/ }).click()
  const options = page.getByRole('option')
  await expect(options).toHaveCount(2)
  await expect(options.nth(0)).toContainText('Seedance 2.5')
  await expect(options.nth(1)).toContainText('Framora 1.0')
  await page.screenshot({ path: testInfo.outputPath('backend-model-order.png') })
  expectNoUnexpectedApi(api)
})

test('分享链接只返回URL也可重开回显，查询失败必须重试', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/canvases/125**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, has_more: false }
        : { id: 125, title: '分享回显回归', revision: 1 },
    }),
  )
  let reads = 0
  let writes = 0
  await page.route('**/api/v1/canvases/125/share?**', (route) => {
    if (route.request().method() !== 'GET') writes++
    reads++
    return reads === 3
      ? route.fulfill({ status: 503, json: { message: '分享状态暂时不可用' } })
      : route.fulfill({ json: { data: { url: 'https://example.invalid/shared-canvas', status: 'active' } } })
  })
  await page.goto('/canvas/125')
  const open = page.getByRole('button', { name: '分享这块画布', exact: true })
  for (let count = 0; count < 2; count++) {
    await open.click()
    const dialog = page.getByRole('dialog', { name: '分享画布' })
    await expect(dialog.getByRole('textbox', { name: '分享链接' })).toHaveValue('https://example.invalid/shared-canvas')
    await expect(dialog.getByRole('button', { name: '重新生成链接' })).toBeVisible()
    await dialog.getByRole('button', { name: '关闭分享弹窗' }).click()
  }
  await open.click()
  const dialog = page.getByRole('dialog', { name: '分享画布' })
  await expect(dialog.getByRole('button', { name: '重新读取分享状态' })).toBeVisible()
  await expect(dialog.getByText('这块画布还没有分享链接。')).toHaveCount(0)
  await dialog.getByRole('button', { name: '重新读取分享状态' }).click()
  await expect(dialog.getByRole('textbox', { name: '分享链接' })).toHaveValue('https://example.invalid/shared-canvas')
  expect(reads).toBe(4)
  expect(writes).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('share-reopened.png') })
  await page.setViewportSize({ width: 760, height: 800 })
  await expect(dialog.getByRole('textbox', { name: '分享链接' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('share-reopened-narrow.png') })
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})

test('图片入口与确认框使用相同素材和schema估价，保留预冻结说明', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('zzh_guide_seen_smart_u7', '1')
    sessionStorage.setItem(
      'zzh.smart-entry.draft.v2_u7_ws21',
      JSON.stringify({
        mode: 'image',
        text: '商品展示',
        ratio: '16:9',
        outputCount: 1,
        images: ['/api/v1/assets/701/download?workspace_id=21'],
        imageAssetIds: [701],
        generationModels: { 'image.image_to_image': 42 },
      }),
    )
  })
  const model = {
    id: 42,
    enabled: true,
    display_name: 'Nano Banana 测试',
    provider: 'google',
    operation_codes: ['image.text_to_image', 'image.image_to_image'],
    params_schema: {
      fields: [
        { name: 'aspect_ratio', type: 'string', options: ['16:9', '9:16'], default: '16:9' },
        { name: 'size', type: 'string', options: ['1K', '2K'], default: '2K' },
        { name: 'count', type: 'integer', default: 1 },
      ],
    },
  }
  await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: { data: [model] } }))
  const quotes: Array<Record<string, any>> = []
  let tasks = 0
  const submissions: Array<Record<string, any>> = []
  await page.route('**/api/v1/creative/projects?**', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ json: { id: 303, project_id: 303, draft_revision: 0 } })
      : route.fallback(),
  )
  let revision = 0
  await page.route('**/api/v1/creative/projects/303**', (route) =>
    route.fulfill({ json: { id: 303, project_id: 303, draft_revision: ++revision } }),
  )
  await page.route('**/api/v1/ai/tasks/estimate-cost', (route) => {
    quotes.push(route.request().postDataJSON())
    return route.fulfill({
      json: {
        estimated_cost: 13.25,
        balance: 9000,
        can_afford: true,
        estimate_kind: 'reservation',
        estimate_note: '完成后按实际用量结算',
      },
    })
  })
  await page.route('**/api/v1/ai/tasks', (route) => {
    tasks++
    submissions.push(route.request().postDataJSON())
    return route.fulfill({ status: 400, json: { message: '模拟生成失败，保留输入' } })
  })
  await page.goto('/smart')
  await expect(page.getByRole('tab', { name: '制作图片' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('预冻结金额 约0.27元', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '去制作', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: '确认生成图片' })
  await expect(dialog).toContainText('预冻结金额共 约0.27元')
  await expect(dialog).toContainText('完成后按实际用量结算')
  expect(quotes.length).toBeGreaterThanOrEqual(2)
  for (const quote of quotes) {
    expect(quote).toMatchObject({
      workspace_id: WORKSPACE_ID,
      model_version_id: 42,
      operation_code: 'image.image_to_image',
      prompt: '商品展示',
      input_assets: [{ asset_id: 701, role: 'reference_image' }],
      params: { aspect_ratio: '16:9', size: '2K', count: 1 },
    })
  }
  await page.screenshot({ path: testInfo.outputPath('image-reservation-confirm.png') })
  await page.setViewportSize({ width: 760, height: 800 })
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('image-reservation-confirm-narrow.png') })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(tasks).toBe(0)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByRole('button', { name: '去制作', exact: true }).click()
  await dialog.getByRole('button', { name: '确认并生成', exact: true }).click()
  await expect.poll(() => tasks).toBe(1)
  await expect(page.getByText('模拟生成失败，保留输入', { exact: false }).first()).toBeVisible()
  const lastQuote = quotes.at(-1)!
  expect(submissions[0]).toMatchObject({
    model_version_id: lastQuote.model_version_id,
    operation_code: lastQuote.operation_code,
    prompt: lastQuote.prompt,
    input_assets: lastQuote.input_assets,
    params: lastQuote.params,
  })
  await expect(page.locator('#image-generation-cost')).toContainText('预冻结金额 约0.27元')
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})
