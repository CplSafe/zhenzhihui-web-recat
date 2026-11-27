import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('项目管理按实际列数整行分页，并在缩放后保留当前画布', async ({ page }, testInfo) => {
  const sizes = [
    { width: 2320, columns: 6, pageSize: 12 },
    { width: 2000, columns: 5, pageSize: 10 },
    { width: 1680, columns: 4, pageSize: 12 },
    { width: 1420, columns: 3, pageSize: 9 },
    { width: 390, columns: 1, pageSize: 9 },
  ]
  await page.setViewportSize({ width: sizes[0].width, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  const projects = Array.from({ length: 25 }, (_, index) => ({
    id: 801 + index,
    title: `${index < 18 ? '追逐' : '城墙'}画布 ${String(index + 1).padStart(2, '0')}`,
    user_id: 7,
    updated_at: new Date(Date.UTC(2026, 10, 23, 10, 0, 59 - index)).toISOString(),
  }))
  await page.route('**/api/v1/canvases?*', (route) => {
    const query = new URL(route.request().url()).searchParams
    expect(Number(query.get('workspace_id'))).toBe(WORKSPACE_ID)
    const offset = Number(query.get('offset'))
    const limit = Number(query.get('limit'))
    return route.fulfill({ json: { items: projects.slice(offset, offset + limit) } })
  })

  await page.goto('/projects?flow=canvas')
  const main = page.getByRole('region', { name: '项目管理' })
  const cards = main.getByRole('button', { name: /^打开无限画布文件 / })
  const pager = main.locator('.pm2-pager--canvas')
  const range = pager.locator('.pm2-page-range')
  await expect(main.getByRole('tab', { name: '无限画布', exact: true })).toHaveAttribute('aria-selected', 'true')
  for (const { width, columns, pageSize } of sizes) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(range).toHaveText(`第 1–${pageSize} 项，共 25 项`)
    await expect(cards).toHaveCount(pageSize)
    await expect
      .poll(() =>
        cards.evaluateAll((items) => {
          const firstRowTop = items[0]?.getBoundingClientRect().top
          return items.filter((item) => Math.abs(item.getBoundingClientRect().top - firstRowTop) < 1).length
        }),
      )
      .toBe(columns)
    await expect(main.locator('.pm2-card-grid')).toHaveCSS('column-gap', '24px')
    expect(await main.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    if (width === 2320) {
      await page.screenshot({ path: testInfo.outputPath('project-canvases-six-columns.png') })
    }
  }

  await pager.getByTitle('2', { exact: true }).click()
  await expect(range).toHaveText('第 10–18 项，共 25 项')
  await expect(cards.first()).toHaveAttribute('aria-label', `打开无限画布文件 ${projects[9].title}`)
  await pager.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('project-canvases-narrow-page.png') })
  await cards.first().scrollIntoViewIfNeeded()
  await page.setViewportSize({ width: sizes[0].width, height: 1000 })
  await expect(range).toHaveText('第 1–12 项，共 25 项')
  await expect(main.getByRole('button', { name: `打开无限画布文件 ${projects[9].title}`, exact: true })).toBeVisible()

  await pager.getByTitle('2', { exact: true }).click()
  await expect(range).toHaveText('第 13–24 项，共 25 项')
  await main.getByTitle('按更新时间排序').click()
  await expect(range).toHaveText('第 1–12 项，共 25 项')
  await expect(cards.first()).toHaveAttribute('aria-label', `打开无限画布文件 ${projects[24].title}`)

  await pager.getByTitle('2', { exact: true }).click()
  await expect(range).toHaveText('第 13–24 项，共 25 项')
  const search = main.getByPlaceholder('搜索画布文件')
  await search.fill('追逐')
  await expect(range).toHaveText('第 1–12 项，共 18 项')
  await expect(cards).toHaveCount(12)
  await expect(cards.first()).toHaveAttribute('aria-label', `打开无限画布文件 ${projects[17].title}`)
  await search.clear()
  await expect(range).toHaveText('第 1–12 项，共 25 项')
  await pager.getByTitle('3', { exact: true }).click()
  await expect(range).toHaveText('第 25–25 项，共 25 项')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toHaveAttribute('aria-label', `打开无限画布文件 ${projects[0].title}`)
  await expect(pager.getByTitle('下一页', { exact: true })).toHaveAttribute('aria-disabled', 'true')
  expect(pageErrors).toEqual([])
  expectNoUnexpectedApi(api)
})

