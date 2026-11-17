import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

const node = (id: string, kind: string, x: number, data: Record<string, unknown>) => ({
  element_id: id,
  kind: 'node',
  payload: {
    id,
    type: kind,
    position: { x, y: 100 },
    style: { width: 260, height: 180 },
    data: { kind, ...data },
  },
})

const position = (nodeCard: Locator) =>
  nodeCard.evaluate((element) => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(element).transform)
    return { x: transform.e, y: transform.f }
  })

async function dragBy(page: Page, target: Locator, dx: number, dy: number) {
  const box = await target.boundingBox()
  if (!box) throw new Error('拖动目标应当在画布中可见')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 6 })
  await page.mouse.up()
}

async function mockGuestShare(page: Page, editorRequests: string[]) {
  await page.route(/\/api\/v1\/(?:canvases|assets)\//, (route) => {
    const request = route.request()
    editorRequests.push(`${request.method()} ${new URL(request.url()).pathname}`)
    return route.fulfill({ status: 403, json: { message: '访客不能调用编辑画布接口' } })
  })
  await page.route(/\/api\/v1\/canvas-shares\/(?:shared-token|another-token)(?=\/|\?|$)/, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() !== 'GET') {
      editorRequests.push(`${request.method()} ${path}`)
      return route.fulfill({ status: 405 })
    }
    await route.fulfill({
      json: path.endsWith('/elements')
        ? {
            elements: [
              node('image', 'image', 80, {
                assetId: 12,
                resultUrl: '/api/v1/assets/12/download?workspace_id=3',
                publicResultUrl: '/shared/image.svg',
              }),
              node('text', 'text', 480, { text: '分享的画布文字' }),
              node('video', 'video', 880, { publicResultUrl: '/t1test.mp4' }),
              node('audio', 'audio', 1280, { publicResultUrl: '/t1test.mp4' }),
              node('storyboard', 'text', 1680, { text: JSON.stringify([{ title: '第一镜', prompt: '走入画面' }]) }),
              {
                element_id: 'edge-1',
                kind: 'edge',
                payload: {
                  id: 'edge-1',
                  source: 'image',
                  target: 'text',
                  sourceHandle: 'image-right-source',
                  targetHandle: 'text-left-target',
                },
              },
            ],
            has_more: false,
          }
        : { title: '分享测试画布', status: 'active' },
    })
  })
  await page.route('**/shared/image.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>',
    }),
  )
}

