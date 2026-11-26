import { expect, test, type Page } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

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

type ExitNode = {
  id: string
  type: 'text' | 'image'
  position: { x: number; y: number }
  data: { kind: 'text' | 'image'; title?: string; text?: string; prompt?: string }
}

async function mockExitCanvas(page: Page, canvasId: number, initialNodes: ExitNode[]) {
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  await page.addInitScript(() => localStorage.setItem('zzh_guide_seen_home_u7', '1'))
  const title = '保存离开回归'
  const initial = initialNodes.map((node) => ({ element_id: node.id, kind: 'node', op: 'upsert', payload: node }))
  const elements = new Map(initial.map((element) => [element.element_id, element]))
  let revision = 1
  let staleReadCount = 0
  let simulateStaleReopen = false
  let releaseWrites!: () => void
  const writeGate = new Promise<void>((resolve) => {
    releaseWrites = resolve
  })
  let releaseFreshRead!: () => void
  const readGate = new Promise<void>((resolve) => {
    releaseFreshRead = resolve
  })
  await page.route('**/api/v1/canvases?**', (route) =>
    route.fulfill({ json: { items: [{ id: canvasId, title }], total: 1 } }),
  )
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.routeWebSocket(`**/api/v1/canvases/${canvasId}/node-locks/socket?**`, (socket) => {
    socket.onMessage(() => socket.send(JSON.stringify({ type: 'state', data: { granted: true, nodes: {} } })))
  })
  await page.route(`**/api/v1/canvases/${canvasId}**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/events')) return route.fulfill({ status: 204 })
    if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
    if (!url.pathname.endsWith('/elements')) return route.fulfill({ json: { id: canvasId, title } })
    if (route.request().method() === 'PATCH') {
      await writeGate
      const { mutations } = route.request().postDataJSON() as { mutations: typeof initial }
      for (const mutation of mutations) elements.set(mutation.element_id, mutation)
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    const afterRevision = Number(url.searchParams.get('after_revision') || 0)
    const referer = route.request().headers().referer
    const openedFromEditor = referer && new URL(referer).pathname === `/canvas/${canvasId}`
    if (simulateStaleReopen && openedFromEditor && afterRevision === 0 && url.searchParams.get('limit') !== '1') {
      if (!staleReadCount++) return route.fulfill({ json: { elements: initial, sync_revision: 1, has_more: false } })
      await readGate
    }
    return route.fulfill({
      json: {
        elements: afterRevision >= revision ? [] : [...elements.values()],
        sync_revision: revision,
        has_more: false,
      },
    })
  })

  await page.goto(`/canvas/${canvasId}`)
  await expect(page.getByTitle('添加节点')).toBeVisible()
  return {
    api,
    elements,
    releaseWrites,
    releaseFreshRead,
    staleReadCount: () => staleReadCount,
    revision: () => revision,
    reopen: async (readStale = false) => {
      simulateStaleReopen = readStale
      await page.getByRole('button', { name: `打开画布 ${title}` }).click()
      await expect(page).toHaveURL(new RegExp(`/canvas/${canvasId}$`))
    },
  }
}

async function confirmCanvasExit(page: Page, releaseWrites: () => void) {
  const confirm = page.getByRole('alertdialog', { name: '画布尚未保存' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '保存并离开' }).click()
  releaseWrites()
  await expect(page).toHaveURL(/\/canvas$/)
}

test('富文本提示词仍在等待写回时，保存并离开后重开仍有最新内容', async ({ page }, testInfo) => {
  const canvasId = 164
  const image: ExitNode = {
    id: 'image',
    type: 'image',
    position: { x: 150, y: 130 },
    data: { kind: 'image', prompt: '旧提示词' },
  }
  const server = await mockExitCanvas(page, canvasId, [image])
  const header = page.locator('.react-flow__node[data-id="image"] .canvas-node-header')
  const prompt = page.getByRole('textbox', { name: /描述你想要生成/ })
  const latest = '清晨远景，\n推近镜头并保留 **天空层次**'
  try {
    await header.click()
    await expect(prompt).toHaveText('旧提示词')
    // Dispatch editing and the exit control in the same browser task, before debounce or blur can write back.
    await prompt.evaluate((element, value) => {
      ;(element as HTMLElement).focus()
      element.textContent = value
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
      document.querySelector<HTMLButtonElement>('button[aria-label="返回无限画布"]')!.click()
    }, latest)
    await confirmCanvasExit(page, server.releaseWrites)
  } finally {
    server.releaseWrites()
    server.releaseFreshRead()
  }

  expect(server.elements.get(image.id)?.payload.data.prompt).toBe(latest)
  await server.reopen()
  await expect(page.getByTitle('添加节点')).toBeVisible()
  await header.click()
  await expect(prompt).toHaveText(/推近镜头并保留 \*\*天空层次\*\*/)
  await page.screenshot({ path: testInfo.outputPath('reopened-latest-editable-prompt.png') })
  expectNoUnexpectedApi(server.api)
})

test('保存离开后重开遇到旧云端版本，保留新位置、正文和分镜内容', async ({ page }, testInfo) => {
  const canvasId = 165
  const text: ExitNode = {
    id: 'plain',
    type: 'text',
    position: { x: 100, y: 160 },
    data: { kind: 'text', text: '原正文' },
  }
  const storyboard: ExitNode = {
    id: 'storyboard',
    type: 'text',
    position: { x: 460, y: 150 },
    data: { kind: 'text', text: JSON.stringify([{ title: '街景', prompt: '原分镜' }]) },
  }
  const server = await mockExitCanvas(page, canvasId, [text, storyboard])
  const plainNode = page.locator('.react-flow__node[data-id="plain"]')
  const body = plainNode.locator('.canvas-node-body')
  const shot = page.getByRole('textbox', { name: '镜头 1 提示词' })
  const latestText = '保存离开前更新的正文'
  const latestShot = '保留街景，镜头改为缓慢向右摇移'
  const readPosition = () =>
    plainNode.evaluate((node) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform)
      return { x: matrix.m41, y: matrix.m42 }
    })

  try {
    await expect(shot).toHaveValue('原分镜')
    const before = await readPosition()
    const box = await body.boundingBox()
    if (!box) throw new Error('未找到文本节点拖动区域')
    const x = box.x + box.width * 0.45
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 62, y + 74, { steps: 8 })
    await page.mouse.up()
    await expect.poll(readPosition).not.toEqual(before)
    await body.dblclick()
    await body.locator('textarea').fill(latestText)
    await shot.fill(latestShot)
    await page.getByRole('button', { name: '返回无限画布' }).click()
    await confirmCanvasExit(page, server.releaseWrites)

    const stored = server.elements.get(text.id)?.payload
    expect(stored?.position).not.toEqual(text.position)
    expect(stored?.data.text).toBe(latestText)
    expect(JSON.parse(server.elements.get(storyboard.id)?.payload.data.text || '[]')).toMatchObject([
      { prompt: latestShot },
    ])

    await server.reopen(true)
    await expect.poll(server.staleReadCount).toBeGreaterThanOrEqual(1)
    await expect(page.getByText('正在核对最近保存的画布版本，暂时仅可预览')).toBeVisible()
    await expect(page.getByTitle('添加节点')).toHaveCount(0)
    await expect(body).toHaveText(latestText)
    await expect(shot).toHaveValue(latestShot)
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const cache = JSON.parse(localStorage.getItem(`zzh_canvas_draft_u7_w21_p${id}`) || '{}')
          return cache.confirmedRevision
        }, canvasId),
      )
      .toBe(server.revision())
    await page.screenshot({ path: testInfo.outputPath('reopened-confirmed-preview-during-stale-read.png') })
    server.releaseFreshRead()
    await expect(page.getByTitle('添加节点')).toBeVisible()
    await expect(body).toHaveText(latestText)
    await expect(shot).toHaveValue(latestShot)
    const reopened = await readPosition()
    expect(reopened.x).toBeCloseTo(stored!.position.x, 1)
    expect(reopened.y).toBeCloseTo(stored!.position.y, 1)
  } finally {
    server.releaseWrites()
    server.releaseFreshRead()
  }
  expectNoUnexpectedApi(server.api)
})