test('项目管理遇到后续画布列表失败时保留已有卡片并可重试', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 2320, height: 1000 })
  const api = await installStrictAuthenticatedApp(page)
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  const projects = Array.from({ length: 15 }, (_, index) => ({
    id: 901 + index,
    title: `分页加载画布 ${String(index + 1).padStart(2, '0')}`,
    user_id: 7,
    updated_at: new Date(Date.UTC(2026, 10, 23, 10, 0, 59 - index)).toISOString(),
  }))
  const rawFirstPage = [...projects.slice(0, 12), ...Array.from({ length: 88 }, () => ({ id: 0 }))]
  let nextPageAttempts = 0
  await page.route('**/api/v1/canvases?*', (route) => {
    const query = new URL(route.request().url()).searchParams
    expect(Number(query.get('workspace_id'))).toBe(WORKSPACE_ID)
    expect(Number(query.get('limit'))).toBe(100)
    const offset = Number(query.get('offset'))
    if (offset === 0) return route.fulfill({ json: { items: rawFirstPage } })
    expect(offset).toBe(100)
    nextPageAttempts++
    if (nextPageAttempts === 1) {
      return route.fulfill({ status: 503, json: { message: '模拟后续画布列表请求失败' } })
    }
    return route.fulfill({ json: { items: projects.slice(12) } })
  })

  await page.goto('/projects?flow=canvas')
  const main = page.getByRole('region', { name: '项目管理' })
  const cards = main.getByRole('button', { name: /^打开无限画布文件 / })
  const loadError = main.locator('.pm2-canvas-load-error[role="alert"]')
  const pager = main.locator('.pm2-pager--canvas')
  await expect(loadError).toContainText('部分无限画布文件加载失败，已加载的文件仍可查看')
  await expect(cards).toHaveCount(12)
  await expect(pager.locator('.pm2-page-range')).toHaveText('第 1–12 项，已匹配 12 项')
  await loadError.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('project-canvases-partial-load.png') })
  await loadError.getByRole('button', { name: '重试', exact: true }).click()
  await expect(loadError).toHaveCount(0)
  await expect(pager.locator('.pm2-page-range')).toHaveText('第 1–12 项，共 15 项')
  await pager.getByTitle('2', { exact: true }).click()
  await expect(pager.locator('.pm2-page-range')).toHaveText('第 13–15 项，共 15 项')
  await expect(cards).toHaveCount(3)
  await expect(cards.last()).toHaveAttribute('aria-label', `打开无限画布文件 ${projects[14].title}`)
  expect(nextPageAttempts).toBe(2)
  expect(pageErrors).toEqual([])
  expectNoUnexpectedApi(api)
})

