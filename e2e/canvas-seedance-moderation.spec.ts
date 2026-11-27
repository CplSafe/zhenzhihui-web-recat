import { expect, test, type Page } from '@playwright/test'
import {
  expectPaddedPixels,
  makePaddingSourcePng,
  mockIntrinsicVideoSize,
  mockPaddedImageUpload,
  NON_PLAYABLE_VIDEO,
  PADDED_ASSET_ID,
} from './fixtures/canvas-seedance-preflight'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

type CanvasMutation = {
  element_id: string
  kind: 'node' | 'edge'
  op: 'upsert' | 'delete'
  payload?: { [key: string]: unknown; data?: Record<string, unknown> }
}

async function installInlineModerationCanvas(
  page: Page,
  mediaType: 'image' | 'video',
  { width, height }: { width: number; height: number },
  savedNodes: CanvasMutation[] = [],
) {
  let revision = 1
  const elements = new Map<string, CanvasMutation & { revision: number }>([
    [
      mediaType,
      {
        element_id: mediaType,
        kind: 'node',
        op: 'upsert',
        revision,
        payload: {
          id: mediaType,
          type: mediaType,
          position: { x: 240, y: 150 },
          style: { width: 320, height: 280 },
          data: { kind: mediaType, title: '审核素材', assetId: 501, assetWorkspaceId: WORKSPACE_ID },
        },
      },
    ],
  ])
  const editLocks = (nodes: string[]) => ({
    granted: true,
    nodes: Object.fromEntries(nodes.map((id) => [id, [{ user_id: 7, name: 'E2E 用户', editing: true }]])),
  })
  await page.routeWebSocket('**/api/v1/canvases/126/node-locks/socket?**', (socket) => {
    socket.onMessage((message) => {
      const { nodes } = JSON.parse(String(message)) as { nodes: string[] }
      socket.send(JSON.stringify({ type: 'state', data: editLocks(nodes) }))
    })
  })
  await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/canvases/126**', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.endsWith('/elements')) {
      return route.fulfill({ json: { id: 126, title: 'Seedance 素材审核', revision } })
    }
    if (request.method() === 'PATCH') {
      const { mutations = [] } = request.postDataJSON() as { mutations?: CanvasMutation[] }
      savedNodes.push(...mutations)
      revision++
      for (const mutation of mutations) {
        elements.set(mutation.element_id, { ...mutation, revision })
      }
      return route.fulfill({ json: { revision, sync_revision: revision } })
    }
    const afterRevision = Number(url.searchParams.get('after_revision'))
    return route.fulfill({
      json: {
        elements: [...elements.values()].filter((element) => element.revision > afterRevision),
        sync_revision: revision,
        history_floor_revision: 0,
        has_more: false,
      },
    })
  })
  await page.route('**/api/v1/canvases/126/node-locks?**', (route) => {
    expect(route.request().method()).toBe('POST')
    const { nodes } = route.request().postDataJSON() as { nodes: string[] }
    return route.fulfill({ json: editLocks(nodes) })
  })
  const source = mediaType === 'image' ? await makePaddingSourcePng(page, { width, height }) : undefined
  await page.route(`**/api/v1/assets/501/download?workspace_id=${WORKSPACE_ID}`, (route) => {
    if (mediaType === 'video') return route.fulfill({ contentType: 'image/svg+xml', body: NON_PLAYABLE_VIDEO })
    return route.fulfill({ contentType: 'image/png', body: source })
  })
}

