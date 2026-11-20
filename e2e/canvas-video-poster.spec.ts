import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import {
  expectNoUnexpectedApi,
  fulfillFixtureVideo,
  installStrictAuthenticatedApp,
  WORKSPACE_ID,
} from './fixtures/strict-authenticated-app'

const canvasId = 969
const originalVideoId = 8511
const newVideoId = 8512
const originalPosterId = 8521
const newPosterId = 8522
const taskId = 15438

test('同一节点换视频后只保存新封面，旧封面迟到也不会影响刷新回显', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  const videoBytes = readFileSync('public/tutorials/hot-copy.mp4')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))

  let revision = 1
  let savedData: Record<string, unknown> = {
    kind: 'video',
    assetId: originalVideoId,
    assetWorkspaceId: WORKSPACE_ID,
    title: '封面随视频更新',
    taskId,
    taskStatus: 'processing',
  }
  let savedPayload = {
    id: 'replace-poster',
    type: 'video',
    position: { x: 300, y: 150 },
    style: { width: 320, height: 200 },
    data: savedData,
  }
  await page.route(`**/api/v1/canvases/${canvasId}**`, async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.endsWith('/elements'))
      return route.fulfill({ json: { id: canvasId, title: '视频封面刷新', revision } })
    if (route.request().method() === 'PATCH') {
      const mutation = route
        .request()
        .postDataJSON()
        .mutations.find(({ element_id }: { element_id: string }) => element_id === savedPayload.id)
      if (mutation?.payload) {
        savedPayload = mutation.payload
        savedData = savedPayload.data
      }
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    return route.fulfill({
      json: {
        elements:
          Number(url.searchParams.get('after_revision')) > 0
            ? []
            : [{ element_id: savedPayload.id, kind: 'node', op: 'upsert', payload: savedPayload }],
        sync_revision: revision,
        history_floor_revision: 0,
        has_more: false,
      },
    })
  })
  let nextReady = false
  await page.route(`**/api/v1/ai/tasks/${taskId}?**`, (route) =>
    route.fulfill({
      json: nextReady
        ? { id: taskId, status: 'succeeded', outputs: [{ type: 'video', asset_id: newVideoId }] }
        : { id: taskId, status: 'processing', outputs: [] },
    }),
  )
  await page.route('**/api/v1/assets?**', (route) =>
    route.fulfill({
      json: { items: [{ id: newVideoId, type: 'video', status: 'active', workspace_id: WORKSPACE_ID }], total: 1 },
    }),
  )
  let posterUploads = 0
  await page.route('**/api/v1/assets', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ workspace_id: WORKSPACE_ID, source: 'canvas-poster' })
    const id = posterUploads++ === 0 ? originalPosterId : newPosterId
    return route.fulfill({ json: { asset: { id }, upload: { url: '/mock-poster-storage', form_fields: {} } } })
  })
  await page.route('**/mock-poster-storage', (route) => route.fulfill({ status: 204 }))
  let releaseOriginal!: () => void
  let waitingForOriginal = false
  const originalCanComplete = new Promise<void>((resolve) => {
    releaseOriginal = resolve
  })
  for (const posterId of [originalPosterId, newPosterId]) {
    await page.route(`**/api/v1/assets/${posterId}/complete?**`, async (route) => {
      if (posterId === originalPosterId) {
        waitingForOriginal = true
        await originalCanComplete
      }
      return route.fulfill({ json: { id: posterId } })
    })
    await page.route(`**/api/v1/assets/${posterId}/download?**`, (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="${posterId === originalPosterId ? '#992d39' : '#356b44'}"/></svg>`,
      }),
    )
  }
  for (const id of [originalVideoId, newVideoId]) {
    await page.route(`**/api/v1/assets/${id}/download?**`, (route) => fulfillFixtureVideo(route, videoBytes))
  }
  const video = page.locator('.react-flow__node-video video')
  try {
    await page.goto(`/canvas/${canvasId}`)
    await expect(video).toHaveAttribute('src', new RegExp(`/${originalVideoId}/download`))
    await expect.poll(() => waitingForOriginal).toBe(true)
    nextReady = true
    await expect(video).toHaveAttribute('src', new RegExp(`/${newVideoId}/download`))
    await expect.poll(() => savedData.posterAssetId).toBe(newPosterId)
    const originalResponse = page.waitForResponse(new RegExp(`/${originalPosterId}/complete`))
    releaseOriginal()
    await originalResponse
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(page.getByText('已保存到云端', { exact: true })).toBeVisible()
    expect(savedData).toMatchObject({ assetId: newVideoId, posterAssetId: newPosterId })
    expect(savedData).not.toHaveProperty('poster')
    await page.reload()
    await expect(video).toHaveAttribute('src', new RegExp(`/${newVideoId}/download`))
    await expect(video).toHaveAttribute('poster', new RegExp(`/${newPosterId}/download`))
    expect(posterUploads).toBe(2)
    expect(api.paidTaskSubmissions).toBe(0)
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
    await page.screenshot({ path: testInfo.outputPath('video-poster-after-refresh.png') })
  } finally {
    releaseOriginal()
  }
})
