import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const viewportWidth of [1440, 1024, 820, 760, 390]) {
  test(`视频节点双击聚焦60%、按钮全屏预览与详情抽屉 ${viewportWidth}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewportWidth, height: viewportWidth === 1440 ? 1000 : 640 })
    const api = await installStrictAuthenticatedApp(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    // 使用仓库稳定的 MP4 响应，并按素材 ID 模拟不同方向的解码元数据。
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth')!
      Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
        configurable: true,
        get() {
          const nodeId = this.closest('.react-flow__node')?.getAttribute('data-id')
          const fixtureId = nodeId === 'portrait' ? 801 : nodeId === 'landscape' ? 802 : nodeId === 'square' ? 803 : 0
          const id = Number(this.currentSrc.match(/assets\/(\d+)\//)?.[1] || fixtureId)
          return id === 801 ? 180 : id === 802 ? 320 : id === 803 ? 240 : descriptor.get!.call(this)
        },
      })
      const height = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight')!
      Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
        configurable: true,
        get() {
          const nodeId = this.closest('.react-flow__node')?.getAttribute('data-id')
          const fixtureId = nodeId === 'portrait' ? 801 : nodeId === 'landscape' ? 802 : nodeId === 'square' ? 803 : 0
          const id = Number(this.currentSrc.match(/assets\/(\d+)\//)?.[1] || fixtureId)
          return id === 801 ? 320 : id === 802 ? 180 : id === 803 ? 240 : height.get!.call(this)
        },
      })
    })
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/assets', (route) => route.fulfill({ status: 503, json: { message: '测试不保存封面' } }))
    await page.route('**/api/v1/assets/804/stream**', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320"><rect width="180" height="320" fill="#193b45"/><rect x="12" y="12" width="156" height="296" fill="none" stroke="#e2c688" stroke-width="8"/></svg>',
      }),
    )
    let revision = 1
    let elements: Array<{ element_id: string; kind: string; payload: any }> = ['portrait', 'landscape', 'square'].map(
      (id, index) => ({
        element_id: id,
        kind: 'node',
        payload: {
          id,
          type: 'video',
          position: { x: 100 + index * 510, y: 100 },
          style: { width: 444, height: 250 },
          data: { kind: 'video', title: id, ratio: 'auto', assetId: 801 + index },
        },
      }),
    )
    elements.push({
      element_id: 'image-portrait',
      kind: 'node',
      payload: {
        id: 'image-portrait',
        type: 'image',
        position: { x: 1630, y: 100 },
        style: { width: 250, height: 250 },
        data: {
          kind: 'image',
          title: 'image-portrait',
          ratio: '1:1',
          assetId: 804,
          resultUrl: '/api/v1/assets/804/stream?workspace_id=21',
        },
      },
    })
    const saved: any[] = []
    await page.route('**/api/v1/canvases/128**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON()
        saved.push(body)
        for (const mutation of body.mutations || []) {
          if (mutation.op === 'upsert' && mutation.payload) {
            elements = elements.map((el) =>
              el.element_id === mutation.element_id ? { ...el, payload: mutation.payload } : el,
            )
          }
        }
        return route.fulfill({ json: { sync_revision: ++revision } })
      }
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : elements,
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 128, title: '媒体比例与控制条', revision },
      })
    })
    await page.goto('/canvas/128')
    for (const [id, ratio] of [
      ['portrait', 9 / 16],
      ['landscape', 16 / 9],
      ['square', 1],
    ] as const) {
      const node = page.locator(`.react-flow__node[data-id="${id}"]`)
      await expect
        .poll(() =>
          node.evaluate(
            (el) => parseFloat((el as HTMLElement).style.width) / parseFloat((el as HTMLElement).style.height),
          ),
        )
        .toBeCloseTo(ratio, 2)
      const video = node.locator('video')
      await expect(video).toHaveCSS('object-fit', 'contain')
      await expect(node.getByRole('button', { name: '放大视频', exact: true })).toBeVisible()
      await expect(node.getByRole('slider')).toBeVisible()
    }
    await expect.poll(() => saved.length).toBeGreaterThan(0)
    const imageNode = page.locator('.react-flow__node[data-id="image-portrait"]')
    await expect
      .poll(() =>
        imageNode.evaluate(
          (el) => parseFloat((el as HTMLElement).style.width) / parseFloat((el as HTMLElement).style.height),
        ),
      )
      .toBeCloseTo(9 / 16, 2)
    await expect(imageNode.locator('img')).toHaveCSS('object-fit', 'contain')
    await page.screenshot({ path: `test-results/canvas-video-ratios-${viewportWidth}.png` })
    const portrait = page.locator('.react-flow__node[data-id="portrait"]')
    const slider = portrait.getByRole('slider')
    await slider.focus()
    await page.keyboard.press('End')
    await portrait.locator('.canvas-node-video-wrap').dblclick()
    const dialog = page.getByRole('dialog', { name: '视频预览', exact: true })
    await expect(dialog).toHaveCount(0)
    await expect
      .poll(async () => {
        const rect = await portrait.boundingBox()
        const size = page.viewportSize()!
        return rect ? Math.max(rect.width / size.width, rect.height / size.height) : 0
      })
      .toBeCloseTo(0.6, 1)
    await page.screenshot({ path: testInfo.outputPath('video-node-focused.png') })
    const initialZoom = await page
      .locator('.react-flow__viewport')
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)
    await page.getByRole('button', { name: '放大', exact: true }).click({ clickCount: 4, delay: 180 })
    await expect
      .poll(() =>
        page.locator('.react-flow__viewport').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a),
      )
      .toBeGreaterThan(initialZoom)
    await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('3200')
    await expect
      .poll(() =>
        page.locator('.react-flow__viewport').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a),
      )
      .toBeCloseTo(32, 1)
    await page.getByRole('button', { name: '放大', exact: true }).click()
    await expect
      .poll(() =>
        page.locator('.react-flow__viewport').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a),
      )
      .toBeGreaterThan(32)
    await page.getByRole('button', { name: '复位视图', exact: true }).click()
    await portrait.getByRole('button', { name: '视频详情信息', exact: true }).hover()
    await expect(page.getByRole('tooltip', { name: '视频详情信息' })).toBeVisible()
    await portrait.getByRole('button', { name: '视频详情信息', exact: true }).click()
    const details = page.getByRole('dialog', { name: '视频详情信息', exact: true })
    await expect(details).toBeVisible()
    await expect(details.locator('video')).toHaveCount(0)
    await expect
      .poll(() =>
        details.evaluate((el) => {
          const rect = el.getBoundingClientRect()
          return rect.left >= 0 && rect.right <= innerWidth + 1
        }),
      )
      .toBe(true)
    await page.screenshot({ path: testInfo.outputPath('video-details-drawer.png') })
    await details.getByRole('button', { name: '收起', exact: true }).click()
    await expect(details).not.toBeVisible()
    await portrait.getByRole('button', { name: '放大视频', exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('video')).toBeVisible()
    await expect(dialog.locator('aside')).toHaveCount(0)
    await expect.poll(() => dialog.evaluate((el) => Number(getComputedStyle(el.parentElement!).opacity))).toBe(1)
    const assertPreviewBounds = async () => {
      const bounds = await dialog.evaluate((element) => {
        const panel = element.getBoundingClientRect()
        const media = element.querySelector('[data-testid="video-preview-media"]')!.getBoundingClientRect()
        const player = element.querySelector('video')!.getBoundingClientRect()
        return {
          contained: [media, player].every(
            (rect) =>
              rect.left >= panel.left - 1 &&
              rect.right <= panel.right + 1 &&
              rect.top >= panel.top - 1 &&
              rect.bottom <= panel.bottom + 1,
          ),
          centered: Math.abs((panel.left + panel.right) / 2 - innerWidth / 2),
          mediaCentered: Math.abs((media.left + media.right - player.left - player.right) / 2),
          overflow: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
          inViewport: panel.left >= 0 && panel.top >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight,
        }
      })
      expect(bounds.contained).toBe(true)
      expect(bounds.centered).toBeLessThan(1)
      expect(bounds.mediaCentered).toBeLessThan(1)
      expect(bounds.overflow).toBe(false)
      expect(bounds.inViewport).toBe(true)
      await expect(dialog.getByRole('button', { name: '收起', exact: true })).toBeInViewport()
    }
    await assertPreviewBounds()
    await page.screenshot({ path: testInfo.outputPath('video-preview-adaptive.png') })
    await page.setViewportSize({ width: 640, height: 480 })
    await assertPreviewBounds()
    await page.screenshot({ path: testInfo.outputPath('video-preview-resized.png') })
    await page.setViewportSize({ width: viewportWidth, height: viewportWidth === 1440 ? 1000 : 640 })
    await page.screenshot({ path: `test-results/canvas-video-expanded-${viewportWidth}.png` })
    // 相邻的节点详情入口仍按原有高视口场景验证，避免编辑面板遮挡干扰预览尺寸回归。
    await page.setViewportSize({ width: viewportWidth, height: 1000 })
    await page.getByRole('button', { name: '收起', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('1')
    await expect
      .poll(() => page.locator('.react-flow__viewport').evaluate((el) => getComputedStyle(el).transform))
      .toContain('0.01')
    await page.reload()
    await expect
      .poll(() =>
        portrait.evaluate(
          (el) => parseFloat((el as HTMLElement).style.width) / parseFloat((el as HTMLElement).style.height),
        ),
      )
      .toBeCloseTo(9 / 16, 2)
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