test('免登录分享页保存本地节点位置并保留只读预览', async ({ page, browser, baseURL }, testInfo) => {
  const editorRequests: string[] = []
  await mockGuestShare(page, editorRequests)
  await page.goto('/canvas/share/shared-token', { waitUntil: 'domcontentloaded' })

  await expect(page.getByText('分享测试画布')).toBeVisible()
  const sharedNodes = page.locator('.canvas-default-node')
  await expect(sharedNodes).toHaveCount(5)
  await expect(sharedNodes.locator('.canvas-node-header')).toHaveCount(0)
  await expect(sharedNodes.locator('.canvas-node-body')).toHaveCount(5)
  await expect(page.getByTestId('rf__node-video').locator('.canvas-node-video-wrap')).toBeVisible()
  await expect(page.locator('.canvas-node-editor, .canvas-audio-panel')).toHaveCount(0)
  await expect(page.locator('.react-flow__node.draggable')).toHaveCount(5)
  await expect(page.getByRole('button', { name: '添加节点' })).toHaveCount(0)
  await expect(page.getByText('分享的画布文字', { exact: true })).toBeVisible()
  await expect(page.getByLabel('分镜脚本，共 1 个镜头')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '镜头 1 提示词' })).toHaveValue('走入画面')
  await expect(page.getByRole('textbox', { name: '镜头 1 提示词' })).not.toBeEditable()
  const videoNode = page.getByTestId('rf__node-video')
  const videoControl = videoNode.locator('video')
  await expect
    .poll(() =>
      videoControl.evaluate(
        (el: HTMLVideoElement) => el.readyState >= 2 && !el.seeking && el.paused && el.currentTime > 0,
      ),
    )
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('share-dark-desktop.png') })
  const imageNode = page.getByTestId('rf__node-image')
  const image = imageNode.getByRole('img')
  await expect(image).toHaveAttribute('src', '/shared/image.svg')
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  const edge = page.locator('.react-flow__edge-path')
  await expect(edge).toHaveAttribute('d', /[MLC]/)
  const initialImagePosition = await position(imageNode)
  const initialVideoPosition = await position(videoNode)
  const initialEdgePath = await edge.getAttribute('d')
  await dragBy(page, image, 35, 75)
  await expect.poll(async () => (await position(imageNode)).y).toBeGreaterThan(initialImagePosition.y + 50)
  const movedImagePosition = await position(imageNode)
  await expect.poll(() => edge.getAttribute('d')).not.toBe(initialEdgePath)
  await dragBy(page, videoControl, -20, 65)
  await expect.poll(async () => (await position(videoNode)).y).toBeGreaterThan(initialVideoPosition.y + 50)
  const movedVideoPosition = await position(videoNode)
  await page.screenshot({ path: testInfo.outputPath('share-nodes-moved.png'), animations: 'disabled' })
  await page.getByTestId('rf__node-text').locator('.canvas-node-body').dblclick()
  await page.keyboard.press('Delete')
  await expect(sharedNodes).toHaveCount(5)
  await expect(page.locator('.canvas-node-editor, .canvas-node-header input')).toHaveCount(0)
  await page.getByRole('button', { name: '适应画布' }).click()
  const viewport = page.locator('.react-flow__viewport')
  const initialTransform = await viewport.evaluate((el) => getComputedStyle(el).transform)
  const focusVideo = page.getByRole('button', { name: '放大查看视频' })
  await expect(focusVideo).toHaveCSS('opacity', '0')
  await page.getByTestId('rf__node-video').hover()
  await expect(focusVideo).toHaveCSS('opacity', '1')
  await focusVideo.click()
  await expect.poll(() => viewport.evaluate((el) => getComputedStyle(el).transform)).not.toBe(initialTransform)
  await videoControl.evaluate((el: HTMLMediaElement) => {
    el.muted = true
  })
  await page.getByRole('button', { name: '播放视频' }).click()
  await expect.poll(() => videoControl.evaluate((el: HTMLMediaElement) => el.currentTime)).toBeGreaterThan(0.05)
  await page.screenshot({ path: testInfo.outputPath('share-video-focused.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '暂停视频' }).click()
  await expect.poll(() => videoControl.evaluate((el: HTMLMediaElement) => el.paused)).toBe(true)
  const videoProgress = page.getByRole('slider', { name: '视频进度' })
  await expect(videoProgress).toBeEnabled()
  await dragBy(page, videoProgress, 12, 0)
  await expect.poll(() => videoControl.evaluate((el: HTMLMediaElement) => el.currentTime)).toBeGreaterThan(1)
  await expect.poll(() => position(videoNode)).toEqual(movedVideoPosition)
  await page.getByRole('button', { name: '放大视频', exact: true }).click()
  const videoPreview = page.getByRole('dialog', { name: '视频预览' })
  await expect(videoPreview.getByLabel('视频播放器')).toBeVisible()
  await expect(videoPreview.getByRole('button', { name: /截取/ })).toHaveCount(0)
  await videoPreview.getByRole('button', { name: '收起' }).click()
  await expect(videoPreview).toHaveCount(0)
  await page.getByRole('button', { name: '适应画布' }).click()
  await page.getByTestId('rf__node-audio').hover()
  await page.getByRole('button', { name: '放大查看音频' }).click()
  const audioControl = page.getByTestId('rf__node-audio').locator('audio')
  await audioControl.evaluate((el: HTMLMediaElement) => {
    el.muted = true
  })
  await page.getByRole('button', { name: '播放音频' }).click()
  await expect.poll(() => audioControl.evaluate((el: HTMLMediaElement) => el.currentTime)).toBeGreaterThan(0)
  await page.getByRole('button', { name: '暂停音频' }).click()
  await expect.poll(() => audioControl.evaluate((el: HTMLMediaElement) => el.paused)).toBe(true)
  const audioProgress = page.getByRole('slider', { name: '音频播放进度' })
  const audioDuration = await audioControl.evaluate((el: HTMLMediaElement) => el.duration)
  expect(audioDuration).toBeGreaterThan(2)
  await expect(audioProgress).toHaveAttribute('max', String(audioDuration))
  await audioProgress.click()
  await expect.poll(() => audioControl.evaluate((el: HTMLMediaElement) => el.currentTime)).toBeGreaterThan(1)
  const focusedTransform = await viewport.evaluate((el) => getComputedStyle(el).transform)
  await page.getByRole('button', { name: '适应画布' }).click()
  await expect.poll(() => viewport.evaluate((el) => getComputedStyle(el).transform)).not.toBe(focusedTransform)
  const fullTransform = await viewport.evaluate((el) => getComputedStyle(el).transform)
  await page.getByRole('button', { name: '放大画布' }).click()
  await expect.poll(() => viewport.evaluate((el) => getComputedStyle(el).transform)).not.toBe(fullTransform)
  const zoomedTransform = await viewport.evaluate((el) => getComputedStyle(el).transform)
  await page.getByRole('button', { name: '缩小画布' }).click()
  await expect.poll(() => viewport.evaluate((el) => getComputedStyle(el).transform)).not.toBe(zoomedTransform)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByText('分享测试画布')).toBeVisible()
  await page.getByRole('button', { name: '适应画布' }).click()
  const narrowTransform = await viewport.evaluate((el) => getComputedStyle(el).transform)
  const focusImage = page.getByRole('button', { name: '放大查看图片' })
  await focusImage.focus()
  await expect(focusImage).toHaveCSS('opacity', '1')
  await focusImage.press('Enter')
  await expect.poll(() => viewport.evaluate((el) => getComputedStyle(el).transform)).not.toBe(narrowTransform)
  await expect.poll(async () => (await image.boundingBox())?.width || 0).toBeGreaterThan(200)
  await page.screenshot({ path: testInfo.outputPath('share-dark-narrow.png') })
  await image.dblclick()
  const imagePreview = page.getByRole('dialog', { name: '图片预览' })
  await expect(imagePreview).toBeVisible()
  await imagePreview.getByRole('button', { name: '关闭图片预览' }).click()
  await expect(imagePreview).toHaveCount(0)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(sharedNodes).toHaveCount(5)
  await expect.poll(() => position(imageNode)).toEqual(movedImagePosition)
  await expect.poll(() => position(videoNode)).toEqual(movedVideoPosition)

  await page.goto('/canvas/share/another-token', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => position(imageNode)).toEqual(initialImagePosition)
  await expect.poll(() => position(videoNode)).toEqual(initialVideoPosition)

  const otherVisitor = await browser.newPage({ baseURL })
  try {
    await mockGuestShare(otherVisitor, editorRequests)
    await otherVisitor.goto('/canvas/share/shared-token', { waitUntil: 'domcontentloaded' })
    await expect.poll(() => position(otherVisitor.getByTestId('rf__node-image'))).toEqual(initialImagePosition)
    await expect.poll(() => position(otherVisitor.getByTestId('rf__node-video'))).toEqual(initialVideoPosition)
  } finally {
    await otherVisitor.close()
  }
  expect(editorRequests).toEqual([])
})