test('项目管理的无限画布分类展示画布文件并可打开', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/ai/tools?*', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/canvases?*', (route) =>
    route.fulfill({
      json: {
        items: [
          { id: 701, title: '春日新品分镜', user_id: 7, updated_at: '2026-10-22T08:30:00Z' },
          { id: 702, title: '品牌短剧脚本', user_id: 8, status: 'archived' },
        ],
      },
    }),
  )
  await page.route('**/api/v1/canvases/*/elements?*', (route) =>
    route.fulfill({
      json: {
        elements: [
          {
            element_id: 'cover',
            kind: 'node',
            op: 'upsert',
            payload: { type: 'image', data: { kind: 'image', assetId: 881 } },
          },
        ],
        sync_revision: 1,
        history_floor_revision: 0,
        has_more: false,
      },
    }),
  )
  await page.route('**/api/v1/assets/881/download?*', (route) =>
    route.fulfill({ path: 'src/assets/login-hero.webp', contentType: 'image/webp' }),
  )
  await page.route('**/api/v1/canvases/701?*', (route) => {
    if (route.request().method() === 'DELETE') return route.fulfill({ json: { success: true } })
    if (route.request().method() === 'PATCH') {
      return route.fulfill({ json: { id: 701, title: '改名后的分镜', user_id: 7 } })
    }
    return route.fulfill({ json: { id: 701, title: '春日新品分镜', user_id: 7 } })
  })
  await page.route('**/api/v1/canvases/702/members?**', (route) => {
    expect(route.request().method()).toBe('GET')
    expect(new URL(route.request().url()).searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    return route.fulfill({
      json: { creator_id: 8, members_restricted: false, member_user_ids: [], can_manage: false },
    })
  })
  await page.route('**/api/v1/canvases/702/node-locks?**', (route) => {
    expect(route.request().method()).toBe('POST')
    expect(new URL(route.request().url()).searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
    expect(route.request().postDataJSON()).toMatchObject({
      session: expect.any(String),
      nodes: [],
      observe: true,
      heartbeat: true,
    })
    return route.fulfill({ json: { granted: true, nodes: {} } })
  })
  await page.routeWebSocket('**/api/v1/canvases/702/node-locks/socket?**', (socket) => {
    socket.onMessage(() => socket.send(JSON.stringify({ type: 'state', data: { granted: true, nodes: {} } })))
  })
  await page.goto('/projects')
  await page.getByRole('tab', { name: '无限画布', exact: true }).click()
  await expect(page.getByRole('button', { name: '打开无限画布文件 春日新品分镜' })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开无限画布文件 品牌短剧脚本' })).toBeVisible()
  const ownCard = page.getByRole('button', { name: '打开无限画布文件 春日新品分镜' })
  const cover = ownCard.locator('.pm2-pcard-cover-media')
  await expect(cover).toBeVisible()
  await expect(cover).toHaveJSProperty('complete', true)
  expect(await cover.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  await ownCard.getByRole('button', { name: '画布操作 春日新品分镜' }).click()
  await page.getByRole('button', { name: '重命名', exact: true }).click()
  const renameDialog = page.getByRole('dialog', { name: '重命名画布' })
  await renameDialog.getByLabel('画布名称').fill('改名后的分镜')
  await renameDialog.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('button', { name: '打开无限画布文件 改名后的分镜' })).toBeVisible()
  await page.getByRole('button', { name: '画布操作 改名后的分镜' }).click()
  await expect(page.getByRole('button', { name: '删除画布', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '画布操作 品牌短剧脚本' }).click()
  await expect(page.getByRole('button', { name: '删除画布', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('project-management-canvas-files.png') })
  await page.getByRole('button', { name: '打开无限画布文件 品牌短剧脚本' }).click()
  await expect(page).toHaveURL(/\/canvas\/702$/)
  await page.goto('/projects?flow=canvas')
  await expect(page.getByRole('tab', { name: '无限画布', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: '画布操作 春日新品分镜' }).click()
  await page.getByRole('button', { name: '删除画布', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click()
  await expect(page.getByRole('button', { name: '打开无限画布文件 春日新品分镜' })).toHaveCount(0)
  expectNoUnexpectedApi(api)
})

test('项目管理允许复制其他成员的画布', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  let created = 0
  let saved: unknown
  await page.route('**/api/v1/canvases?*', (route) => {
    if (route.request().method() === 'POST') {
      created++
      expect(route.request().postDataJSON()).toEqual({ title: '同事画布-副本' })
      return route.fulfill({ json: { id: 702, title: '同事画布-副本', user_id: 7 } })
    }
    return route.fulfill({ json: { items: [{ id: 701, title: '同事画布', user_id: 8 }] } })
  })
  await page.route('**/api/v1/canvases/*/elements?*', (route) => {
    if (route.request().method() === 'PATCH') {
      saved = route.request().postDataJSON()
      return route.fulfill({ json: { sync_revision: 2 } })
    }
    return route.fulfill({
      json: {
        elements: [
          {
            element_id: 'node-1',
            kind: 'node',
            op: 'upsert',
            payload: { type: 'text', data: { kind: 'text', text: '测试内容' } },
          },
        ],
        sync_revision: 1,
        has_more: false,
      },
    })
  })
  await page.goto('/projects?flow=canvas')
  await page.getByRole('button', { name: '画布操作 同事画布' }).click()
  await expect(page.getByRole('button', { name: '创建副本', exact: true })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('project-copy-menu.png') })
  await page.getByRole('button', { name: '创建副本', exact: true }).click()
  await expect(page.getByRole('button', { name: '打开无限画布文件 同事画布-副本' })).toBeVisible()
  expect(created).toBe(1)
  expect(saved).toMatchObject({ base_revision: 0, mutations: [{ element_id: 'node-1', kind: 'node', op: 'upsert' }] })
  await page.getByRole('button', { name: '画布操作 同事画布-副本' }).click()
  await expect(page.getByRole('button', { name: '重命名', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '删除画布', exact: true })).toBeVisible()
  expectNoUnexpectedApi(api)
})
