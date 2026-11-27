import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const width of [1440, 768, 390]) {
  test(`画布列表与新建弹窗在 ${width}px 可操作`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/canvases?**', (route) =>
      route.fulfill({
        json: {
          items: [
            { id: 701, title: '春日新品 · 视觉探索', updated_at: '2026-10-22T08:30:00Z' },
            { id: 702, title: '产品故事分镜', updated_at: '2026-10-21T09:00:00Z' },
            { id: 703, title: '品牌短片素材', status: 'archived' },
          ],
          total: 3,
        },
      }),
    )
    await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/canvases/701**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
          : { id: 701, title: '春日新品 · 视觉探索', revision: 1 },
      }),
    )
    await page.goto('/canvas?manage=1')
    await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()
    const openMenu = page.getByRole('button', { name: '打开菜单', exact: true })
    if (await openMenu.isVisible()) await openMenu.click()
    const sidebar = page.locator('.app-sidebar')
    await expect(sidebar.getByText('集市', { exact: true })).toBeVisible()
    await expect(sidebar.getByRole('button', { name: '无限画布', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('sidebar-product-names.png'), fullPage: true })
    await sidebar.getByRole('button', { name: '无限画布', exact: true }).click()
    await expect(page).toHaveURL(/\/canvas$/)
    await expect(page.getByRole('region', { name: '开始创作' })).toBeVisible()
    await expect(page.locator('.canvas-entry-main')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.getByRole('button', { name: '打开画布 春日新品 · 视觉探索', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('canvas-light-entry.png') })
    await page.getByRole('button', { name: '查看更多' }).click()
    await expect(page).toHaveURL(/\/projects\?flow=canvas$/)
    await expect(page.getByRole('tab', { name: '无限画布' })).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({ path: testInfo.outputPath('canvas-more-projects.png') })
    await page.goto('/canvas?manage=1')
    await expect(page.getByRole('button', { name: '打开画布 春日新品 · 视觉探索', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByText('共 3 个画布', { exact: true })).toBeVisible()
    await page.goto('/projects?flow=canvas')
    await expect(page.getByRole('tab', { name: '无限画布' })).toHaveAttribute('aria-selected', 'true')
    await page.goto('/canvas?manage=1')
    await page.screenshot({ path: testInfo.outputPath('canvas-list.png'), fullPage: true })
    await page.getByRole('button', { name: '更多操作' }).first().focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/canvas\?manage=1$/)
    await page.getByRole('button', { name: '重命名', exact: true }).click()
    const renameDialog = page.getByRole('dialog', { name: '重命名画布' })
    await expect(renameDialog).toBeVisible()
    const renameMask = page.locator('.cl-rename-mask')
    const maskBounds = await renameMask.boundingBox()
    expect(maskBounds).not.toBeNull()
    expect(maskBounds!.x).toBe(0)
    expect(maskBounds!.y).toBe(0)
    expect(maskBounds!.width).toBe(width)
    expect(maskBounds!.height).toBe(900)
    const renameBounds = await renameDialog.boundingBox()
    const inputBounds = await renameDialog.getByPlaceholder('输入画布名称').boundingBox()
    expect(renameBounds!.x).toBeGreaterThanOrEqual(0)
    expect(renameBounds!.x + renameBounds!.width).toBeLessThanOrEqual(width)
    expect(inputBounds!.x).toBeGreaterThanOrEqual(renameBounds!.x)
    expect(inputBounds!.x + inputBounds!.width).toBeLessThanOrEqual(renameBounds!.x + renameBounds!.width)
    await page.screenshot({ path: testInfo.outputPath(`canvas-rename-${width}.png`) })
    await renameDialog.getByRole('button', { name: '取消' }).click()
    await page.getByRole('button', { name: /新建画布/ }).click()
    const dialog = page.getByRole('dialog', { name: '创建新画布' })
    await expect(dialog).toBeVisible()
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await expect(dialog.getByRole('button', { name: '创建画布', exact: true })).toBeDisabled()
    await dialog.getByPlaceholder('请输入画布名称').fill('新的创意')
    await expect(dialog.getByRole('button', { name: '创建画布', exact: true })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('canvas-create.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: /新建画布/ }).click()
    await expect(dialog.getByPlaceholder('请输入画布名称')).toHaveValue('')
    await dialog.getByRole('button', { name: '取消' }).click()
    expectNoUnexpectedApi(api)
  })
}

test('空画布列表显示创建引导', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.goto('/canvas?manage=1')
  await expect(page.getByText(/还没有画布/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('canvas-empty.png'), fullPage: true })
  await page.goto('/canvas')
  await expect(page.getByRole('region', { name: '开始创作' })).toBeVisible()
  await expect(page.locator('.app-sidebar').getByRole('button', { name: '无限画布', exact: true })).toBeVisible()
  await page.getByRole('region', { name: '开始创作' }).getByRole('button', { name: '创建脚本' }).click()
  await expect(page.getByRole('dialog', { name: '创建新画布' })).toBeVisible()
  expectNoUnexpectedApi(api)
})

for (const width of [1440, 390]) {
  test(`最近项目在 ${width}px 以不同高度的海报铺排，项目信息保留在封面内`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    const pageErrors: Error[] = []
    page.on('pageerror', (error) => pageErrors.push(error))
    const projects = [
      { title: '竖图', width: 90, height: 160 },
      { title: '横图', width: 160, height: 90 },
      { title: '无封面' },
      { title: '正方形', width: 120, height: 120 },
      { title: '超宽预览', width: 300, height: 90 },
      { title: '横图二', width: 160, height: 90 },
      { title: '竖图二', width: 90, height: 160 },
      { title: '横图三', width: 160, height: 90 },
      { title: '竖图三', width: 90, height: 160 },
      { title: '无封面二' },
    ].map((project, index) => ({
      ...project,
      id: 701 + index,
      user_id: 7,
      updated_at: new Date(Date.UTC(2026, 10, 3, 10, 0, 59 - index)).toISOString(),
    }))
    await page.route('**/api/v1/canvases?**', (route) => {
      const offset = Number(new URL(route.request().url()).searchParams.get('offset'))
      return route.fulfill({ json: { items: offset === 0 ? projects : [] } })
    })
    await page.route('**/api/v1/canvases/*/elements?**', (route) => {
      const id = Number(new URL(route.request().url()).pathname.split('/').at(-2))
      const project = projects.find((item) => item.id === id)
      return route.fulfill({
        json: {
          elements: project?.width
            ? [
                {
                  element_id: 'cover',
                  kind: 'node',
                  op: 'upsert',
                  payload: { type: 'image', data: { kind: 'image', assetId: id } },
                },
              ]
            : [],
          has_more: false,
          sync_revision: 1,
        },
      })
    })
    await page.route('**/api/v1/assets/*/download?**', (route) => {
      const id = Number(new URL(route.request().url()).pathname.split('/').at(-2))
      const project = projects.find((item) => item.id === id)
      if (!project?.width || !project.height) return route.fallback()
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${project.width}" height="${project.height}"><rect width="100%" height="100%" fill="hsl(${(id * 41) % 360}, 26%, 67%)"/></svg>`,
      })
    })
    await page.goto('/canvas')
    const recent = page.getByRole('region', { name: '最近的漫剧项目' })
    const cards = recent.getByRole('button', { name: /^打开画布 / })
    await expect(cards).toHaveCount(projects.length)
    await expect
      .poll(() => cards.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))))
      .toEqual(projects.map(({ title }) => `打开画布 ${title}`))
    const posterHeights = new Map<string, number>()
    for (const project of width > 1000 ? projects : projects.slice(0, 5)) {
      const card = recent.getByRole('button', { name: `打开画布 ${project.title}`, exact: true })
      const cover = card.locator('[data-recent-canvas-cover]')
      const caption = card.locator('[data-recent-canvas-caption]')
      await cover.scrollIntoViewIfNeeded()
      if (project.width && project.height) {
        const image = cover.locator('img')
        await expect(image).toHaveJSProperty('naturalWidth', project.width)
        await expect(cover).toHaveAttribute('data-media-ready', 'true')
      } else {
        await expect(cover.getByText('暂无预览')).toBeVisible()
      }
      const targetRatio =
        project.width && project.height ? Math.max(9 / 16, Math.min(4 / 3, project.width / project.height)) : 4 / 5
      await expect
        .poll(async () => {
          const bounds = await cover.boundingBox()
          return bounds ? bounds.width / bounds.height : Infinity
        })
        .toBeLessThan(targetRatio + 0.02)
      const [coverBounds, captionBounds, cardBounds] = await Promise.all([
        cover.boundingBox(),
        caption.boundingBox(),
        card.boundingBox(),
      ])
      expect(coverBounds).not.toBeNull()
      expect(captionBounds).not.toBeNull()
      expect(cardBounds).not.toBeNull()
      expect(Math.abs(coverBounds!.height - cardBounds!.height)).toBeLessThan(3)
      expect(Math.abs(coverBounds!.width - cardBounds!.width)).toBeLessThan(3)
      expect(captionBounds!.x).toBeGreaterThanOrEqual(coverBounds!.x - 1)
      expect(captionBounds!.x + captionBounds!.width).toBeLessThanOrEqual(coverBounds!.x + coverBounds!.width + 1)
      expect(captionBounds!.y).toBeGreaterThanOrEqual(coverBounds!.y - 1)
      expect(captionBounds!.y + captionBounds!.height).toBeLessThanOrEqual(coverBounds!.y + coverBounds!.height + 1)
      posterHeights.set(project.title, coverBounds!.height)
      if (project.title === '竖图') {
        expect(Math.abs(coverBounds!.width / coverBounds!.height - 9 / 16)).toBeLessThan(0.02)
      }
    }
    expect(posterHeights.get('竖图')!).toBeGreaterThan(posterHeights.get('横图')! + 12)
    expect(posterHeights.get('竖图')!).toBeGreaterThan(posterHeights.get('无封面')! + 12)

    const bounds = await cards.evaluateAll((items) =>
      items.map((item) => {
        const { top, right, bottom, left } = item.getBoundingClientRect()
        return { top, right, bottom, left }
      }),
    )
    const top = Math.min(...bounds.map((item) => item.top))
    const firstRow = bounds.filter((item) => Math.abs(item.top - top) < 2)
    expect(firstRow.length).toBeGreaterThan(1)
    const tallestFirstRowBottom = Math.max(...firstRow.map((item) => item.bottom))
    expect(bounds.some((item) => item.top > top + 2 && item.top < tallestFirstRowBottom - 2)).toBe(true)
    for (const [index, one] of bounds.entries()) {
      expect(
        bounds
          .slice(index + 1)
          .some(
            (other) =>
              Math.min(one.right, other.right) - Math.max(one.left, other.left) > 2 &&
              Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top) > 2,
          ),
      ).toBe(false)
    }
    await recent.getByRole('heading', { name: '最近的项目' }).scrollIntoViewIfNeeded()
    expect(await page.locator('.canvas-entry-main').evaluate((main) => main.scrollWidth <= main.clientWidth + 1)).toBe(
      true,
    )
    await page.screenshot({ path: testInfo.outputPath(`canvas-masonry-${width}.png`) })
    expect(pageErrors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}

