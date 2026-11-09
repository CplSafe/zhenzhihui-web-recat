import { expect, test, type Page } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

type ManualVideoCapture = {
  estimates: Array<Record<string, any>>
  creates: string[]
}

/**
 * T+1 精制交付的接口桩。
 * durationDefault 控制 params_schema 里 duration 的默认值；
 * createDelayMs 用来把创建任务挂在飞行中，验证提交期间不可重复触发。
 */
async function mockManualVideo(
  page: Page,
  options: { durationDefault?: number; createDelayMs?: number } = {},
): Promise<ManualVideoCapture> {
  const capture: ManualVideoCapture = { estimates: [], creates: [] }
  await page.route('**/api/v1/ai/models**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('capability') !== 'video') return route.fallback()
    await route.fulfill({
      json: {
        code: 0,
        data: [
          { id: 76, provider: 'manual-video', model: 'other', enabled: true, operation_codes: ['video.generate'] },
          {
            id: 77,
            provider: 'manual-video',
            enabled: true,
            display_name: '人工制作',
            operation_codes: ['video.t1'],
            params_schema: {
              fields: [
                { name: 'duration', type: 'integer', default: options.durationDefault ?? 30 },
                { name: 'ratio', options: ['16:9'], default: '16:9' },
                { name: 'resolution', options: ['720p'], default: '720p' },
                { name: 'generate_audio', type: 'boolean', default: false },
              ],
            },
          },
        ],
      },
    })
  })
  await page.route('**/api/v1/ai/tasks/estimate-cost', async (route) => {
    capture.estimates.push(route.request().postDataJSON() as Record<string, any>)
    await route.fulfill({
      json: { code: 0, data: { estimated_cost: 123, balance: 1000, frozen: 0, can_afford: true } },
    })
  })
  await page.route('**/api/v1/ai/tasks**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/ai/tasks' && route.request().method() === 'POST') {
      capture.creates.push(route.request().postData() || '')
      if (options.createDelayMs) await new Promise((resolve) => setTimeout(resolve, options.createDelayMs))
      return route.fulfill({ json: { code: 0, data: { id: 91, status: 'awaiting_manual', poll_after_ms: 15000 } } })
    }
    if (url.pathname === '/api/v1/ai/tasks/91') {
      return route.fulfill({
        json: { code: 0, data: { id: 91, status: 'awaiting_manual', poll_after_ms: 15000, estimated_cost: 123 } },
      })
    }
    return route.fallback()
  })
  return capture
}

/** 走到精制交付的「本次生成参数」屏，此时已按默认时长拿到一次报价。 */
async function openManualOrderScreen(page: Page, prompt: string) {
  await page.goto('/smart')
  await page.getByRole('textbox', { name: '创作需求' }).fill(prompt)
  const settings = page.getByRole('button', { name: '生成设置' })
  if (await settings.isVisible()) await settings.click()
  await page.getByRole('button', { name: /生成模型/ }).click()
  await page.getByRole('button', { name: /精制交付 · T\+1/ }).click()
  await page.getByRole('button', { name: '去制作' }).click()
  await expect(page.getByRole('heading', { name: '核对制作需求' })).toBeVisible()
  await page.getByRole('button', { name: '查看订单 →' }).click()
  await expect(page.getByRole('heading', { name: '本次生成参数' })).toBeVisible()
}

