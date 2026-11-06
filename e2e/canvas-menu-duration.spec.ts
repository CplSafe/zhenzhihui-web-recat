import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

async function setup(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: 42,
            display_name: '视频测试模型',
            capability: 'video',
            operation_codes: ['video.generate'],
            params_schema: {
              fields: [
                {
                  name: 'duration',
                  display_name: '视频时长',
                  type: 'integer',
                  default: 9,
                  options: Array.from({ length: 27 }, (_, i) => i + 4),
                },
                {
                  name: 'resolution',
                  display_name: '分辨率',
                  type: 'string',
                  default: '720P',
                  options: ['480P', '720P'],
                },
                {
                  name: 'aspect_ratio',
                  display_name: '画面比例',
                  type: 'string',
                  default: '16:9',
                  options: ['16:9', '9:16'],
                },
              ],
            },
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/119**', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'PATCH'
          ? { sync_revision: 2 }
          : new URL(route.request().url()).pathname.endsWith('/elements')
            ? {
                elements: [
                  {
                    element_id: 'source',
                    kind: 'node',
                    payload: {
                      id: 'source',
                      type: 'video',
                      position: { x: 300, y: 150 },
                      style: { width: 320, height: 240 },
                      data: {
                        kind: 'video',
                        modelVersionId: 42,
                        prompt: '测试',
                        params: { duration: 9, resolution: '720P', aspect_ratio: '16:9' },
                      },
                    },
                  },
                ],
                sync_revision: 1,
                history_floor_revision: 0,
                has_more: false,
              }
            : { id: 119, title: '画布测试', revision: 1 },
    }),
  )
  await page.goto('/canvas/119')
  await expect(page.locator('.react-flow__node[data-id="source"]')).toBeVisible()
}

test('创建副本子菜单可见可点击且主菜单不产生横向滚动', async ({ page }, testInfo) => {
  await setup(page)
  await page.locator('.react-flow__node[data-id="source"]').click({ button: 'right' })
  const menu = page.locator('.canvas-context-menu').first()
  const trigger = menu.getByRole('button', { name: '创建副本' })
  await trigger.hover()
  const sub = page.getByRole('menu')
  await expect(sub.getByRole('menuitem', { name: /只含当前节点/ })).toBeVisible()
  await expect(sub.getByRole('menuitem', { name: '包含之前所有节点' })).toBeVisible()
  expect(await menu.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await sub.getByRole('menuitem', { name: /只含当前节点/ }).hover()
  await page.screenshot({ path: testInfo.outputPath('duplicate-menu.png') })
  await sub.getByRole('menuitem', { name: /只含当前节点/ }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
})

test('快速拖动视频时长时生成参数面板保持位置', async ({ page }, testInfo) => {
  await setup(page)
  await page.locator('.react-flow__node[data-id="source"]').click()
  const editor = page.locator('[data-canvas-node-panel]')
  const trigger = editor.locator('button[aria-expanded]').last()
  await trigger.click()
  const menu = page.getByRole('region', { name: '生成参数' })
  const slider = menu.getByRole('slider', { name: '视频时长' })
  await expect(slider).toBeVisible()
  await expect(menu).toBeVisible()
  // Wait until the opening animation and canvas auto-pan have settled before measuring drag movement.
  await menu.evaluate(async (element) => {
    let previous = element.getBoundingClientRect()
    let stableSince = performance.now()
    while (performance.now() - stableSince < 300) {
      await new Promise(requestAnimationFrame)
      const next = element.getBoundingClientRect()
      if (Math.abs(next.x - previous.x) > 0.1 || Math.abs(next.y - previous.y) > 0.1) stableSince = performance.now()
      previous = next
    }
  })
  const initial = (await menu.boundingBox())!
  const rect = (await slider.boundingBox())!
  await page.mouse.move(rect.x + rect.width * 0.1, rect.y + rect.height / 2)
  await page.mouse.down()
  for (const fraction of [0.9, 0.1, 0.8, 0.2, 0.95]) {
    await page.mouse.move(rect.x + rect.width * fraction, rect.y + rect.height / 2, { steps: 3 })
    const current = (await menu.boundingBox())!
    expect(Math.abs(current.x - initial.x)).toBeLessThan(2)
    expect(Math.abs(current.y - initial.y)).toBeLessThan(2)
  }
  await page.mouse.up()
  await expect(slider).not.toHaveAttribute('aria-valuetext', '9秒')
  await page.screenshot({ path: testInfo.outputPath('duration.png') })
})