for (const retryPage of [false, true]) {
  test(
    retryPage
      ? '追加最近项目失败时可按原偏移重试并保留已展示的卡片'
      : '最近项目滚动时预取下一页，接近页尾才追加，并保留卡片操作与查看更多',
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1024, height: 440 })
      const api = await installStrictAuthenticatedApp(page)
      const pageErrors: Error[] = []
      page.on('pageerror', (error) => pageErrors.push(error))
      const projects = Array.from({ length: 17 }, (_, index) => ({
        id: 801 + index,
        title: `滚动项目 ${String(index + 1).padStart(2, '0')}`,
        user_id: index === 10 ? 8 : 7,
        updated_at: new Date(Date.UTC(2026, 10, 3, 10, 0, 59 - index)).toISOString(),
      }))
      const listRequests: Array<{ offset: number; limit: number }> = []
      const coverRequests: number[] = []
      const nextPage = [projects[9], ...projects.slice(10)]
      let releaseFailure!: () => void
      const pendingFailure = new Promise<void>((resolve) => {
        releaseFailure = resolve
      })
      await page.route('**/api/v1/canvases?**', async (route) => {
        const query = new URL(route.request().url()).searchParams
        const offset = Number(query.get('offset'))
        const limit = Number(query.get('limit'))
        expect(Number(query.get('workspace_id'))).toBe(WORKSPACE_ID)
        listRequests.push({ offset, limit })
        if (offset === 10 && limit === 10) {
          if (retryPage && listRequests.filter((request) => request.offset === 10).length === 1) {
            await pendingFailure
            return route.fulfill({ status: 503, json: { message: '模拟最近项目暂时不可用' } })
          }
          return route.fulfill({ json: { items: nextPage } })
        }
        return route.fulfill({ json: { items: projects.slice(offset, offset + limit) } })
      })
      await page.route('**/api/v1/canvases/*/elements?**', (route) => {
        const canvasId = Number(new URL(route.request().url()).pathname.split('/').at(-2))
        coverRequests.push(canvasId)
        return route.fulfill({ json: { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false } })
      })
      await page.route('**/api/v1/canvases/811?**', (route) =>
        route.fulfill({ json: { ...projects[10], workspace_id: WORKSPACE_ID, members_restricted: false } }),
      )
      await page.route('**/api/v1/canvases/811/members?**', (route) =>
        route.fulfill({ json: { members: [], members_restricted: false } }),
      )
      await page.route('**/api/v1/canvases/811/node-locks?**', (route) =>
        route.fulfill({ json: { granted: true, nodes: {} } }),
      )
      await page.routeWebSocket('**/api/v1/canvases/811/node-locks/socket?**', (socket) => {
        socket.onMessage(() => socket.send(JSON.stringify({ type: 'state', data: { granted: true, nodes: {} } })))
      })
      await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))

      await page.goto('/canvas')
      const main = page.getByRole('main', { name: '无限画布创作入口' })
      const recent = main.getByRole('region', { name: '最近的漫剧项目' })
      const cards = recent.getByRole('button', { name: /^打开画布 / })
      await expect(cards).toHaveCount(10)
      await expect.poll(() => coverRequests.length).toBeGreaterThan(0)
      expect(listRequests).toEqual([{ offset: 0, limit: 10 }])
      expect(coverRequests).not.toContain(810)

      const scrollAboveEnd = (pixels: number) =>
        main.evaluate((element, distance) => {
          element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - distance)
        }, pixels)
      if (retryPage) {
        try {
          await scrollAboveEnd(330)
          await expect.poll(() => listRequests.map(({ offset }) => offset)).toEqual([0, 10])
          await scrollAboveEnd(60)
          await expect(recent.getByText('正在加载更多项目…', { exact: true })).toBeVisible()
          await expect(cards).toHaveCount(10)
        } finally {
          releaseFailure()
        }
        const retry = recent.getByRole('button', { name: /重试/ })
        await expect(retry).toBeVisible()
        await expect(recent.getByText('更多项目加载失败', { exact: true })).toBeVisible()
        await expect(cards).toHaveCount(10)
        await retry.scrollIntoViewIfNeeded()
        await page.screenshot({ path: testInfo.outputPath('canvas-masonry-page-retry.png') })
        await retry.click()
        await expect(cards).toHaveCount(projects.length)
        await expect(retry).toHaveCount(0)
        expect(listRequests).toEqual([
          { offset: 0, limit: 10 },
          { offset: 10, limit: 10 },
          { offset: 10, limit: 10 },
        ])
        expect(pageErrors).toEqual([])
        expectNoUnexpectedApi(api)
        return
      }
      const prefetchedPage = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/api/v1/canvases' && url.searchParams.get('offset') === '10' && response.ok()
      })
      await scrollAboveEnd(330)
      expect(await (await prefetchedPage).json()).toMatchObject({ items: nextPage })
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      )
      await expect(cards).toHaveCount(10)
      await expect(recent.getByRole('button', { name: '打开画布 滚动项目 11' })).toHaveCount(0)
      expect(coverRequests).not.toContain(811)

      await scrollAboveEnd(60)
      await expect(cards).toHaveCount(projects.length)
      const appended = recent.getByRole('button', { name: '打开画布 滚动项目 11', exact: true })
      await appended.scrollIntoViewIfNeeded()
      await expect.poll(() => coverRequests).toContain(811)
      expect(listRequests).toEqual([
        { offset: 0, limit: 10 },
        { offset: 10, limit: 10 },
      ])
      const menu = recent.getByRole('button', { name: '画布操作 滚动项目 11', exact: true })
      await menu.focus()
      await page.keyboard.press('Enter')
      await expect(menu).toHaveAttribute('aria-expanded', 'true')
      await expect(recent.getByRole('button', { name: '创建副本', exact: true })).toBeVisible()
      await expect(recent.getByText('仅创建者可重命名或删除此画布')).toBeVisible()
      await expect(page).toHaveURL(/\/canvas$/)
      await page.screenshot({ path: testInfo.outputPath('canvas-masonry-next-page.png') })
      await menu.click()
      await appended.focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/canvas\/811$/)
      await page.getByRole('button', { name: '返回无限画布' }).click()
      await expect(page).toHaveURL(/\/canvas$/)
      await recent.getByRole('button', { name: '查看更多' }).click()
      await expect(page).toHaveURL(/\/projects\?flow=canvas$/)
      await expect(page.getByRole('tab', { name: '无限画布' })).toHaveAttribute('aria-selected', 'true')
      expect(pageErrors).toEqual([])
      expectNoUnexpectedApi(api)
    },
  )
}