for (const mediaType of ['image', 'video'] as const) {
  for (const outcome of ['approved', 'rejected', 'non-active', 'network-error', 'already-pending'] as const) {
    test(`${mediaType} inline moderation: ${outcome}`, async ({ page }, testInfo) => {
      test.setTimeout(90_000)
      await page.setViewportSize({ width: outcome === 'already-pending' ? 900 : 1440, height: 1000 })
      const api = await installStrictAuthenticatedApp(page)
      let submitted = false
      let releaseInitialQuery!: () => void
      const initialQuery = new Promise<void>((resolve) => {
        releaseInitialQuery = resolve
      })
      let releaseResult = false
      let failed = false
      let queryCount = 0
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const calls: string[] = []
      const savedNodes: CanvasMutation[] = []
      const size = mediaType === 'image' ? { width: 1000, height: 400 } : { width: 320, height: 280 }
      await installInlineModerationCanvas(page, mediaType, size, savedNodes)
      await page.route('**/api/v1/assets/501/seedance-moderation**', async (route) => {
        calls.push(
          `${route.request().method()} ${new URL(route.request().url()).pathname}${new URL(route.request().url()).search}`,
        )
        if (route.request().method() === 'POST') {
          expect(route.request().postDataJSON()).toEqual({ workspace_id: WORKSPACE_ID })
          submitted = true
          await route.fulfill({ json: { data: { status: 'pending' } } })
          return
        }
        queryCount++
        if (queryCount === 1) await initialQuery
        if (outcome === 'already-pending' || submitted) {
          if (!releaseResult) {
            await route.fulfill({ json: { data: { status: 'pending' } } })
          } else if (outcome === 'network-error' && !failed) {
            failed = true
            await route.fulfill({ status: 503, json: { message: '审核查询暂时不可用' } })
          } else {
            await route.fulfill({
              json: {
                data: {
                  status: outcome === 'rejected' ? 'rejected' : outcome === 'non-active' ? 'approved' : 'active',
                  reason: outcome === 'rejected' ? '测试素材未通过审核' : '',
                },
              },
            })
          }
          return
        }
        if (!submitted) {
          await route.fulfill({ status: 404, json: { message: '尚未提交审核' } })
          return
        }
      })
      await page.goto('/canvas/126')
      const node = page.locator(`.react-flow__node[data-id="${mediaType}"]`)
      await expect(node).toBeVisible({ timeout: 25_000 })
      await page.getByRole('button', { name: /^当前缩放 .*点击回到 100%$/ }).click()
      await node.click()
      const panel = page.locator('[data-canvas-node-panel]')
      const label = `Seedance ${mediaType === 'video' ? '视频' : '图片'}审核`
      const moderationButton = panel.getByRole('button', { name: label })
      await expect(moderationButton).toBeVisible()
      await expect(page.getByRole('toolbar', { name: '节点操作' }).getByRole('button', { name: label })).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath('moderation-button-in-panel.png') })
      await moderationButton.click()
      const pending = node.getByRole('status', { name: '审核中', exact: true })
      await expect(pending).toBeVisible()
      await expect(pending.getByText('审核中', { exact: true })).toBeVisible()
      await expect(pending.locator('.canvas-node-generation-spinner')).toHaveCSS(
        'animation-name',
        'canvas-node-generation-spin',
      )
      await expect(page.getByRole('dialog', { name: label })).toHaveCount(0)
      await expect.poll(() => queryCount).toBe(1)
      await moderationButton.click()
      expect(queryCount).toBe(1)
      releaseInitialQuery()
      await expect.poll(() => queryCount).toBeGreaterThanOrEqual(2)
      await page.screenshot({ path: testInfo.outputPath('moderation-pending.png') })
      releaseResult = true
      if (outcome === 'network-error') {
        await expect(node.getByLabel('审核状态待确认', { exact: true })).toBeVisible({ timeout: 10_000 })
        await expect(pending).toHaveCount(0)
        await moderationButton.click()
        await expect(node.getByLabel('合规校验成功', { exact: true })).toBeVisible({ timeout: 10_000 })
      } else {
        await expect(
          node.getByLabel(outcome === 'rejected' || outcome === 'non-active' ? '审核未通过' : '合规校验成功', {
            exact: true,
          }),
        ).toBeVisible({ timeout: 10_000 })
      }
      await expect(pending).toHaveCount(0)
      await expect(page.getByRole('dialog', { name: label })).toHaveCount(0)
      const finalState = outcome === 'rejected' || outcome === 'non-active' ? 'rejected' : 'approved'
      const mediaLabel = mediaType === 'video' ? '视频' : '图片'
      await expect(
        page.getByText(finalState === 'approved' ? `${mediaLabel}认证通过` : new RegExp(`${mediaLabel}认证失败`), {
          exact: finalState === 'approved',
        }),
      ).toBeVisible()
      await expect
        .poll(() =>
          savedNodes.some((mutation) => {
            const data = mutation.payload?.data as Record<string, unknown> | undefined
            return (
              mutation.element_id === mediaType &&
              data?.seedanceModerationStatus === finalState &&
              data?.assetId === 501 &&
              data?.assetWorkspaceId === WORKSPACE_ID
            )
          }),
        )
        .toBe(true)
      expect(calls.filter((call) => call === `POST /api/v1/assets/501/seedance-moderation`)).toHaveLength(
        outcome === 'already-pending' ? 0 : 1,
      )
      expect(
        calls.some((call) => call === `GET /api/v1/assets/501/seedance-moderation?workspace_id=${WORKSPACE_ID}`),
      ).toBe(true)
      await page.screenshot({ path: testInfo.outputPath('moderation-result.png') })
      expect(errors).toEqual([])
      expect(api.paidTaskSubmissions).toBe(0)
      expectNoUnexpectedApi(api)
    })
  }
}