test('分享页恢复原布局并只清除当前链接保存的位置', async ({ page }, testInfo) => {
  const editorRequests: string[] = []
  await mockGuestShare(page, editorRequests)
  await page.setViewportSize({ width: 1280, height: 840 })
  const imageNode = page.getByTestId('rf__node-image')
  const image = imageNode.getByRole('img')
  const edge = page.locator('.react-flow__edge-path')
  const edgeStart = () =>
    edge.evaluate((path: SVGPathElement) => {
      const { x, y } = path.getPointAtLength(0)
      return { x, y }
    })
  const resetLayout = page
    .getByRole('toolbar', { name: '画布视图控制' })
    .getByRole('button', { name: '恢复原布局', exact: true })

  await page.goto('/canvas/share/shared-token', { waitUntil: 'domcontentloaded' })
  await expect(resetLayout).toBeDisabled()
  await expect(image).toBeVisible()
  await expect(edge).toHaveAttribute('d', /[MLC]/)
  const originalPosition = await position(imageNode)
  const originalEdgeStart = await edgeStart()
  await dragBy(page, image, 35, 75)
  await expect.poll(async () => (await position(imageNode)).y).toBeGreaterThan(originalPosition.y + 50)
  const movedPosition = await position(imageNode)
  await expect(resetLayout).toBeEnabled()

  await page.goto('/canvas/share/another-token', { waitUntil: 'domcontentloaded' })
  await expect(resetLayout).toBeDisabled()
  await expect.poll(() => position(imageNode)).toEqual(originalPosition)
  await dragBy(page, image, -20, 55)
  await expect.poll(async () => (await position(imageNode)).y).toBeGreaterThan(originalPosition.y + 40)
  const otherTokenPosition = await position(imageNode)
  await expect(resetLayout).toBeEnabled()

  await page.goto('/canvas/share/shared-token', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => position(imageNode)).toEqual(movedPosition)
  await expect(resetLayout).toBeEnabled()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('share-restore-layout-narrow.png'), animations: 'disabled' })
  await resetLayout.click()
  await expect(resetLayout).toBeDisabled()
  await expect.poll(() => position(imageNode)).toEqual(originalPosition)
  await expect
    .poll(async () => {
      const { x, y } = await edgeStart()
      return Math.hypot(x - originalEdgeStart.x, y - originalEdgeStart.y)
    })
    .toBeLessThan(1)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(resetLayout).toBeDisabled()
  await expect.poll(() => position(imageNode)).toEqual(originalPosition)

  await page.goto('/canvas/share/another-token', { waitUntil: 'domcontentloaded' })
  await expect(resetLayout).toBeEnabled()
  await expect.poll(() => position(imageNode)).toEqual(otherTokenPosition)
  expect(editorRequests).toEqual([])
})