test.describe('最近项目卡片元数据', () => {
  test.use({ timezoneId: 'Asia/Shanghai' })

  for (const width of [1440, 390]) {
    test.describe(`${width}px`, () => {
      test.use({ hasTouch: width === 390 })
      test(`最近项目在 ${width}px 完整显示名称、积分状态和日期时间`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 })
        const api = await installStrictAuthenticatedApp(page)
        const pageErrors: Error[] = []
        page.on('pageerror', (error) => pageErrors.push(error))
        const longTitle = '夜行队穿过钟楼的分镜、灯光与画外音最终确认稿'
        const updatedAt = '2026-11-03T10:04:00.000Z'
        const createdAt = '2026-11-01T17:09:00.000Z'
        await page.route('**/api/v1/canvases?**', (route) =>
          route.fulfill({
            json: {
              items: [
                { id: 701, title: longTitle, used_credits: 15207.23, updated_at: updatedAt, created_at: createdAt },
                { id: 702, title: '累计消耗明确为零', used_credits: 0, created_at: createdAt },
                { id: 703, title: '无统计记录', used_credits: null, updated_at: 'invalid-date' },
              ],
            },
          }),
        )

        await page.goto('/canvas')
        const main = page.getByRole('main', { name: '无限画布创作入口' })
        const recent = main.getByRole('region', { name: '最近的漫剧项目' })
        const actual = recent.getByRole('button', { name: `打开画布 ${longTitle}`, exact: true })
        const zero = recent.getByRole('button', { name: '打开画布 累计消耗明确为零', exact: true })
        const missing = recent.getByRole('button', { name: '打开画布 无统计记录', exact: true })
        await expect(actual.getByText(longTitle, { exact: true })).toBeVisible()
        await expect(actual).toContainText(/累计消耗\s*15,207\.23 积分/)
        await expect(zero).toContainText(/累计消耗\s*0 积分/)
        await expect(missing).toContainText(/累计消耗\s*暂无记录/)
        await expect(recent.getByText('消耗时间', { exact: true })).toBeHidden()
        await expect(recent.getByText('预估积分', { exact: true })).toBeHidden()

        const updated = actual.locator('time')
        await expect(actual.getByText('更新于', { exact: true })).toBeVisible()
        await expect(updated).toHaveAttribute('datetime', updatedAt)
        await expect(updated).toHaveText(/2026[年/.-]\s*11[月/.-]\s*03日?\s+18:04/)
        const created = zero.locator('time')
        await expect(zero.getByText('创建于', { exact: true })).toBeVisible()
        await expect(created).toHaveAttribute('datetime', createdAt)
        await expect(created).toHaveText(/2026[年/.-]\s*11[月/.-]\s*02日?\s+01:09/)
        await expect(missing).toContainText(/更新时间\s*暂无记录/)
        await expect(missing.locator('time')).toHaveCount(0)
        await expect(actual).toHaveAccessibleDescription(/累计消耗\s*15,207\.23 积分/)

        await actual.getByText(longTitle, { exact: true }).scrollIntoViewIfNeeded()
        for (const text of [actual.getByText(longTitle, { exact: true }), updated, created]) {
          expect(
            await text.evaluate((element) => {
              const box = element.getBoundingClientRect()
              const range = document.createRange()
              range.selectNodeContents(element)
              const lines = Array.from(range.getClientRects())
              return (
                lines.length > 0 &&
                lines.every(
                  (line) =>
                    line.left >= box.left - 2 &&
                    line.right <= box.right + 2 &&
                    line.top >= box.top - 2 &&
                    line.bottom <= box.bottom + 2,
                )
              )
            }),
          ).toBe(true)
        }
        expect(await main.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
        expect(api.seen.filter(({ path }) => /estimate-cost|\/canvases\/\d+\/statistics/.test(path))).toEqual([])
        await page.screenshot({ path: testInfo.outputPath(`canvas-recent-metadata-${width}.png`) })

        const actions = recent.getByRole('button', { name: `画布操作 ${longTitle}`, exact: true })
        const popup = recent.locator('[data-recent-canvas-id="701"] [data-recent-canvas-menu]')
        await expect(actions).toHaveAttribute('aria-expanded', 'false')
        if (width === 390) {
          await actions.tap()
        } else {
          await actions.focus()
          await page.keyboard.press('Enter')
        }
        await expect(actions).toHaveAttribute('aria-expanded', 'true')
        await expect(popup).toContainText(/消耗时间\s*暂无记录/)
        await expect(popup).toContainText(/预估积分\s*暂无预估/)
        await expect(popup.getByText('消耗时间', { exact: true })).toBeInViewport()
        await expect(popup.getByText('预估积分', { exact: true })).toBeInViewport()
        await expect(page).toHaveURL(/\/canvas$/)
        await page.screenshot({ path: testInfo.outputPath(`canvas-recent-metadata-menu-${width}.png`) })
        if (width === 390) await actions.tap()
        else await page.keyboard.press('Escape')
        await expect(actions).toHaveAttribute('aria-expanded', 'false')
        await expect(popup.getByText('预估积分', { exact: true })).toBeHidden()
        expect(pageErrors).toEqual([])
        expectNoUnexpectedApi(api)
      })
    })
  }
})

