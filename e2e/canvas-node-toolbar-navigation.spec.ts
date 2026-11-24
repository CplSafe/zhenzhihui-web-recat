import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const wheelMode of ['pan', 'zoom'] as const) {
  test(`节点操作栏按钮和空白处可使用画布${wheelMode === 'pan' ? '平移' : '缩放'}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.addInitScript(
      (wheelMode) => localStorage.setItem('zzh_canvas_preferences', JSON.stringify({ wheelMode })),
      wheelMode,
    )
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/assets/602/download?**', (route) =>
      route.fulfill({ path: 'public/t1test.png', contentType: 'image/png' }),
    )
    let revision = 1
    await page.route(/\/api\/v1\/canvases\/244(?:\/(?:elements|node-locks|members))?(?:\?.*)?$/, (route) => {
      const { pathname, searchParams } = new URL(route.request().url())
      if (pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
      if (pathname.endsWith('/members')) {
        return route.fulfill({
          json: { creator_id: 7, can_manage: true, member_user_ids: [], members_restricted: false },
        })
      }
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { sync_revision: ++revision } })
      if (pathname.endsWith('/elements')) {
        return route.fulfill({
          json: {
            elements:
              Number(searchParams.get('after_revision')) > 0
                ? []
                : [
                    {
                      element_id: 'video',
                      kind: 'node',
                      payload: {
                        id: 'video',
                        type: 'video',
                        position: { x: 280, y: 160 },
                        style: { width: 320, height: 180 },
                        data: {
                          kind: 'video',
                          title: '节点操作栏滚轮检查',
                          assetId: 601,
                          assetWorkspaceId: WORKSPACE_ID,
                          resultUrl: '/t1test.mp4',
                          posterAssetId: 602,
                        },
                      },
                    },
                  ],
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          },
        })
      }
      return route.fulfill({ json: { id: 244, title: '节点操作栏导航检查', revision } })
    })

    await page.goto('/canvas/244')
    const node = page.locator('.react-flow__node[data-id="video"]')
    await node.locator('.canvas-node-header').click()
    const toolbar = page.getByRole('toolbar', { name: '节点操作', exact: true })
    const toolbarButton = (name: string) => toolbar.getByRole('button', { name, exact: true })
    const viewport = () =>
      page.locator('.react-flow__viewport').evaluate((element) => {
        const matrix = new DOMMatrix(getComputedStyle(element).transform)
        return { x: matrix.e, y: matrix.f, zoom: matrix.a }
      })
    const expectCanvasWheel = async () => {
      const before = await viewport()
      await page.mouse.wheel(0, 20)
      if (wheelMode === 'pan') {
        await expect.poll(async () => (await viewport()).y).toBeLessThan(before.y)
        expect((await viewport()).zoom).toBe(before.zoom)
      } else {
        await expect.poll(async () => (await viewport()).zoom).toBeLessThan(before.zoom)
      }
      await expect(node).toHaveClass(/selected/)
    }
    await expect(toolbar).toBeVisible()
    for (const name of [
      '重命名节点',
      '截取画面为图片',
      '下载素材',
      '主体编辑',
      '超分',
      '裁剪时长',
      '删除节点',
      '放大预览视频',
    ]) {
      await test.step(`悬停${name}使用滚轮`, async () => {
        await toolbarButton(name).hover()
        await expectCanvasWheel()
      })
    }
    await test.step('从工具栏空白处使用滚轮', async () => {
      const bounds = (await toolbar.boundingBox())!
      const point = { x: bounds.x + bounds.width / 2, y: bounds.y + 2 }
      await page.mouse.move(point.x, point.y)
      expect(await toolbar.evaluate((element, { x, y }) => document.elementFromPoint(x, y) === element, point)).toBe(
        true,
      )
      await expectCanvasWheel()
    })
    await page.screenshot({ path: testInfo.outputPath('node-toolbar-wheel.png') })

    const rename = toolbarButton('重命名节点')
    const renameInput = node.locator('input.canvas-node-header__label')
    const expectRenameClick = async () => {
      await rename.click()
      await expect(renameInput).toBeFocused()
      await renameInput.press('Escape')
      await expect(renameInput).toHaveCount(0)
    }
    if (wheelMode === 'pan') {
      const root = page.locator('.canvas-view')
      const hand = page.getByRole('button', { name: '拖动', exact: true })
      const dragRenameButton = async (button: 'middle' | 'left') => {
        await rename.hover()
        const bounds = (await rename.boundingBox())!
        const x = bounds.x + bounds.width / 2
        const y = bounds.y + bounds.height / 2
        const before = await viewport()
        await page.mouse.move(x, y)
        await page.mouse.down({ button })
        await page.mouse.move(x + 60, y, { steps: 8 })
        await page.mouse.up({ button })
        await expect.poll(async () => (await viewport()).x).toBeCloseTo(before.x + 60, 0)
        await expect(renameInput).toHaveCount(0)
        await expect(node).toHaveClass(/selected/)
      }
      for (const button of ['middle', 'left'] as const) {
        if (button === 'left') {
          await root.focus()
          await page.keyboard.press('h')
          await expect(hand).toHaveAttribute('aria-pressed', 'true')
        }
        await test.step(`从工具栏按钮开始${button === 'middle' ? '中键' : '抓手'}拖动`, () => dragRenameButton(button))
      }
      await expectRenameClick()
      await root.focus()
      await page.keyboard.press('v')
      await expect(hand).toHaveAttribute('aria-pressed', 'false')
      await test.step('从按钮开始按住空格拖动', async () => {
        await rename.hover()
        await page.keyboard.down('Space')
        await expect(root).toHaveClass(/is-space-panning/)
        await dragRenameButton('left')
        await page.keyboard.up('Space')
        await expect(root).not.toHaveClass(/is-space-panning/)
      })
    }

    await expectRenameClick()
    await test.step('打开的截帧菜单保留内部滚轮', async () => {
      await toolbarButton('截取画面为图片').click()
      const menu = page.getByRole('menu', { name: '截帧位置' })
      await menu.getByRole('menuitem', { name: '截取当前帧', exact: true }).hover()
      const before = await viewport()
      const wheelReceived = page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            window.addEventListener(
              'wheel',
              () => requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              { capture: true, once: true },
            ),
          ),
      )
      await page.mouse.wheel(0, 40)
      await wheelReceived
      expect(await viewport()).toEqual(before)
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    })
    await toolbarButton('放大预览视频').click()
    const preview = page.getByRole('dialog', { name: '视频预览', exact: true })
    await expect(preview).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    await expect(node).toHaveClass(/selected/)
    expectNoUnexpectedApi(api)
  })
}
