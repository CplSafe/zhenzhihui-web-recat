import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

const base = { id: 'one', type: 'text', position: { x: 120, y: 120 }, data: { text: '原始内容', kind: 'text' } }

async function seedPendingDraft(page: import('@playwright/test').Page, canvasId: number) {
  await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(
    ({ base, canvasId }) => {
      localStorage.setItem(
        `zzh_canvas_draft_u7_w21_p${canvasId}`,
        JSON.stringify({
          nodes: [{ ...base, data: { ...base.data, text: '本机修改' } }],
          edges: [],
          textContents: { one: '本机修改' },
          boundCanvasId: canvasId,
          pendingSync: true,
          syncBaseline: { nodes: [base], edges: [] },
          updatedAt: Date.now(),
        }),
      )
    },
    { base, canvasId },
  )
}

async function setup(page: import('@playwright/test').Page, canvasId: number) {
  await seedPendingDraft(page, canvasId)
  let succeed = false
  let saves = 0
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/v1/canvases/${canvasId}**`, (route) => {
    if (route.request().method() === 'PATCH') {
      saves++
      return succeed
        ? route.fulfill({ json: { sync_revision: 2 } })
        : route.fulfill({ status: 400, json: { message: '请求内容无效' } })
    }
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [{ element_id: 'one', kind: 'node', op: 'upsert', payload: base }],
            sync_revision: 1,
            has_more: false,
          }
        : { id: canvasId, title: '手动保存', revision: 1 },
    })
  })
  await page.goto(`/canvas/${canvasId}`)
  await expect(page.getByRole('button', { name: '保存画布' })).toBeVisible()
  return {
    allowSave: () => {
      succeed = true
    },
    saves: () => saves,
  }
}

test('保存失败后手动重试并恢复自动保存状态', async ({ page }, testInfo) => {
  const server = await setup(page, 161)
  expect(server.saves()).toBe(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: '保存画布' })).toBeVisible()
  const saveButton = await page.getByRole('button', { name: '保存画布' }).boundingBox()
  const actionsButton = await page.getByRole('button', { name: '画布操作' }).boundingBox()
  expect(saveButton && actionsButton && saveButton.x + saveButton.width).toBeLessThanOrEqual(actionsButton!.x)
  await page.screenshot({ path: testInfo.outputPath('manual-save-narrow.png') })
  await page.setViewportSize({ width: 1280, height: 720 })
  server.allowSave()
  await page.getByRole('button', { name: '保存画布' }).click()
  await expect(page.getByText('已保存到云端')).toBeVisible()
  expect(server.saves()).toBe(2)
  await expect(page.getByRole('button', { name: '保存画布' })).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('zzh_canvas_draft_u7_w21_p161') || '{}').pendingSync),
    )
    .toBe(false)
  await page.screenshot({ path: testInfo.outputPath('manual-saved.png') })
})

test('离开前保存失败时可留在画布，成功后才能自动离开', async ({ page }, testInfo) => {
  const server = await setup(page, 162)
  await page.getByRole('button', { name: '返回无限画布' }).click()
  const dialog = page.getByRole('alertdialog', { name: '画布尚未保存' })
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('save-before-leaving.png') })
  await dialog.getByRole('button', { name: '保存并离开' }).click()
  const failed = page.getByRole('alertdialog', { name: '保存未完成' })
  await expect(failed).toBeVisible()
  await failed.getByRole('button', { name: '留在画布' }).click()
  await expect(page).toHaveURL(/canvas\/162/)
  server.allowSave()
  await page.getByRole('button', { name: '返回无限画布' }).click()
  await page.getByRole('alertdialog', { name: '画布尚未保存' }).getByRole('button', { name: '保存并离开' }).click()
  await expect(page).toHaveURL(/\/canvas$/)
  expect(server.saves()).toBe(3)
})

test('保存回执缺少版本时以云端读回为准', async ({ page }, testInfo) => {
  const canvasId = 163
  const draftKey = `zzh_canvas_draft_u7_w21_p${canvasId}`
  await seedPendingDraft(page, canvasId)
  let writes = 0
  let checkingCloud = false
  let savedElements: unknown[] = []
  let releaseCloudRead: () => void = () => undefined
  const cloudRead = new Promise<void>((resolve) => {
    releaseCloudRead = resolve
  })
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/v1/canvases/${canvasId}**`, async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith('/elements')) {
      return route.fulfill({ json: { id: canvasId, title: '确认云端保存', revision: 1 } })
    }
    if (route.request().method() === 'PATCH') {
      writes++
      savedElements = route.request().postDataJSON().mutations
      return route.fulfill({ json: {} })
    }
    if (writes) {
      checkingCloud = true
      await cloudRead
      return route.fulfill({ json: { elements: savedElements, sync_revision: 2, has_more: false } })
    }
    return route.fulfill({
      json: {
        elements: [{ element_id: 'one', kind: 'node', op: 'upsert', payload: base }],
        sync_revision: 1,
        has_more: false,
      },
    })
  })
  const savedStatus = page.getByText('已保存到云端')
  try {
    await page.goto(`/canvas/${canvasId}`)
    await expect.poll(() => checkingCloud).toBe(true)
    await expect(savedStatus).toHaveCount(0)
    await expect
      .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').pendingSync, draftKey))
      .toBe(true)
    await page.screenshot({ path: testInfo.outputPath('save-awaiting-cloud-confirmation.png') })
  } finally {
    releaseCloudRead()
  }
  await expect(savedStatus).toBeVisible()
  expect(writes).toBe(1)
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          Object.keys(localStorage)
            .filter((storageKey) => storageKey === key || storageKey.startsWith(`${key}:pending:`))
            .map((storageKey) => JSON.parse(localStorage.getItem(storageKey) || '{}').pendingSync),
        draftKey,
      ),
    )
    .toEqual([false])
  await page.screenshot({ path: testInfo.outputPath('save-confirmed-by-cloud-read.png') })
})
