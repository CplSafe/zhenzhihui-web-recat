import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('空媒体节点、音频节点和时间线节点在深色画布上有可辨认的表面', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/221**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    await route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: [
              {
                element_id: 'empty-image',
                kind: 'node',
                payload: {
                  id: 'empty-image',
                  type: 'image',
                  position: { x: 80, y: 120 },
                  style: { width: 240, height: 180 },
                  data: { kind: 'image' },
                },
              },
              {
                element_id: 'empty-video',
                kind: 'node',
                payload: {
                  id: 'empty-video',
                  type: 'video',
                  position: { x: 400, y: 120 },
                  style: { width: 240, height: 180 },
                  data: { kind: 'video' },
                },
              },
              {
                element_id: 'audio-surface',
                kind: 'node',
                payload: {
                  id: 'audio-surface',
                  type: 'audio',
                  position: { x: 720, y: 120 },
                  style: { width: 360, height: 220 },
                  data: { kind: 'audio' },
                },
              },
              {
                element_id: 'timeline-surface',
                kind: 'node',
                payload: {
                  id: 'timeline-surface',
                  type: 'timeline',
                  position: { x: 80, y: 440 },
                  style: { width: 480, height: 260 },
                  data: { kind: 'timeline', timeline: { clips: [], audioClips: [] } },
                },
              },
            ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 221, title: '节点表面检查', status: 'active', revision: 1 },
    })
  })

  await page.goto('/canvas/221')
  const surface = await page.locator('.canvas-view').evaluate((element) => {
    const probe = document.createElement('div')
    probe.style.background = getComputedStyle(element).getPropertyValue('--canvas-surface')
    element.append(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()
    return color
  })
  for (const id of ['empty-image', 'empty-video']) {
    const node = page.locator(`.react-flow__node[data-id="${id}"] .canvas-default-node`)
    await expect(node).toHaveClass(/is-empty-media/)
    await expect.poll(() => node.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(surface)
    await expect(node.locator('.canvas-node-body > svg')).toHaveAttribute('opacity', '0.42')
  }
  await expect
    .poll(() =>
      page
        .locator('.react-flow__node[data-id="audio-surface"] .canvas-node-body > div')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe(surface)
  await expect
    .poll(() =>
      page
        .locator('.react-flow__node[data-id="timeline-surface"] .canvas-default-node')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe(surface)
  await page.screenshot({ path: testInfo.outputPath('canvas-node-surfaces.png'), fullPage: true })
  expectNoUnexpectedApi(api)
})
