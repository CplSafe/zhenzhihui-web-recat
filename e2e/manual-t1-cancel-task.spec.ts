import { expect, test, type Page } from '@playwright/test'
import { installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const OWNER_ID = 7
const TASK_ID = 91

type CancelCapture = {
  cancels: Array<{ path: string; method: string; workspaceId: string | null; body: string }>
  creates: string[]
  taskGets: number[]
}

/**
 * T+1 精制任务态的接口桩。
 * 任务 91 处于 awaiting_manual，取消接口的返回由 cancelHandler 决定，
 * 便于分别覆盖「取消成功」与「取消失败」两条路径。
 */
async function mockManualTask(
  page: Page,
  options: { cancelHandler?: (capture: CancelCapture) => Promise<'ok' | 'fail'> } = {},
): Promise<CancelCapture> {
  const capture: CancelCapture = { cancels: [], creates: [], taskGets: [] }
  let cancelled = false

  await page.route('**/api/v1/ai/tasks/91**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname === `/api/v1/ai/tasks/${TASK_ID}/cancel`) {
      capture.cancels.push({
        path: url.pathname,
        method,
        workspaceId: url.searchParams.get('workspace_id'),
        body: route.request().postData() || '',
      })
      const outcome = options.cancelHandler ? await options.cancelHandler(capture) : 'ok'
      if (outcome === 'fail') {
        return route.fulfill({ status: 409, json: { code: 409, message: '任务已进入交付流程，无法取消' } })
      }
      cancelled = true
      return route.fulfill({
        json: { code: 0, data: { id: TASK_ID, status: 'cancelled', poll_after_ms: 0, estimated_cost: 123 } },
      })
    }
    if (url.pathname === `/api/v1/ai/tasks/${TASK_ID}` && method === 'GET') {
      capture.taskGets.push(Date.now())
      return route.fulfill({
        json: {
          code: 0,
          data: {
            id: TASK_ID,
            status: cancelled ? 'cancelled' : 'awaiting_manual',
            poll_after_ms: cancelled ? 0 : 60000,
            estimated_cost: 123,
          },
        },
      })
    }
    return route.fallback()
  })

  await page.route('**/api/v1/ai/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    capture.creates.push(route.request().postData() || '')
    return route.fulfill({ json: { code: 0, data: { id: 999, status: 'awaiting_manual', poll_after_ms: 60000 } } })
  })

  return capture
}

/** 种入「已知精制任务」，否则任务态会提示无法确认归属。 */
async function openManualTask(page: Page) {
  await page.addInitScript(
    ([owner, workspace, id]) => {
      window.localStorage.setItem('zzh_guide_seen_smart_u7', '1')
      window.localStorage.setItem(`zzh.manual.tasks.${owner}.${workspace}`, JSON.stringify([id]))
      window.localStorage.setItem(`zzh.manual.tasks.${owner}.1`, JSON.stringify([id]))
    },
    [OWNER_ID, WORKSPACE_ID, TASK_ID] as const,
  )
  await page.goto(`/smart?manualTask=${TASK_ID}`)
  await expect(page.getByRole('heading', { name: '任务已提交，等待精制成片' })).toBeVisible()
  await expect(page.getByText(`任务编号：${TASK_ID}`)).toBeVisible()
  await expect(page.getByRole('button', { name: '取消任务' })).toBeVisible()
}

test('精制任务取消必须二次确认，确认后置为已取消且不再暴露取消入口', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const capture = await mockManualTask(page)
  await openManualTask(page)

  // 点取消先弹二次确认，说明积分退回，不直接发请求
  await page.getByRole('button', { name: '取消任务' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('确认取消任务？')).toBeVisible()
  await expect(dialog.getByText('取消后退回本次任务积分。')).toBeVisible()
  expect(capture.cancels).toHaveLength(0)

  await page.screenshot({ path: testInfo.outputPath('t1-09-取消确认弹窗.png'), animations: 'disabled' })

  await dialog.getByRole('button', { name: /确\s*认/ }).click()

  await expect.poll(() => capture.cancels.length, { timeout: 10000 }).toBe(1)
  const cancel = capture.cancels[0]
  expect(cancel.method).toBe('POST')
  expect(cancel.path).toBe(`/api/v1/ai/tasks/${TASK_ID}/cancel`)
  expect(['1', String(WORKSPACE_ID)]).toContain(cancel.workspaceId)

  // 取消成功后任务态落到「已取消」，取消入口消失，且没有另建新任务
  await expect(page.getByRole('heading', { name: '已取消' })).toBeVisible()
  await expect(page.getByRole('button', { name: '取消任务' })).toHaveCount(0)
  await expect(page.getByText('任务已提交，等待精制成片')).toHaveCount(0)
  expect(capture.creates).toHaveLength(0)
  expect(capture.cancels).toHaveLength(1)

  await page.screenshot({ path: testInfo.outputPath('t1-09-取消后已取消.png'), fullPage: true, animations: 'disabled' })
})

test('取消接口失败时保留取消入口并原样展示失败原因', async ({ page }, testInfo) => {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const capture = await mockManualTask(page, { cancelHandler: async () => 'fail' })
  await openManualTask(page)

  await page.getByRole('button', { name: '取消任务' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /确\s*认/ }).click()

  await expect.poll(() => capture.cancels.length, { timeout: 10000 }).toBe(1)
  await expect(dialog.getByRole('alert').filter({ hasText: '任务已进入交付流程，无法取消' })).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('t1-09-取消失败提示.png'), animations: 'disabled' })

  // 失败后任务仍为待制作，取消入口继续可用，不会静默把任务当作已取消
  await dialog.getByRole('button', { name: /取\s*消/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '任务已提交，等待精制成片' })).toBeVisible()
  await expect(page.getByRole('button', { name: '取消任务' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '已取消' })).toHaveCount(0)
  expect(capture.creates).toHaveLength(0)
})