test('精制时长越界或非整数时明确提示且不发起估价', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  const capture = await mockManualVideo(page)
  await openManualOrderScreen(page, '时长越界精制需求')

  const duration = page.getByLabel('时长（秒）')
  await expect(duration).toHaveAttribute('min', '15')
  await expect(duration).toHaveAttribute('max', '300')
  await expect(duration).toHaveAttribute('step', '1')
  expect(capture.estimates).toHaveLength(1)
  expect(capture.estimates[0]).toMatchObject({ operation_code: 'video.t1', model_version_id: 77 })
  expect(capture.estimates[0].params.duration).toBe(30)
  expect(Number.isInteger(capture.estimates[0].params.duration)).toBe(true)

  // 14 / 301 越界，30.5 非整数：三者都必须停在提示上，不能进入估价
  for (const invalid of ['14', '301', '30.5']) {
    await duration.fill(invalid)
    const requote = page.getByRole('button', { name: '重新获取报价' })
    await expect(requote).toBeVisible()
    await requote.click()
    await expect(page.getByRole('alert').filter({ hasText: '时长须为 15 至 300 秒的整数' })).toBeVisible()
    expect(capture.estimates).toHaveLength(1)
    expect(capture.creates).toHaveLength(0)
  }

  await page.getByRole('alert').filter({ hasText: '时长须为 15 至 300 秒的整数' }).scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath('manual-duration-rejected.png'),
    fullPage: true,
    animations: 'disabled',
  })
})

test('精制时长 15 与 300 边界可估价并按整数秒原样下发', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  const capture = await mockManualVideo(page)
  await openManualOrderScreen(page, '时长边界精制需求')

  const duration = page.getByLabel('时长（秒）')

  const parameterCard = page.getByLabel('本次生成参数')

  // 下边界 15 秒
  await duration.fill('15')
  await page.getByRole('button', { name: '重新获取报价' }).click()
  await expect(parameterCard.getByText('15 秒', { exact: true })).toBeVisible()
  expect(capture.estimates).toHaveLength(2)
  expect(capture.estimates[1].params.duration).toBe(15)
  expect(Number.isInteger(capture.estimates[1].params.duration)).toBe(true)

  // 上边界 300 秒
  await duration.fill('300')
  await page.getByRole('button', { name: '重新获取报价' }).click()
  await expect(parameterCard.getByText('300 秒', { exact: true })).toBeVisible()
  expect(capture.estimates).toHaveLength(3)
  expect(capture.estimates[2].params.duration).toBe(300)
  expect(Number.isInteger(capture.estimates[2].params.duration)).toBe(true)

  await page.screenshot({ path: testInfo.outputPath('manual-duration-boundary.png'), animations: 'disabled' })

  // 提交时必须原样沿用最后一次估价快照里的整数时长，不重新取值
  await page.getByRole('button', { name: '提交精制任务（T+1）' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确\s*认/ })
    .click()
  await expect(page.getByText('任务编号：91')).toBeVisible()
  expect(capture.creates).toHaveLength(1)
  const createBody = JSON.parse(capture.creates[0])
  expect(createBody).toMatchObject({
    model_version_id: 77,
    operation_code: 'video.t1',
    prompt: '时长边界精制需求',
  })
  expect(createBody.params.duration).toBe(300)
  expect(createBody.params).toEqual(capture.estimates[2].params)
})

test('精制任务提交进行中不暴露重复提交入口且只创建一个任务', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  const capture = await mockManualVideo(page, { createDelayMs: 2000 })
  await openManualOrderScreen(page, '防重复提交需求')

  await page.getByRole('button', { name: '提交精制任务（T+1）' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确\s*认/ })
    .click()

  // 创建请求挂在飞行中：此刻再次确认也不能产生第二个付费任务
  await expect.poll(() => capture.creates.length, { timeout: 5000 }).toBe(1)
  const repeatedConfirm = page.getByRole('dialog').getByRole('button', { name: /确\s*认/ })
  if (await repeatedConfirm.count()) {
    await repeatedConfirm
      .first()
      .click({ timeout: 1500, force: true })
      .catch(() => {})
    await page.waitForTimeout(500)
  }
  const idempotencyKeys = capture.creates.map((body) => JSON.parse(body).idempotency_key)
  expect(idempotencyKeys.length).toBeGreaterThanOrEqual(1)
  expect(new Set(idempotencyKeys).size).toBe(1)
  await page.screenshot({
    path: testInfo.outputPath('manual-submit-locked.png'),
    fullPage: true,
    animations: 'disabled',
  })

  await expect(page.getByText('任务编号：91')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('任务编号：91')).toHaveCount(1)
})