test('漫剧起始页可直达最近项目，画布返回时恢复侧栏', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases*', (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { id: 999, title: '新画布' } })
    return route.fulfill({
      json: {
        items: [
          { id: 701, title: '最近项目 A', updated_at: '2026-11-03T10:00:00Z' },
          { id: 702, title: '最近项目 B', updated_at: '2026-11-02T10:00:00Z' },
        ],
      },
    })
  })
  await page.route('**/api/v1/canvases/701**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/elements')
        ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
        : { id: 701, title: '最近项目 A', revision: 1 },
    }),
  )
  await page.route('**/api/v1/canvases/999**', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'PATCH'
          ? { sync_revision: 2 }
          : new URL(route.request().url()).pathname.endsWith('/elements')
            ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
            : { id: 999, title: '新画布', revision: 1 },
    }),
  )

  await page.goto('/canvas')
  const sidebarCanvas = page.locator('.app-sidebar').getByRole('button', { name: '无限画布', exact: true })
  await expect(sidebarCanvas).toBeVisible()
  await expect(page.getByRole('region', { name: '开始创作' })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开画布 最近项目 A', exact: true })).toBeVisible()
  const actions = page.locator('[class*="actions"]')
  const recentHeader = page.getByRole('heading', { name: '最近的项目' })
  const actionsBounds = await actions.boundingBox()
  const recentHeaderBounds = await recentHeader.boundingBox()
  expect(Math.round(recentHeaderBounds!.y - (actionsBounds!.y + actionsBounds!.height))).toBe(100)
  await expect(page.getByRole('region', { name: '开始创作' }).locator('[class*="icon"]').first()).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  )
  await page.getByRole('button', { name: '画布操作 最近项目 A' }).click()
  await page.getByRole('button', { name: '重命名', exact: true }).click()
  const quickRenameDialog = page.getByRole('dialog', { name: '重命名画布' })
  await expect(quickRenameDialog.getByRole('button', { name: '取消' })).toHaveCSS('border-top-width', '1px')
  await expect(quickRenameDialog.getByRole('button', { name: '保存' })).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  )
  await expect(quickRenameDialog).toBeVisible()
  const quickRenameMask = quickRenameDialog.locator('xpath=..')
  const quickMaskBounds = await quickRenameMask.boundingBox()
  const viewport = page.viewportSize()!
  expect(quickMaskBounds!.x).toBe(0)
  expect(quickMaskBounds!.y).toBe(0)
  expect(quickMaskBounds!.width).toBe(viewport.width)
  expect(quickMaskBounds!.height).toBe(viewport.height)
  await page.screenshot({ path: testInfo.outputPath('canvas-start-rename-overlay.png') })
  await quickRenameDialog.getByRole('button', { name: '取消' }).click()
  await page.screenshot({ path: testInfo.outputPath('canvas-workspace-start.png') })
  await page.getByRole('button', { name: '打开画布 最近项目 A', exact: true }).click()
  await expect(page).toHaveURL(/\/canvas\/701$/)
  await expect(page.locator('.canvas-view')).toBeVisible()
  await expect(page.locator('.app-sidebar')).toHaveCount(0)
  await page.getByRole('button', { name: '返回无限画布' }).click()
  await expect(page).toHaveURL(/\/canvas$/)
  await expect(sidebarCanvas).toBeVisible()

  await page.getByRole('region', { name: '开始创作' }).getByRole('button', { name: '创建脚本' }).click()
  const dialog = page.getByRole('dialog', { name: '创建新画布' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('请输入画布名称').fill('脚本工作流')
  await dialog.getByRole('button', { name: '创建画布' }).click()
  await expect(page).toHaveURL(/\/canvas\/999$/)
  await expect(page.locator('.app-sidebar')).toHaveCount(0)
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('canvas-workspace-editor.png') })
  await page.getByRole('button', { name: '返回无限画布' }).click()
  await expect(sidebarCanvas).toBeVisible()
  expectNoUnexpectedApi(api)
})

