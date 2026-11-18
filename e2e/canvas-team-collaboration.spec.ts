import { expect, test, type Page, type Route } from '@playwright/test'
import { installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

test('两位成员同时修改同一文本，后提交者可以选择云端版本并继续协作', async ({ page, browser, baseURL }) => {
  const colleague = await browser.newPage({ baseURL })
  const initial = {
    element_id: 'shared',
    kind: 'node',
    deleted: false,
    payload: { type: 'text', position: { x: 100, y: 100 }, data: { kind: 'text', text: '共同草稿' } },
  }
  let element = initial
  let revision = 1
  let winner = 0
  const writes = new Set<number>()
  let bothWriting!: () => void
  const concurrent = new Promise<void>((resolve) => {
    bothWriting = resolve
  })
  const streams = new Set<Route>()
  const sessions = [page, colleague]
  const edit = async (current: Page, text: string) => {
    const node = current.locator('.react-flow__node[data-id="shared"]')
    await node.locator('.canvas-node-body').dblclick()
    await node.locator('textarea').fill(text)
    await node.locator('textarea').blur()
  }
  try {
    await Promise.all(
      sessions.map(async (session, index) => {
        const userId = index + 7
        await installStrictAuthenticatedApp(session)
        await session.route('**/api/v1/me', (route) =>
          route.fulfill({ json: { data: { user: { id: userId, nickname: `成员${userId}` } } } }),
        )
        await session.route('**/api/v1/workspaces/*/members', (route) =>
          route.fulfill({
            json: {
              data: [7, 8].map((id) => ({
                workspace_id: WORKSPACE_ID,
                user_id: id,
                role: id === 7 ? 'owner' : 'member',
              })),
            },
          }),
        )
        await session.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
        await session.route('**/api/v1/canvases/551**', async (route) => {
          const url = new URL(route.request().url())
          if (url.pathname.endsWith('/events')) {
            streams.add(route)
            return
          }
          if (!url.pathname.endsWith('/elements')) return route.fulfill({ json: { id: 551, title: '团队画布' } })
          if (route.request().method() === 'PATCH') {
            const body = route.request().postDataJSON()
            writes.add(userId)
            if (writes.size === 2) bothWriting()
            await concurrent
            if (body.base_revision !== revision)
              return route.fulfill({
                status: 409,
                json: { code_string: 'CANVAS_REVISION_CONFLICT', message: '版本冲突' },
              })
            if (!winner) winner = userId
            element = { ...initial, payload: body.mutations[0].payload }
            revision++
            for (const stream of streams) {
              streams.delete(stream)
              await stream.fulfill({
                contentType: 'text/event-stream',
                body: `event: canvas.revision\ndata: {"revision":${revision}}\n\n`,
              })
            }
            return route.fulfill({ json: { revision } })
          }
          return route.fulfill({
            json: {
              items: Number(url.searchParams.get('after_revision')) < revision ? [element] : [],
              sync_revision: revision,
              has_more: false,
            },
          })
        })
        await session.goto('/canvas/551')
        await expect(session.getByText('共同草稿', { exact: true })).toBeVisible()
      }),
    )
    await expect.poll(() => streams.size).toBe(2)
    await Promise.all(sessions.map((session, index) => edit(session, `成员${index + 7}的版本`)))
    await expect.poll(() => winner).not.toBe(0)
    const losingSession = winner === 7 ? colleague : page
    const dialog = losingSession.getByRole('alertdialog', { name: '处理画布编辑冲突' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '使用云端版本' }).click()
    await expect(losingSession.locator('.canvas-node-body')).toContainText(`成员${winner}的版本`)
    expect(revision).toBe(2)
    await edit(losingSession, '双方确认后的定稿')
    await expect((winner === 7 ? page : colleague).locator('.canvas-node-body')).toContainText('双方确认后的定稿')
    expect(element.payload.data.text).toBe('双方确认后的定稿')
  } finally {
    bothWriting()
    for (const stream of streams) await stream.fulfill({ status: 204 }).catch(() => {})
    await colleague.close()
  }
})
