import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('选中视频节点时自动播放，取消选择后暂停', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/assets', (route) =>
    route.fulfill({ status: 503, json: { message: '测试环境不保存视频封面' } }),
  )
  await page.addInitScript(() => {
    let audibleAttempts = 0
    const mediaPlaying = new WeakMap<HTMLMediaElement, boolean>()
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() {
        return !mediaPlaying.get(this)
      },
    })
    ;(window as any).__canvasSelectionPlayMutedStates = []
    HTMLMediaElement.prototype.play = function () {
      if (this.closest('.canvas-node-video-wrap')) {
        ;(window as any).__canvasSelectionPlayMutedStates.push(this.muted)
        if (!this.muted && audibleAttempts++ === 0) {
          return Promise.reject(new DOMException('Audible autoplay blocked', 'NotAllowedError'))
        }
        mediaPlaying.set(this, true)
        return Promise.resolve()
      }
      return Promise.resolve()
    }
    HTMLMediaElement.prototype.pause = function () {
      mediaPlaying.set(this, false)
    }
  })
  let revision = 1
  await page.route('**/api/v1/canvases/130**', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: ++revision } })
    const url = new URL(route.request().url())
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements:
              Number(url.searchParams.get('after_revision')) > 0
                ? []
                : [
                    {
                      element_id: 'hover-video',
                      kind: 'node',
                      op: 'upsert',
                      payload: {
                        id: 'hover-video',
                        type: 'video',
                        position: { x: 180, y: 120 },
                        style: { width: 320, height: 480 },
                        data: { kind: 'video', title: '悬停声音', resultUrl: '/tutorials/canvas.mp4' },
                      },
                    },
                  ],
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 130, title: '选中节点播放验证', status: 'active', revision },
    })
  })

  await page.goto('/canvas/130')
  const node = page.locator('.react-flow__node[data-id="hover-video"]')
  const video = node.locator('video')
  const videoWrap = node.locator('.canvas-node-video-wrap')
  await expect(video).toBeVisible()

  // 单纯悬停不会触发播放；选中节点后才开始播放。
  await videoWrap.hover({ position: { x: 40, y: 50 } })
  await expect.poll(() => page.evaluate(() => (window as any).__canvasSelectionPlayMutedStates)).toEqual([])
  await videoWrap.click({ position: { x: 40, y: 50 } })
  await expect(node).toHaveClass(/selected/)
  await expect(node.getByRole('button', { name: '开启声音' })).toBeVisible()
  await expect(video).toHaveJSProperty('muted', true)
  await expect(node.getByRole('button', { name: '暂停视频' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__canvasSelectionPlayMutedStates)).toEqual([false, true])
  await page.screenshot({ path: testInfo.outputPath('hover-sound-blocked.png') })

  // 用户明确开启声音后，重新选中节点会优先带声播放。
  await node.getByRole('button', { name: '开启声音' }).click()
  await expect(video).toHaveJSProperty('muted', false)
  await page.locator('.react-flow__pane').click({ position: { x: 1100, y: 700 } })
  await expect(node.getByRole('button', { name: '播放视频' })).toBeVisible()
  await expect(node).not.toHaveClass(/selected/)
  await videoWrap.click({ position: { x: 40, y: 50 } })
  await expect(node).toHaveClass(/selected/)
  await expect
    .poll(() => page.evaluate(() => (window as any).__canvasSelectionPlayMutedStates))
    .toEqual([false, true, false])
  await expect(video).toHaveJSProperty('muted', false)
  await expect(node.getByRole('button', { name: '暂停视频' })).toBeVisible()
  expectNoUnexpectedApi(api)
})