test('最近项目卡片支持重命名且仅本人可删除', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  let deletedId = 0
  await page.route('**/api/v1/canvases?*', (route) =>
    route.fulfill({
      json: {
        items: [
          { id: 701, title: '我的画布', user_id: 7, updated_at: '2026-11-03T10:00:00Z' },
          { id: 702, title: '同事的画布', user_id: 8, updated_at: '2026-11-02T10:00:00Z' },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/*/elements?*', (route) =>
    route.fulfill({ json: { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false } }),
  )
  await page.route('**/api/v1/canvases/701?*', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { id: 701, title: '更新后的画布' } })
    if (route.request().method() === 'DELETE') {
      deletedId = 701
      return route.fulfill({ json: { success: true } })
    }
    return route.fulfill({ json: { id: 701, title: '我的画布' } })
  })
  await page.goto('/canvas')
  await page.getByRole('button', { name: '画布操作 我的画布' }).click()
  await page.getByRole('button', { name: '重命名', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '重命名画布' })
  await dialog.getByLabel('画布名称').fill('更新后的画布')
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('button', { name: '打开画布 更新后的画布' })).toBeVisible()
  await page.getByRole('button', { name: '画布操作 同事的画布' }).click()
  await expect(page.getByText('仅创建者可重命名或删除此画布')).toBeVisible()
  await expect(page.getByRole('button', { name: '重命名', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '删除画布', exact: true })).toHaveCount(0)
  const more = page.getByRole('button', { name: '画布操作 同事的画布' })
  const alignment = await more.evaluate((button) => {
    const outer = button.getBoundingClientRect()
    const icon = button.querySelector('svg')!.getBoundingClientRect()
    return {
      x: icon.x + icon.width / 2 - (outer.x + outer.width / 2),
      y: icon.y + icon.height / 2 - (outer.y + outer.height / 2),
    }
  })
  expect(Math.abs(alignment.x)).toBeLessThan(1)
  expect(Math.abs(alignment.y)).toBeLessThan(1)
  await page.screenshot({ path: 'test-results/canvas-recent-permission.png' })
  await page.getByRole('button', { name: '画布操作 更新后的画布' }).click()
  await page.getByRole('button', { name: '删除画布', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click()
  await expect.poll(() => deletedId).toBe(701)
  await expect(page.getByRole('button', { name: '打开画布 更新后的画布' })).toHaveCount(0)
  expectNoUnexpectedApi(api)
})

test('矮屏漫剧起始页可滚动查看全部最近项目', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.setViewportSize({ width: 390, height: 640 })
  await page.route('**/api/v1/canvases?*', (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 8 }, (_, index) => ({
          id: 801 + index,
          title: `矮屏项目 ${index + 1}`,
          updated_at: new Date(Date.now() - index * 1000).toISOString(),
        })),
      },
    }),
  )
  await page.route('**/api/v1/canvases/*/elements?*', (route) =>
    route.fulfill({ json: { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false } }),
  )
  await page.goto('/canvas')
  await expect(page.getByRole('heading', { name: '开启你的漫剧创作' })).toBeVisible()
  const main = page.getByRole('main', { name: '无限画布创作入口' })
  const lastCard = page.getByRole('button', { name: '打开画布 矮屏项目 8', exact: true })
  await expect(lastCard).toBeVisible()
  await lastCard.scrollIntoViewIfNeeded()
  expect(await main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  const [mainBounds, cardBounds] = await Promise.all([main.boundingBox(), lastCard.boundingBox()])
  expect(cardBounds!.y).toBeGreaterThanOrEqual(mainBounds!.y)
  expect(cardBounds!.y + cardBounds!.height).toBeLessThanOrEqual(mainBounds!.y + mainBounds!.height)
  expectNoUnexpectedApi(api)
})

