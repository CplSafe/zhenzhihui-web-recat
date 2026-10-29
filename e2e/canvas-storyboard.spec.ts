import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('分镜滚轮只滚动列表，展开后长提示词完整展示并同步编辑', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await installStrictAuthenticatedApp(page)
  const items = Array.from({ length: 16 }, (_, index) => ({
    title: `场景 ${index + 1}`,
    prompt: '主体在温暖的客厅中缓缓走动，镜头推进并呈现柔和的光线。'.repeat(20),
    duration: '4',
    shot: '缓慢推进',
  }))
  await page.route('**/api/v1/canvases/122**', (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements:
              Number(url.searchParams.get('after_revision')) > 0
                ? []
                : [
                    {
                      element_id: 'script',
                      kind: 'node',
                      op: 'upsert',
                      payload: {
                        id: 'script',
                        type: 'text',
                        position: { x: 300, y: 150 },
                        style: { width: 500, height: 480 },
                        data: { kind: 'text', text: JSON.stringify(items) },
                      },
                    },
                  ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 122, title: '分镜阅读验证', status: 'active', revision: 1 },
    })
  })
  await page.goto('/canvas/122')
  const node = page.locator('.react-flow__node[data-id="script"]')
  await expect(node).toBeVisible()
  await page.getByRole('combobox', { name: '画布缩放' }).selectOption('100')
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', /scale\(1\)/)
  const storyboard = node.getByLabel(/分镜脚本，共/)
  const storyboardHeader = await storyboard.locator('header').boundingBox()
  const beforeDrag = await node.boundingBox()
  expect(storyboardHeader).not.toBeNull()
  expect(beforeDrag).not.toBeNull()
  // 卡片标题区域可拖动画布节点；展开按钮与镜头提示词编辑区继续保留各自交互。
  await page.mouse.move(storyboardHeader!.x + 120, storyboardHeader!.y + storyboardHeader!.height / 2)
  await page.mouse.down()
  await page.mouse.move(storyboardHeader!.x + 200, storyboardHeader!.y + storyboardHeader!.height / 2 + 48, {
    steps: 8,
  })
  await page.mouse.up()
  await expect.poll(async () => (await node.boundingBox())!.x).toBeGreaterThan(beforeDrag!.x + 40)
  const list = page.getByLabel('分镜列表', { exact: true })
  await expect(list).toBeVisible()
  const firstPrompt = node.getByRole('textbox', { name: '镜头 1 提示词', exact: true })
  const layout = () =>
    firstPrompt.evaluate((element) => ({
      fontSize: getComputedStyle(element).fontSize,
      height: element.clientHeight,
      contentHeight: element.scrollHeight,
      overflow: getComputedStyle(element).overflowY,
    }))
  const initialLayout = await layout()
  expect(initialLayout.contentHeight).toBeLessThanOrEqual(initialLayout.height + 2)
  expect(initialLayout.overflow).toBe('hidden')
  // 跨越此前 40% 的字号补偿边界，节点内部排版仍应保持不变。
  for (let index = 0; index < 7; index++) await page.getByRole('button', { name: '缩小', exact: true }).click()
  await expect.poll(layout).toEqual(initialLayout)
  await page.getByRole('combobox', { name: '画布缩放' }).selectOption('100')
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', /scale\(1\)/)
  await expect.poll(layout).toEqual(initialLayout)
  const transform = await page.locator('.react-flow__viewport').getAttribute('style')
  const bounds = await list.boundingBox()
  // 滚轮落在输入框正文上时，也应滚动外层列表，而非缩放画布。
  await page.mouse.move(bounds!.x + 100, bounds!.y + bounds!.height / 2)
  await page.mouse.wheel(0, 500)
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', transform!)
  await page.getByRole('button', { name: '展开查看' }).click()
  const modal = page.getByRole('dialog', { name: '分镜脚本 · 16 个镜头' })
  await expect(modal).toBeVisible()
  await expect(modal).not.toHaveClass(/ant-zoom-appear/)
  expect((await modal.boundingBox())!.width).toBeGreaterThan(1000)
  await page.screenshot({ path: 'test-results/storyboard-expanded.png' })
  await modal.getByRole('button', { name: '16 · 场景 16', exact: true }).click()
  const prompt = modal.getByRole('textbox', { name: '镜头 16 提示词', exact: true })
  await expect(prompt).toBeFocused()
  expect(await prompt.evaluate((element) => element.scrollHeight <= element.clientHeight + 2)).toBe(true)
  await prompt.fill('完整窗口编辑后的第十六个镜头')
  await modal.getByRole('button', { name: '完成', exact: true }).click()
  await expect(node.getByRole('textbox', { name: '镜头 16 提示词', exact: true })).toHaveValue(
    '完整窗口编辑后的第十六个镜头',
  )
  await page.setViewportSize({ width: 640, height: 850 })
  await node.getByRole('button', { name: '展开查看' }).click()
  await expect(modal).toBeVisible()
  await expect(modal).not.toHaveClass(/ant-zoom-appear/)
  await expect(modal.getByRole('navigation', { name: '镜头目录' })).toBeHidden()
  await modal.getByLabel('跳转镜头').selectOption('15')
  await expect(modal.getByRole('textbox', { name: '镜头 16 提示词', exact: true })).toBeFocused()
  await page.screenshot({ path: 'test-results/storyboard-mobile.png' })
})
