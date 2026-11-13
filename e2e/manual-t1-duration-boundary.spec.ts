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
  await page.getByRole('option', { name: /精制交付.*T\+1/ }).click()
  await page.getByRole('button', { name: '提交精制需求' }).click()
  await expect(page.getByRole('heading', { name: '本次生成参数' })).toBeVisible()
}

test('精制时长仅提供合法档位，异常值不能触发报价', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  const capture = await mockManualVideo(page)
  await openManualOrderScreen(page, '时长越界精制需求')

  await page.getByText('调整生成参数').click()
  const duration = page.getByLabel('时长（秒）')
  await expect(duration.locator('option')).toHaveText([
    '15 秒',
    '30 秒',
    '45 秒',
    '60 秒',
    '120 秒',
    '180 秒',
    '300 秒',
  ])
  await expect.poll(() => capture.estimates.length).toBe(1)
  expect(capture.estimates[0]).toMatchObject({ operation_code: 'video.t1', model_version_id: 77 })
  expect(capture.estimates[0].params.duration).toBe(30)
  expect(Number.isInteger(capture.estimates[0].params.duration)).toBe(true)

  // 模拟被篡改的下拉值，确认前端校验不会发起报价。
  for (const invalid of ['14', '301', '30.5']) {
    await duration.evaluate((element: HTMLSelectElement, value) => {
      element.add(new Option(value, value))
      element.value = value
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }, invalid)
    await page.getByRole('button', { name: '重新获取报价' }).click()
    await expect(page.getByRole('alert').filter({ hasText: '请选择模型支持的时长' })).toBeVisible()
    expect(capture.estimates).toHaveLength(1)
    expect(capture.creates).toHaveLength(0)
  }

  await page.getByRole('alert').filter({ hasText: '请选择模型支持的时长' }).scrollIntoViewIfNeeded()
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

  await page.getByText('调整生成参数').click()
  const duration = page.getByLabel('时长（秒）')

  const parameterCard = page.getByLabel('本次生成参数')

  // 下边界 15 秒
  await duration.selectOption('15')
  await expect.poll(() => capture.estimates.length).toBe(2)
  await expect(page.getByRole('button', { name: '提交精制任务（T+1）' })).toBeEnabled()
  await expect(parameterCard.locator('dd').filter({ hasText: /^15 秒$/ })).toBeVisible()
  expect(capture.estimates).toHaveLength(2)
  expect(capture.estimates[1].params.duration).toBe(15)
  expect(Number.isInteger(capture.estimates[1].params.duration)).toBe(true)

  // 上边界 300 秒
  await duration.selectOption('300')
  await expect.poll(() => capture.estimates.length).toBe(3)
  await expect(page.getByRole('button', { name: '提交精制任务（T+1）' })).toBeEnabled()
  await expect(parameterCard.locator('dd').filter({ hasText: /^300 秒$/ })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: '任务已提交，等待精制成片' })).toBeVisible()
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

  // 创建请求挂在飞行中，确认按钮必须禁用，不能发出第二个请求。
  await expect.poll(() => capture.creates.length, { timeout: 5000 }).toBe(1)
  const repeatedConfirm = page.getByRole('dialog').getByRole('button', { name: /确\s*认/ })
  await expect(repeatedConfirm).toBeDisabled()
  await page.screenshot({
    path: testInfo.outputPath('manual-submit-locked.png'),
    fullPage: true,
    animations: 'disabled',
  })

  await expect(page.getByRole('heading', { name: '任务已提交，等待精制成片' })).toBeVisible({ timeout: 15000 })
  expect(capture.creates).toHaveLength(1)
  expect(JSON.parse(capture.creates[0]).idempotency_key).toBeTruthy()
})

test('窄屏精制时长选项与报价可用', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  const capture = await mockManualVideo(page)
  await openManualOrderScreen(page, '窄屏精制需求')
  await page.getByText('调整生成参数').click()
  const duration = page.getByLabel('时长（秒）')
  await duration.selectOption('60')
  await expect.poll(() => capture.estimates.at(-1)?.params.duration).toBe(60)
  await expect(page.getByRole('button', { name: '提交精制任务（T+1）' })).toBeEnabled()
  await duration.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('manual-mobile.png'), animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
