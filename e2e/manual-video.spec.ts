import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('人工视频估价后提交，失败重试保留请求并恢复任务', async ({ page }, testInfo) => {
  const createdAt = new Date().toISOString()
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  const requests: string[] = []
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
                { name: 'duration', type: 'integer', default: 30 },
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
    expect(route.request().postDataJSON()).toMatchObject({ model_version_id: 77, operation_code: 'video.t1' })
    await route.fulfill({
      json: { code: 0, data: { estimated_cost: 123, balance: 1000, frozen: 0, can_afford: true } },
    })
  })
  await page.route('**/api/v1/ai/tasks**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/ai/tasks' && route.request().method() === 'POST') {
      requests.push(route.request().postData() || '')
      if (requests.length === 1) await route.fulfill({ status: 402, json: { code: 402, message: '余额不足' } })
      else if (requests.length === 2) await route.fulfill({ status: 503, json: { code: 503, message: '暂时不可用' } })
      else if (requests.length === 3) await route.fulfill({ status: 402, json: { code: 402, message: '余额不足' } })
      else await route.fulfill({ json: { code: 0, data: { id: 91, status: 'awaiting_manual', poll_after_ms: 15000 } } })
    } else if (url.pathname === '/api/v1/ai/tasks/91') {
      await route.fulfill({
        json: {
          code: 0,
          data: { id: 91, status: 'awaiting_manual', poll_after_ms: 15000, estimated_cost: 123, created_at: createdAt },
        },
      })
    } else return route.fallback()
  })
  await page.goto('/smart')
  await page.getByRole('textbox', { name: '创作需求' }).fill('人工制作产品介绍')
  const settings = page.getByRole('button', { name: '生成设置' })
  if (await settings.isVisible()) await settings.click()
  await page.getByRole('button', { name: /生成模型/ }).click()
  await page.getByRole('option', { name: /人工制作 · T\+1/ }).click()
  await page.getByRole('button', { name: '去制作' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: '提交精制任务' })).toHaveAttribute('aria-current', 'step')
  await expect(page.getByText('提交精制任务', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('manual-preparing.png'), animations: 'disabled' })
  await expect(page.getByRole('heading', { name: '本次生成参数' })).toBeVisible()
  await expect(page.getByText('123 积分（交付时结算）', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('manual-quote.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '提交精制任务（T+1）' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确\s*认/ })
    .click()
  await expect(page.getByRole('alert')).toContainText('余额不足')
  await expect(page.getByRole('button', { name: '重试原请求' })).toHaveCount(0)
  await page.getByRole('button', { name: '提交精制任务（T+1）' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确\s*认/ })
    .click()
  await expect(page.getByRole('button', { name: '重试原请求' })).toBeVisible()
  await page.getByRole('button', { name: '重试原请求' }).click()
  await expect(page.getByRole('button', { name: '重试原请求' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('余额不足')
  await page.getByRole('button', { name: '重试原请求' }).click()
  await expect(page.getByRole('heading', { name: '任务已提交，等待精制成片' })).toBeVisible()
  await expect(page.getByRole('timer')).toContainText('成片将于')
  expect(requests).toHaveLength(4)
  expect(requests[1]).toBe(requests[2])
  expect(requests[1]).toBe(requests[3])
  expect(JSON.parse(requests[0]).idempotency_key).not.toBe(JSON.parse(requests[1]).idempotency_key)
  const body = JSON.parse(requests[1])
  expect(body).toMatchObject({
    model_version_id: 77,
    operation_code: 'video.t1',
    prompt: '人工制作产品介绍',
    input_assets: [],
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: '任务已提交，等待精制成片' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '任务已提交，等待精制成片' })).toBeVisible()
})

test('窄屏精制确认页展示自动报价', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => {
    localStorage.setItem('zzh_guide_seen_smart_u7', '1')
    localStorage.setItem('zzh.manual.tasks.7.21', JSON.stringify([4272]))
  })
  await page.route('**/api/v1/ai/models**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('capability') !== 'video') return route.fallback()
    await route.fulfill({
      json: {
        code: 0,
        data: [
          {
            id: 77,
            enabled: true,
            operation_codes: ['video.t1'],
            params_schema: { fields: [{ name: 'duration', type: 'integer', default: 30 }] },
          },
        ],
      },
    })
  })
  await page.route('**/api/v1/ai/tasks/estimate-cost', (route) =>
    route.fulfill({ json: { code: 0, data: { estimated_cost: 123, balance: 1000, frozen: 0, can_afford: true } } }),
  )
  await page.goto('/smart')
  await page.getByRole('textbox', { name: '创作需求' }).fill('窄屏精制需求')
  const settings = page.getByRole('button', { name: '生成设置' })
  if (await settings.isVisible()) await settings.click()
  await page.getByRole('button', { name: /生成模型/ }).click()
  await page.getByRole('option', { name: /精制交付 · T\+1/ }).click()
  await page.getByRole('button', { name: '去制作' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('manual-preparing-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await expect(page.getByRole('heading', { name: '本次生成参数' })).toBeVisible()
})

test('已知人工任务的付费修改创建新任务，原任务不被覆盖', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => {
    localStorage.setItem('zzh_guide_seen_smart_u7', '1')
    localStorage.setItem('zzh.manual.tasks.7.21', JSON.stringify([91]))
  })
  let revision: unknown
  await page.route('**/api/v1/ai/tasks/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/ai/tasks/91/revisions') {
      revision = route.request().postDataJSON()
      await route.fulfill({ json: { code: 0, data: { id: 92, parent_task_id: 91, status: 'awaiting_manual' } } })
    } else if (path === '/api/v1/ai/tasks/91') {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            id: 91,
            status: 'succeeded',
            poll_after_ms: 0,
            estimated_cost: 123,
            outputs: [{ type: 'video', url: '/tutorials/smart-create.mp4' }],
          },
        },
      })
    } else if (path === '/api/v1/ai/tasks/92') {
      await route.fulfill({
        json: { code: 0, data: { id: 92, status: 'awaiting_manual', poll_after_ms: 15000, parent_task_id: 91 } },
      })
    } else return route.fallback()
  })
  await page.goto('/smart?manualTask=91')
  await expect(page.getByRole('heading', { name: '精修成片' })).toBeVisible()
  await expect(page.getByLabel('精制视频成片')).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('manual-delivery-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await expect(page.getByText(/再冻结 123 积分/)).toBeVisible()
  await page.getByLabel('修改意见').fill('调整片尾')
  await page.getByRole('button', { name: '申请付费修改' }).click()
  await expect(page.getByRole('heading', { name: '核对修改需求' })).toBeVisible()
  await expect(page.getByText('调整片尾', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '提交第 1 次修改' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确\s*认/ })
    .click()
  await expect(page.getByRole('heading', { name: '第 1 次修改已提交，等待精制成片' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '第 1 次修改已提交，等待精制成片' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(revision).toMatchObject({ workspace_id: 21, instruction: '调整片尾', idempotency_key: expect.any(String) })
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zzh.manual.tasks.7.21') || '[]'))).toEqual([92, 91])
})

test('仅展示明确标识为 T+1 的服务端历史任务', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => window.localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
  await page.route('**/api/v1/ai/models**', (route) => {
    if (new URL(route.request().url()).searchParams.get('capability') !== 'video') return route.fallback()
    return route.fulfill({
      json: {
        code: 0,
        data: [
          {
            id: 77,
            enabled: true,
            operation_codes: ['video.t1'],
            params_schema: { fields: [{ name: 'duration', type: 'integer', default: 30 }] },
          },
        ],
      },
    })
  })
  let secondPageAttempts = 0
  await page.route('**/api/v1/ai/tasks**', async (route) => {
    const url = new URL(route.request().url())
    if (
      url.pathname === '/api/v1/ai/tasks' &&
      route.request().method() === 'GET' &&
      url.searchParams.get('mine') === 'true' &&
      url.searchParams.get('operation_code') === 'video.t1'
    ) {
      expect(url.searchParams.get('operation_code')).toBe('video.t1')
      expect(url.searchParams.get('limit')).toBe('20')
      if (url.searchParams.get('offset') === '20') {
        secondPageAttempts++
        if (secondPageAttempts === 1) return route.fulfill({ status: 503, json: { code: 503, message: '分页失败' } })
        return route.fulfill({
          json: { code: 0, data: { items: [{ id: 930, operation_code: 'video.t1', status: 'succeeded' }], total: 21 } },
        })
      }
      return route.fulfill({
        json: {
          code: 0,
          data: {
            items: [
              { id: 901, operation_code: 'video.t1', status: 'awaiting_manual' },
              { id: 902, operation_code: 'video.generate', status: 'succeeded' },
              ...Array.from({ length: 18 }, (_, i) => ({
                id: 910 + i,
                operation_code: 'video.t1',
                status: 'awaiting_manual',
              })),
            ],
            total: 21,
          },
        },
      })
    }
    if (url.pathname === '/api/v1/ai/tasks/901')
      return route.fulfill({ json: { code: 0, data: { id: 901, status: 'awaiting_manual' } } })
    return route.fallback()
  })
  await page.goto('/smart')
  await page.getByRole('textbox', { name: '创作需求' }).fill('历史任务测试')
  const settings = page.getByRole('button', { name: '生成设置' })
  if (await settings.isVisible()) await settings.click()
  await page.getByRole('button', { name: /生成模型/ }).click()
  await page.getByRole('option', { name: /精制交付 · T\+1/ }).click()
  await page.getByRole('button', { name: '去制作' }).click()
  await page.getByText('查看历史精制任务').click()
  await expect(page.getByRole('button', { name: /任务 #901/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /任务 #902/ })).toHaveCount(0)
  await page.getByRole('button', { name: '加载更多精制任务' }).click()
  await expect(page.getByText(/分页失败/)).toBeVisible()
  await expect(page.getByRole('button', { name: /任务 #901/ })).toBeVisible()
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('button', { name: /任务 #930/ })).toBeVisible()
  expect(secondPageAttempts).toBe(2)
  await page.screenshot({ path: testInfo.outputPath('manual-history.png'), animations: 'disabled' })
  await page.getByRole('button', { name: /任务 #901/ }).click()
  await expect(page.getByRole('heading', { name: '任务已提交，等待精制成片' })).toBeVisible()
})