test('新画布入口打开命名弹窗并承接创建意图', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  const persistedElements = new Map<string, Record<string, unknown>>()
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases?**', (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { id: 999, title: '命名后的新项目' } })
    return route.fulfill({
      json: {
        items: [
          { id: 999, title: '命名后的新项目', updated_at: new Date().toISOString() },
          ...Array.from({ length: 12 }, (_, index) => ({
            id: 900 + index,
            title: `最近项目 ${index + 1}`,
            updated_at: new Date(Date.now() - (index + 1) * 1000).toISOString(),
          })),
        ],
      },
    })
  })
  await page.route('**/api/v1/canvases/*/elements*', (route) => {
    if (route.request().method() === 'PATCH') {
      const mutations = route.request().postDataJSON()?.mutations || []
      for (const mutation of mutations) {
        if (mutation.op === 'delete') persistedElements.delete(String(mutation.element_id))
        else persistedElements.set(String(mutation.element_id), mutation)
      }
      return route.fulfill({ json: { sync_revision: 2 } })
    }
    return route.fulfill({
      json: {
        elements: [...persistedElements.values()],
        sync_revision: persistedElements.size ? 2 : 1,
        history_floor_revision: 0,
        has_more: false,
      },
    })
  })
  await page.route('**/api/v1/canvases/999**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/elements')) {
      if (route.request().method() === 'PATCH') {
        for (const mutation of route.request().postDataJSON()?.mutations || []) {
          if (mutation.op === 'delete') persistedElements.delete(String(mutation.element_id))
          else persistedElements.set(String(mutation.element_id), mutation)
        }
        return route.fulfill({ json: { sync_revision: 2 } })
      }
      return route.fulfill({
        json: {
          elements: [...persistedElements.values()],
          sync_revision: persistedElements.size ? 2 : 1,
          history_floor_revision: 0,
          has_more: false,
        },
      })
    }
    return route.fulfill({ json: { id: 999, title: '命名后的新项目', revision: 1 } })
  })
  await page.goto('/canvas')
  const studio = page.getByRole('region', { name: '开始创作' })
  await expect(studio.getByRole('button', { name: '创建脚本' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看更多' })).toBeVisible()
  await studio.getByRole('button', { name: '创建脚本' }).click()
  const dialog = page.getByRole('dialog', { name: '创建新画布' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByPlaceholder('请输入画布名称')).toBeFocused()
  await dialog.getByPlaceholder('请输入画布名称').fill('脚本项目验收')
  await dialog.getByRole('button', { name: '创建画布' }).click()
  await expect(page).toHaveURL(/\/canvas\/999$/)
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '剧本创作' })).toBeVisible()
  await expect(page.getByText('已保存到云端')).toBeVisible()
  await expect.poll(() => persistedElements.size).toBeGreaterThan(0)
  expectNoUnexpectedApi(api)
})