test('画布分享入口打开分享弹窗并读取状态', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  let revision = 1
  let shareRequests = 0
  await page.route('**/api/v1/canvases/128**', async (route) => {
    const request = route.request()
    if (request.url().includes('/share')) {
      shareRequests++
      return route.fulfill({ json: {} })
    }
    if (request.method() === 'PATCH') return route.fulfill({ json: { sync_revision: ++revision } })
    return route.fulfill({
      json: request.url().includes('/elements')
        ? { elements: [], sync_revision: revision, history_floor_revision: 0, has_more: false }
        : { id: 128, title: '分享权限测试', status: 'active', revision },
    })
  })
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  await page.goto('/canvas/128')
  await page.getByRole('button', { name: '分享这块画布' }).click()
  await expect(page.getByRole('dialog', { name: '分享画布' })).toContainText('这块画布还没有分享链接')
  expect(shareRequests).toBe(1)
  expectNoUnexpectedApi(api)
})

test('分享页收紧视频行间距并保留标签和列的对齐', async ({ page }, testInfo) => {
  const label = (id: string, x: number, y: number, text: string) => {
    const element = node(id, 'text', x, { text })
    return {
      ...element,
      payload: { ...element.payload, position: { x, y }, style: { width: 220, height: 40 } },
    }
  }
  const video = (id: string, x: number, y: number) => {
    const element = node(id, 'video', x, { publicResultUrl: '/t1test.mp4', publicPosterUrl: '/t1test.png' })
    return {
      ...element,
      payload: { ...element.payload, position: { x, y }, style: { width: 220, height: 390 } },
    }
  }
  await page.route('**/api/v1/canvas-shares/spacing-token**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? {
            elements: [
              label('label-a', 0, 100, '第 01 集'),
              label('label-b', 300, 168, '第 02 集'),
              video('video-a', 0, 220),
              video('video-b', 300, 220),
              label('label-c', 0, 690, '第 03 集'),
              label('label-d', 300, 694, '第 04 集'),
              video('video-c', 0, 746),
              video('video-d', 300, 746),
              label('label-e', 0, 1156, '第 05 集'),
              label('label-f', 300, 1160, '第 06 集'),
              video('video-e', 0, 1212),
              video('video-f', 300, 1212),
            ],
            has_more: false,
          }
        : { title: '分享画布间距', status: 'active' },
    }),
  )
  await page.goto('/canvas/share/spacing-token')
  await expect(page.getByText('第 01 集', { exact: true })).toBeVisible()
  const rect = (id: string) => page.getByTestId(`rf__node-${id}`).boundingBox()
  const measureSpacing = async () => {
    const suffixes = ['a', 'b', 'c', 'd', 'e', 'f']
    const labels = await Promise.all(suffixes.map((suffix) => rect(`label-${suffix}`)))
    const videos = await Promise.all(suffixes.map((suffix) => rect(`video-${suffix}`)))
    if (!labels.every((box) => box !== null) || !videos.every((box) => box !== null)) return null

    const [firstLeft, firstRight, secondLeft, secondRight, thirdLeft, thirdRight] = videos
    const inCanvasPixels = (distance: number) => Math.round(distance / (firstLeft.width / 220))
    return {
      labelGaps: labels.map((box, index) => inCanvasPixels(videos[index].y - box.y - box.height)),
      rowGaps: [
        inCanvasPixels(secondLeft.y - firstLeft.y - firstLeft.height),
        inCanvasPixels(thirdLeft.y - secondLeft.y - secondLeft.height),
      ],
      rowOffsets: [
        inCanvasPixels(firstRight.y - firstLeft.y),
        inCanvasPixels(secondRight.y - secondLeft.y),
        inCanvasPixels(thirdRight.y - thirdLeft.y),
      ],
      columnOffsets: [
        inCanvasPixels(secondLeft.x - firstLeft.x),
        inCanvasPixels(secondRight.x - firstRight.x),
        inCanvasPixels(thirdLeft.x - firstLeft.x),
        inCanvasPixels(thirdRight.x - firstRight.x),
      ],
    }
  }
  const spacing = {
    labelGaps: [8, 8, 8, 8, 8, 8],
    rowGaps: [114, 72],
    rowOffsets: [0, 0, 0],
    columnOffsets: [0, 0, 0, 0],
  }
  await expect.poll(measureSpacing).toEqual(spacing)
  await page.screenshot({ path: testInfo.outputPath('share-row-spacing.png') })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '适应画布' }).click()
  await expect.poll(measureSpacing).toEqual(spacing)
  await expect
    .poll(async () => {
      const top = await rect('label-a')
      const bottom = await rect('video-f')
      const title = await page.getByText('分享画布间距', { exact: true }).boundingBox()
      const controls = await page.getByRole('toolbar', { name: '画布视图控制' }).boundingBox()
      return !!(
        top &&
        bottom &&
        title &&
        controls &&
        top.y >= title.y + title.height &&
        bottom.y + bottom.height <= controls.y
      )
    })
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('share-row-spacing-narrow.png') })
})