test('图片手动审核超过宽高比上限时不发请求或显示审核中', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await installInlineModerationCanvas(page, 'image', { width: 1001, height: 400 })
  const calls: string[] = []
  await page.route('**/api/v1/assets/501/seedance-moderation**', (route) => {
    calls.push(route.request().method())
    return route.fulfill({ status: 500, json: { message: '不应送审' } })
  })
  await page.goto('/canvas/126')
  const node = page.locator('.react-flow__node[data-id="image"]')
  await node.click()
  await page.locator('[data-canvas-node-panel]').getByRole('button', { name: 'Seedance 图片审核' }).click()

  const warning = page.getByRole('dialog', { name: '图片宽高比不符合送审要求' })
  await expect(warning).toBeVisible()
  await expect(warning.getByText('审核素材', { exact: true })).toBeVisible()
  await expect(warning).toContainText(/1001\s*×\s*400/)
  await expect(warning.getByRole('button', { name: '补边保留全图' })).toBeVisible()
  await expect(warning.getByRole('button', { name: '定位并裁剪' })).toBeVisible()
  await expect(node.getByRole('status', { name: '审核中', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('invalid-inline-moderation.png') })
  expect(calls).toEqual([])
  expect(api.paidTaskSubmissions).toBe(0)
  expect(errors).toEqual([])
  expectNoUnexpectedApi(api)
})

test('手动审核的超宽图预览上下白边，确认后只送审保留全图的新素材', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const savedNodes: CanvasMutation[] = []
  await installInlineModerationCanvas(page, 'image', { width: 2048, height: 768 }, savedNodes)
  const originalModeration: string[] = []
  await page.route('**/api/v1/assets/501/seedance-moderation**', (route) => {
    originalModeration.push(route.request().method())
    return route.fulfill({ status: 500, json: { message: '原图不应再次送审' } })
  })
  const result = await mockPaddedImageUpload(page, '审核素材')
  await page.goto('/canvas/126')
  const original = page.locator('.react-flow__node[data-id="image"]')
  await original.click()
  const moderation = page.locator('[data-canvas-node-panel]').getByRole('button', { name: 'Seedance 图片审核' })
  const warning = page.getByRole('dialog', { name: '图片宽高比不符合送审要求' })
  const preview = page.getByRole('dialog', { name: '补边保留全图' })
  await moderation.click()
  await warning.getByRole('button', { name: '补边保留全图' }).click()
  await expect(preview.getByRole('img', { name: '补边预览' })).toBeVisible()
  const dimensions = preview.getByRole('status', { name: '补边尺寸' })
  await expect(dimensions).toContainText(/2048\s*×\s*820/)
  await expect(dimensions).toContainText('上 26 px，下 26 px')
  const save = preview.getByRole('button', { name: '另存并送审' })
  await expect(save).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('padding-horizontal-preview.png') })
  expect(result.uploads).toEqual([])
  expect(result.moderation).toEqual([])

  await preview.getByRole('button', { name: /^取\s*消$/ }).click()
  await expect(preview).toHaveCount(0)
  expect(result.uploads).toEqual([])
  expect(result.moderation).toEqual([])

  if (!(await warning.isVisible())) await moderation.click()
  await warning.getByRole('button', { name: '补边保留全图' }).click()
  await save.click()
  const padded = page.locator('.react-flow__node').filter({ hasText: '审核素材 · 补边' })
  await expect(padded.getByLabel('合规校验成功', { exact: true })).toBeVisible()
  await expect(original.locator('img').first()).toHaveAttribute('src', /\/assets\/501\/download/)
  await expect
    .poll(() =>
      savedNodes.some(
        ({ element_id, payload }) =>
          element_id !== 'image' &&
          payload?.data?.assetId === PADDED_ASSET_ID &&
          payload.data.seedanceModerationStatus === 'approved',
      ),
    )
    .toBe(true)
  expect(savedNodes.filter(({ element_id, op }) => element_id === 'image' && op === 'delete')).toEqual([])
  expect(originalModeration).toEqual([])
  expect(result.moderation.filter((method) => method === 'POST')).toEqual(['POST'])
  expect(result.uploads).toHaveLength(1)
  await expectPaddedPixels(page, result.uploads[0], { width: 2048, height: 820 })
  await page.screenshot({ path: testInfo.outputPath('padding-horizontal-approved.png') })
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})

for (const size of [
  { width: 399, height: 1000 },
  { width: 1001, height: 400 },
]) {
  test(`视频手动审核 ${size.width}×${size.height} 超出比例时仅提示手动裁剪`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const api = await installStrictAuthenticatedApp(page)
    await mockIntrinsicVideoSize(page, size)
    await installInlineModerationCanvas(page, 'video', size)
    const moderation: string[] = []
    await page.route('**/api/v1/assets/501/seedance-moderation**', (route) => {
      moderation.push(route.request().method())
      return route.fulfill({ status: 500, json: { message: '超出比例的视频不应送审' } })
    })
    await page.goto('/canvas/126')
    await page.locator('.react-flow__node[data-id="video"]').click()
    await page.locator('[data-canvas-node-panel]').getByRole('button', { name: 'Seedance 视频审核' }).click()
    const reminder = page.getByText(/请手动裁剪/)
    await expect(reminder).toBeVisible()
    await expect(reminder).toContainText(/最小\s*0\.4.*最大\s*2\.5/)
    await expect(page.getByRole('button', { name: '补边保留全图' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '定位并裁剪' })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('video-manual-crop-reminder.png') })
    expect(moderation).toEqual([])
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