test('新建项目首个节点返回后重开仍然存在', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  const persistedElements = new Map<string, Record<string, unknown>>()
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases?**', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ json: { id: 999, title: '命名后的新项目' } })
      : route.fulfill({ json: { items: [{ id: 999, title: '命名后的新项目' }] } }),
  )
  await page.route('**/api/v1/canvases/999**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/elements')) {
      if (route.request().method() === 'PATCH') {
        for (const mutation of route.request().postDataJSON()?.mutations || []) {
          if (mutation.op === 'delete') persistedElements.delete(String(mutation.element_id))
          else persistedElements.set(String(mutation.element_id), mutation)
        }
        return route.fulfill({ json: { sync_revision: 2 } })
      }
      return route.fulfill({
        json: {
          elements: [...persistedElements.values()],
          sync_revision: persistedElements.size ? 2 : 1,
          history_floor_revision: 0,
          has_more: false,
        },
      })
    }
    return route.fulfill({ json: { id: 999, title: '命名后的新项目', revision: 1 } })
  })

  await page.goto('/canvas')
  await page.getByRole('region', { name: '开始创作' }).getByRole('button', { name: '创建脚本' }).click()
  const dialog = page.getByRole('dialog', { name: '创建新画布' })
  await dialog.getByPlaceholder('请输入画布名称').fill('脚本项目验收')
  await dialog.getByRole('button', { name: '创建画布' }).click()
  await expect(page).toHaveURL(/\/canvas\/999$/)
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '剧本创作' })).toBeVisible()
  await expect.poll(() => persistedElements.size).toBeGreaterThan(0)
  await page.getByRole('button', { name: '返回无限画布' }).click()
  await page.getByRole('button', { name: '打开画布 命名后的新项目' }).click()
  await expect(page).toHaveURL(/\/canvas\/999$/)
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '剧本创作' })).toBeVisible()
  expectNoUnexpectedApi(api)
})

