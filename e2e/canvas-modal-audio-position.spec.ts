import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('空间充足时音频面板在下方居中，音色库关闭后恢复节点操作', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const state = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('**/api/v1/ai/tools**', (route) => {
    expect(route.request().method()).toBe('GET')
    expect(new URL(route.request().url()).searchParams.get('workspace_id')).toBe('21')
    return route.fulfill({ json: { code: 0, data: [] } })
  })
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: [{ id: 91, display_name: '配音模型', operation_codes: ['audio.tts'] }],
    }),
  )
  await page.route('**/api/v1/voices**', (route) => route.fulfill({ json: { items: [], total: 0 } }))
  await page.route('**/api/v1/canvases/121/members?**', (route) =>
    route.fulfill({ json: { creator_id: 7, can_manage: true, member_user_ids: [], members_restricted: false } }),
  )
  await page.route(/\/api\/v1\/canvases\/121(?:\/(?:elements|node-locks))?(?:\?.*)?$/, (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
    return route.fulfill({
      json: pathname.endsWith('/elements')
        ? {
            elements: [
              {
                id: 'audio',
                type: 'audio',
                position: { x: 500, y: 160 },
                data: { kind: 'audio', modelVersionId: 91, operationCode: 'audio.tts', prompt: '保留原始文案' },
              },
              {
                id: 'below',
                type: 'image',
                position: { x: 500, y: 360 },
                data: { kind: 'image', title: '下方障碍节点' },
              },
            ].map((node) => ({
              element_id: node.id,
              kind: 'node',
              op: 'upsert',
              payload: { ...node, style: { width: 320, height: 120 } },
            })),
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 121, title: '弹窗与音频定位', status: 'active', revision: 1 },
    })
  })
  await page.goto('/canvas/121')
  const node = page.locator('.react-flow__node[data-id="audio"]')
  await node.locator('.canvas-node-header').click()
  const panel = node.locator('.canvas-audio-panel')
  await expect(panel).toBeVisible()
  await expect
    .poll(async () => {
      const card = await node.boundingBox()
      const settings = await panel.boundingBox()
      return Math.abs(card!.x + card!.width / 2 - settings!.x - settings!.width / 2)
    })
    .toBeLessThan(3)
  const card = await node.boundingBox()
  const settings = await panel.boundingBox()
  expect(settings!.y).toBeGreaterThanOrEqual(card!.y + card!.height)
  await expect(page.getByRole('toolbar', { name: '节点操作', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '音色库', exact: true }).first().click()
  const modal = page.getByRole('dialog', { name: '音色库', exact: true })
  await expect(modal).toBeVisible()
  await expect(page.getByRole('toolbar', { name: '节点操作', exact: true })).toHaveCount(0)
  await expect(panel).toBeHidden()
  await page.keyboard.press('Delete')
  await expect(node).toHaveCount(1)
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('textbox', { name: '配音文案或音乐描述' })).toHaveValue('保留原始文案')
  await expect(page.getByRole('toolbar', { name: '节点操作', exact: true })).toBeVisible()
  await expect(node).toHaveClass(/selected/)
  expect(errors).toEqual([])
  expectNoUnexpectedApi(state)
})
