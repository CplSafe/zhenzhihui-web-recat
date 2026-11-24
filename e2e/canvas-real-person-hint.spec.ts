import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const { viewport, reducedZoom } of [
  { viewport: { width: 1440, height: 900 }, reducedZoom: false },
  { viewport: { width: 390, height: 640 }, reducedZoom: false },
  { viewport: { width: 1440, height: 900 }, reducedZoom: true },
]) {
  test(`添加参考菜单展示真人素材说明并打开素材库 ${viewport.width}px${reducedZoom ? ' 缩小画布' : ''}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    const state = await installStrictAuthenticatedApp(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: 42,
              display_name: 'Seedance 2.0',
              capability: 'video',
              operation_codes: ['video.generate'],
            },
          ],
        },
      }),
    )
    await page.route('**/api/v1/real-people?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route(/\/api\/v1\/canvases\/119(?:\/(?:elements|node-locks|members))?(?:\?.*)?$/, (route) => {
      const { pathname, searchParams } = new URL(route.request().url())
      if (pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
      if (pathname.endsWith('/members')) {
        return route.fulfill({
          json: { creator_id: 7, can_manage: true, member_user_ids: [], members_restricted: false },
        })
      }
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: 2 } })
      if (pathname.endsWith('/elements')) {
        return route.fulfill({
          json: {
            elements:
              Number(searchParams.get('after_revision')) > 0
                ? []
                : [
                    {
                      element_id: 'source',
                      kind: 'node',
                      payload: {
                        id: 'source',
                        type: 'video',
                        position: { x: 300, y: 150 },
                        style: { width: 320, height: 240 },
                        data: { kind: 'video', modelVersionId: 42, prompt: '参考人物生成视频' },
                      },
                    },
                  ],
            sync_revision: 1,
            history_floor_revision: 0,
            has_more: false,
          },
        })
      }
      return route.fulfill({ json: { id: 119, title: '真人引导布局检查', revision: 1 } })
    })
    await page.goto('/canvas/119')
    const node = page.locator('.react-flow__node[data-id="source"]')
    if (reducedZoom) {
      const zoom = page.getByRole('button', { name: /当前缩放.*点击回到 100%/ })
      await zoom.click()
      await expect(zoom).toHaveText('100%')
      await page.locator('.canvas-view').focus()
      for (const scale of ['83%', '69%', '58%', '48%', '40%', '33%']) {
        await page.keyboard.press('ControlOrMeta+-')
        await expect(zoom).toHaveText(scale)
      }
    }
    await node.click()
    const editor = page.locator('[data-canvas-node-panel]')
    await expect(editor).toBeVisible()
    const addReference = editor.getByRole('button', { name: '添加参考', exact: true })
    await expect(addReference).toBeEnabled()
    await expect(addReference).toHaveAttribute('aria-expanded', 'false')
    const hintText = '可使用已认证的真人素材'
    const hint = page.getByText(hintText, { exact: true })
    await expect(hint).toBeHidden()
    await addReference.click()
    const realPersonRow = page.getByRole('menuitem', { name: '从真人库选择', exact: true })
    await expect(realPersonRow.getByText(hintText, { exact: true })).toBeVisible()
    await expect(realPersonRow).toHaveAccessibleDescription(hintText)
    await expect(async () => {
      const box = (await realPersonRow.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
      expect(
        await realPersonRow.evaluate((element) => {
          const box = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        }),
      ).toBe(true)
    }).toPass()
    await page.screenshot({ path: testInfo.outputPath('real-person-menu.png') })
    await realPersonRow.click()
    await expect(page.getByText('真人素材库', { exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '搜索素材名称' })).toBeVisible()
    await expect(realPersonRow).toBeHidden()
    await expect(hint).toBeHidden()
    expect(errors).toEqual([])
    expect(state.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(state)
  })
}