test('宽屏两张有封面的画布保持缩略卡片尺寸', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 2160, height: 1200 })
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases?**', (route) =>
    route.fulfill({
      json: {
        items: [
          { id: 701, title: '空间光影' },
          { id: 702, title: '人物视觉' },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/*/elements?**', (route) =>
    route.fulfill({
      json: {
        elements: [
          {
            element_id: 'cover',
            kind: 'node',
            op: 'upsert',
            payload: { type: 'image', data: { kind: 'image', assetId: 981 } },
          },
        ],
        has_more: false,
        sync_revision: 1,
      },
    }),
  )
  await page.route('**/api/v1/assets/981/download?**', (route) =>
    route.fulfill({ path: 'src/assets/login-hero.webp', contentType: 'image/webp' }),
  )
  await page.goto('/canvas?manage=1')
  const cards = page.locator('[data-canvas-id]')
  await expect(cards).toHaveCount(2)
  await expect(page.locator('.cl-cover-media')).toHaveCount(2)
  for (const image of await page.locator('.cl-cover-media').all()) {
    await expect(image).toHaveJSProperty('complete', true)
    expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  }
  for (const card of await cards.all()) {
    const bounds = await card.boundingBox()
    expect(bounds!.width).toBeLessThanOrEqual(380)
    expect(bounds!.height).toBeLessThan(310)
  }
  await page.screenshot({ path: testInfo.outputPath('canvas-two-covers.png'), fullPage: true })
  expectNoUnexpectedApi(api)
})