test('分享页对齐分区标题与完整视频标题并保留编辑布局', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const videos = [
    { x: 100, y: 220 },
    { x: 420, y: 220 },
    { x: 740, y: 220 },
    { x: 1400, y: 760 },
  ]
  const videoMedia = {
    resultUrl: '/t1test.mp4',
    poster: '/t1test.png',
    publicResultUrl: '/t1test.mp4',
    publicPosterUrl: '/t1test.png',
  }
  const elements = videos.flatMap(({ x, y }, index) => {
    const label = node(`label-${index}`, 'text', x - 18, { text: `第 0${index + 1} 集`, groupId: 'captions' })
    const video = node(`video-${index}`, 'video', x, {
      ...videoMedia,
      groupId: 'videos',
    })
    const labelY = index === 1 ? y - 40 : y - 120
    return [
      {
        ...label,
        payload: { ...label.payload, position: { x: x - 18, y: labelY }, style: { width: 210, height: 40 } },
      },
      { ...video, payload: { ...video.payload, position: { x, y }, style: { width: 220, height: 390 } } },
    ]
  })
  const heading = '第01—03集字幕版 | Chained by Her Touch'
  const fullVideoHeading = '第01—03集完整视频 | 英文字幕版'
  const note = '这是独立的文字备注'
  const wideText = (id: string, text: string, x: number, y: number, width: number) => {
    const element = node(id, 'text', x, { text })
    return {
      ...element,
      payload: { ...element.payload, position: { x, y }, style: { width, height: 72 } },
    }
  }
  const headingNode = wideText('section-title', heading, 82, 22, 860)
  const fullVideoHeadingNode = wideText('full-video-title', fullVideoHeading, 1050, 22, 440)
  const fullVideo = node('full-video', 'video', 1050, videoMedia)
  const fullVideoNode = {
    ...fullVideo,
    payload: { ...fullVideo.payload, position: { x: 1050, y: 154 }, style: { width: 220, height: 390 } },
  }
  const noteNode = wideText('standalone-note', note, 100, 690, 540)
  const sectionNodes = [headingNode, fullVideoHeadingNode, fullVideoNode, noteNode]
  const graphElements = [
    ...elements,
    ...sectionNodes,
    {
      element_id: 'episode-connection',
      kind: 'edge',
      payload: {
        id: 'episode-connection',
        source: 'video-0',
        target: 'video-1',
        sourceHandle: 'video-0-right-source',
        targetHandle: 'video-1-left-target',
      },
    },
  ]
  const title = '分享页集数标签间距'
  await page.route('**/api/v1/canvases/129**', (route) => {
    const request = route.request()
    if (request.method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    return route.fulfill({
      json: new URL(request.url()).pathname.endsWith('/elements')
        ? { elements: graphElements, sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 129, title, status: 'active', revision: 1 },
    })
  })
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/canvas-shares/caption-spacing-token**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? { elements: graphElements, has_more: false }
        : { title, status: 'active' },
    }),
  )

  const readGeometry = (ids: string[]) =>
    page.evaluate(
      (nodeIds) =>
        nodeIds.map((id) => {
          const element = document.querySelector(`[data-testid="rf__node-${id}"]`)
          if (!element) return null
          const style = getComputedStyle(element)
          const transform = new DOMMatrixReadOnly(style.transform)
          return { x: transform.e, y: transform.f, width: parseFloat(style.width), height: parseFloat(style.height) }
        }),
      ids,
    )
  const videoCard = page.getByTestId('rf__node-video-0')
  const toolbar = page.getByRole('toolbar', { name: '画布视图控制' })
  const edge = page.locator('.react-flow__edge-path')
  const readAppearance = () =>
    page.evaluate(() => {
      const readStyle = (selector: string) => {
        const element = document.querySelector(selector)
        return element ? getComputedStyle(element) : null
      }
      const surface = (selector: string) => {
        const style = readStyle(selector)
        if (!style) return null
        return { radius: style.borderRadius, background: style.backgroundColor, border: style.borderTopColor }
      }
      return {
        caption: surface('[data-testid="rf__node-label-0"] .canvas-default-node'),
        video: surface('[data-testid="rf__node-video-0"] .canvas-default-node'),
        playback: surface('[data-testid="rf__node-video-0"] .canvas-node-video-bar'),
        toolbar: surface('[role="toolbar"][aria-label="画布视图控制"]'),
        edge: readStyle('.react-flow__edge-path')?.stroke ?? null,
      }
    })

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/canvas/129')
  await expect(page.getByRole('button', { name: '分享这块画布' })).toBeVisible()
  await expect(videoCard.locator('video')).toHaveAttribute('poster', '/t1test.png')
  await expect(edge).toHaveCount(1)
  await expect.poll(() => readGeometry(['label-0'])).toMatchObject([{ x: 82, y: 100 }])
  const sectionIds = sectionNodes.map(({ element_id }) => element_id)
  const originalSectionGeometry = sectionNodes.map(({ payload }) => ({ ...payload.position, ...payload.style }))
  await expect.poll(() => readGeometry(sectionIds)).toEqual(originalSectionGeometry)
  await expect(page.locator('.share-section-heading')).toHaveCount(0)
  const editorAppearance = await readAppearance()
  expect(Object.values(editorAppearance)).not.toContain(null)
  await page.screenshot({ path: testInfo.outputPath('editor-caption-style.png'), animations: 'disabled' })

  await page.goto('/canvas/share/caption-spacing-token')
  await expect(page.getByText('第 01 集', { exact: true })).toBeVisible()
  await expect(page.getByText('只读查看', { exact: true })).toBeVisible()
  await expect(videoCard.locator('video')).toHaveAttribute('poster', '/t1test.png')
  await expect(edge).toHaveCount(1)
  await expect.poll(readAppearance).toEqual(editorAppearance)
  const section = page.getByRole('heading', { name: heading, exact: true })
  const fullVideoSection = page.getByRole('heading', { name: fullVideoHeading, exact: true })
  for (const title of [section, fullVideoSection]) {
    await expect(title).toBeVisible()
    await expect(title).toHaveClass(/share-section-heading/)
    await expect(title).toHaveCSS('font-size', '22px')
  }
  await expect(page.getByTestId('rf__node-standalone-note').getByText(note, { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: note, exact: true })).toHaveCount(0)
  const sectionGeometry = [
    { x: 100, y: 108, width: 860, height: 48 },
    { x: 1050, y: 108, width: 440, height: 48 },
    { x: 1050, y: 172, width: 220, height: 390 },
    originalSectionGeometry[3],
    { x: 100, y: 172, width: 220, height: 40 },
  ]
  const readSectionGeometry = () => readGeometry([...sectionIds, 'label-0'])
  await expect.poll(readSectionGeometry).toEqual(sectionGeometry)

  const ids = videos.flatMap((_, index) => [`label-${index}`, `video-${index}`])
  await expect
    .poll(() => readGeometry(ids))
    .toEqual(
      videos.flatMap(({ x, y }, index) => [
        index === 3 ? { x: x - 18, y: y - 120, width: 210, height: 40 } : { x, y: y - 48, width: 220, height: 40 },
        { x, y, width: 220, height: 390 },
      ]),
    )
  await expect(toolbar.getByRole('button')).toHaveCount(5)
  await expect(toolbar.getByRole('button', { name: '恢复原布局', exact: true })).toBeDisabled()
  for (const name of ['放大画布', '缩小画布', '适应画布']) {
    await expect(toolbar.getByRole('button', { name })).toBeVisible()
  }
  const zoomReset = toolbar.getByRole('button', { name: /当前缩放 \d+%，点击回到 100%/ })
  await expect(zoomReset).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('share-section-heading.png'), animations: 'disabled' })
  await zoomReset.click()
  await expect(zoomReset).toHaveText('100%')
  await page.setViewportSize({ width: 390, height: 844 })
  await toolbar.getByRole('button', { name: '适应画布' }).click()
  await expect.poll(readSectionGeometry).toEqual(sectionGeometry)
  await expect
    .poll(async () => {
      const [titleBox, fullVideoTitleBox, navigationBox] = await Promise.all([
        section.boundingBox(),
        fullVideoSection.boundingBox(),
        page.locator('.share-topbar').boundingBox(),
      ])
      return Boolean(
        titleBox &&
        fullVideoTitleBox &&
        navigationBox &&
        titleBox.x >= 0 &&
        fullVideoTitleBox.x + fullVideoTitleBox.width <= 390 &&
        titleBox.y >= navigationBox.y + navigationBox.height &&
        Math.abs(titleBox.y - fullVideoTitleBox.y) < 1,
      )
    })
    .toBe(true)
  await page.mouse.move(389, 0)
  await page.screenshot({ path: testInfo.outputPath('share-section-heading-narrow.png'), animations: 'disabled' })

  await page.setViewportSize({ width: 1280, height: 800 })
  await toolbar.getByRole('button', { name: '适应画布' }).click()
  const dragPair = async (target: Locator, nodeIds: string[]) => {
    const [primaryBefore, secondaryBefore] = await readGeometry(nodeIds)
    if (!primaryBefore || !secondaryBefore) throw new Error('拖动前应当能读取视频和标题的位置')
    await dragBy(page, target, 40, 50)
    await expect
      .poll(async () => {
        const [primary, secondary] = await readGeometry(nodeIds)
        if (!primary || !secondary) return false
        const dx = primary.x - primaryBefore.x
        const dy = primary.y - primaryBefore.y
        return (
          dx > 20 &&
          dy > 20 &&
          Math.abs(dx - (secondary.x - secondaryBefore.x)) < 0.01 &&
          Math.abs(dy - (secondary.y - secondaryBefore.y)) < 0.01
        )
      })
      .toBe(true)
  }
  const episodePair = ['video-0', 'label-0']
  const fullVideoPair = ['full-video-title', 'full-video']
  await dragPair(videoCard.locator('video'), episodePair)
  await dragPair(fullVideoSection, fullVideoPair)
  await expect
    .poll(() => readGeometry(['section-title', 'standalone-note']))
    .toEqual([sectionGeometry[0], sectionGeometry[3]])
  const movedPairs = await readGeometry([...episodePair, ...fullVideoPair])
  await page.screenshot({ path: testInfo.outputPath('share-captions-moved.png'), animations: 'disabled' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => readGeometry([...episodePair, ...fullVideoPair])).toEqual(movedPairs)

  await page.goto('/canvas/129')
  await expect(page.getByRole('button', { name: '分享这块画布' })).toBeVisible()
  await expect.poll(() => readGeometry(sectionIds)).toEqual(originalSectionGeometry)
  await expect
    .poll(() => readGeometry(['label-0', 'video-0']))
    .toMatchObject([
      { x: 82, y: 100 },
      { x: 100, y: 220 },
    ])
  expectNoUnexpectedApi(api)
})
