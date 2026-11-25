import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

function pauseResponse() {
  let release!: () => void
  const done = new Promise<void>((resolve) => {
    release = resolve
  })
  return { done, release }
}

test('视频节点等候编辑许可或暂时断线时保留面板，恢复后继续编辑', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  const idle = pauseResponse()
  let delayIdle = true
  const initial = pauseResponse()
  const failure = pauseResponse()
  const recovery = pauseResponse()
  let memberLocked = false
  let agentLocked = false
  let selectionRequests = 0
  let revision = 1
  const originalPrompt = '等待权限时仍然显示原提示词'
  const editedPrompt = '恢复后继续编辑的提示词'
  let savedPrompt = originalPrompt
  const onlineMembers = [
    { user_id: 7, name: 'E2E 用户' },
    { user_id: 8, name: '同时打开画布的成员' },
  ]
  const granted = {
    granted: true,
    nodes: { video: [{ user_id: 7, name: 'E2E 用户', editing: true }] },
    online_members: onlineMembers,
  }
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/239**', async (route) => {
    const { pathname, searchParams } = new URL(route.request().url())
    if (pathname.endsWith('/members'))
      return route.fulfill({ json: { can_manage: true, creator_id: 7, member_user_ids: [7, 8] } })
    if (pathname.endsWith('/events')) return route.fulfill({ status: 204 })
    if (pathname.endsWith('/node-locks')) {
      const { nodes } = route.request().postDataJSON() as { nodes: string[] }
      if (agentLocked)
        return route.fulfill({
          json: {
            granted: false,
            nodes: {},
            agent_owner: '创作成员',
            agent_lock: { id: 'agent-lock', owner_id: 8, owner: '创作成员', running: true, can_unlock: false },
          },
        })
      if (!nodes.includes('video')) {
        if (delayIdle) {
          delayIdle = false
          await idle.done
        }
        return route.fulfill({ json: { granted: true, nodes: {} } })
      }
      if (memberLocked) {
        return route.fulfill({
          json: { granted: false, nodes: { video: [{ user_id: 8, name: '协作者', editing: true }] } },
        })
      }
      const request = ++selectionRequests
      if (request === 2) await initial.done
      if (request === 3) {
        await failure.done
        return route.fulfill({ status: 503, json: { message: '暂时无法获取许可' } })
      }
      if (request === 4) await recovery.done
      return route.fulfill({ json: granted })
    }
    if (route.request().method() === 'PATCH') {
      const { mutations } = route.request().postDataJSON() as {
        mutations?: { element_id: string; payload?: { data?: { prompt?: string } } }[]
      }
      const prompt = mutations?.find((mutation) => mutation.element_id === 'video')?.payload?.data?.prompt
      if (typeof prompt === 'string') savedPrompt = prompt
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    return route.fulfill({
      json: pathname.endsWith('/elements')
        ? {
            elements:
              Number(searchParams.get('after_revision')) > 0
                ? []
                : [
                    {
                      element_id: 'video',
                      kind: 'node',
                      op: 'upsert',
                      payload: {
                        id: 'video',
                        type: 'video',
                        position: { x: 460, y: 135 },
                        style: { width: 320, height: 180 },
                        data: { kind: 'video', prompt: originalPrompt },
                      },
                    },
                  ],
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 239, title: '编辑许可回归', status: 'active', revision },
    })
  })

  const locksWithSelection = (request: { method(): string; url(): string; postDataJSON(): unknown }, ids: string[]) =>
    request.method() === 'POST' &&
    new URL(request.url()).pathname === '/api/v1/canvases/239/node-locks' &&
    JSON.stringify((request.postDataJSON() as { nodes: string[] }).nodes) === JSON.stringify(ids)
  const initialSync = page.waitForRequest((request) => locksWithSelection(request, []))
  await page.goto('/canvas/239')
  await initialSync
  const node = page.locator('.react-flow__node[data-id="video"]')
  const nodeBody = node.locator('.canvas-node-body')
  const panel = page.locator('[data-canvas-node-panel]')
  const editContent = page.locator('.canvas-panel-edit-content')
  const prompt = panel.getByPlaceholder(/描述你想要生成/)
  const status = page.locator('.canvas-panel-lock-status[role="status"]')
  const visibleStatus = status.locator('span')
  const pending = '正在确认编辑权限'
  const retrying = '暂时无法确认，正在重试'
  const trackVisibleStatus = await page.evaluateHandle(() => {
    let appeared = false
    const observer = new MutationObserver(() => {
      const status = document.querySelector('.canvas-panel-lock-status[role="status"]')
      if (
        status?.textContent?.trim() &&
        status.getClientRects().length &&
        getComputedStyle(status).visibility === 'visible'
      ) {
        appeared = true
      }
    })
    observer.observe(document.querySelector('.canvas-view')!, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })
    return () => {
      observer.disconnect()
      return appeared
    }
  })
  await nodeBody.click()
  try {
    await expect.poll(() => selectionRequests, { timeout: 2000 }).toBe(1)
  } finally {
    idle.release()
  }
  await expect(prompt).toBeVisible()
  await expect(editContent).not.toHaveAttribute('inert')
  await expect(visibleStatus).toBeHidden()
  expect(await trackVisibleStatus.evaluate((stopWatching) => stopWatching())).toBe(false)
  await trackVisibleStatus.dispose()

  const releaseSelection = page.waitForResponse((response) => locksWithSelection(response.request(), []))
  await page.locator('.react-flow__pane').click({ position: { x: 140, y: 160 } })
  await releaseSelection
  await expect(panel).toBeHidden()
  await nodeBody.click()
  await expect.poll(() => selectionRequests).toBe(2)
  await expect(visibleStatus).toBeVisible()
  await expect(status).toHaveText(pending)
  await expect(editContent).toHaveAttribute('inert', '')
  await expect(prompt).toBeVisible()
  await expect(prompt).toHaveAttribute('data-value', originalPrompt)
  // The browser itself must reject focus while reading the still-visible panel.
  await prompt.evaluate((element) => (element as HTMLElement).focus())
  await expect(prompt).not.toBeFocused()
  const pendingBounds = await panel.boundingBox()
  await page.screenshot({ path: testInfo.outputPath('video-node-lock-pending.png') })

  initial.release()
  await expect(visibleStatus).toBeHidden()
  await expect(editContent).not.toHaveAttribute('inert')
  await expect.poll(() => panel.boundingBox()).toEqual(pendingBounds)
  await prompt.click()
  await expect(prompt).toBeFocused()
  await prompt.fill(editedPrompt)
  await expect.poll(() => savedPrompt).toBe(editedPrompt)

  const editingBounds = await panel.boundingBox()
  await expect.poll(() => selectionRequests).toBe(3)
  failure.release()
  await expect(visibleStatus).toBeVisible()
  await expect(status).toHaveText(retrying)
  await expect(editContent).toHaveAttribute('inert', '')
  await expect(node).not.toHaveAttribute('data-editor-label', '你正在编辑')
  await expect(prompt).toBeVisible()
  await expect(prompt).toHaveAttribute('data-value', editedPrompt)
  await expect.poll(() => panel.boundingBox()).toEqual(editingBounds)
  await page.screenshot({ path: testInfo.outputPath('video-node-lock-transient-error.png') })

  await expect.poll(() => selectionRequests).toBe(4)
  await expect(status).toHaveText(retrying)
  await expect(editContent).toHaveAttribute('inert', '')
  recovery.release()
  await expect(visibleStatus).toBeHidden()
  await expect(editContent).not.toHaveAttribute('inert')
  await expect.poll(() => panel.boundingBox()).toEqual(editingBounds)
  await prompt.click()
  await prompt.press('End')
  await prompt.pressSequentially('。')
  await expect.poll(() => savedPrompt).toBe(`${editedPrompt}。`)
  await page.screenshot({ path: testInfo.outputPath('video-node-lock-recovered.png') })
  const online = page.getByRole('button', { name: '2 人在线' })
  await online.click()
  const roster = page.getByRole('region', { name: '当前在线' })
  await expect(roster.getByText('同时打开画布的成员')).toBeVisible()
  await expect(roster.getByText('我', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('canvas-online-roster.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileRoster = await roster.boundingBox()
  expect(mobileRoster?.x).toBeGreaterThanOrEqual(0)
  expect((mobileRoster?.x ?? 0) + (mobileRoster?.width ?? Infinity)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('canvas-online-roster-mobile.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await online.press('Escape')
  await expect(roster).toBeHidden()

  memberLocked = true
  await expect(editContent).toHaveAttribute('inert', '')
  await expect(node.getByText('协作者 正在编辑', { exact: true })).toBeVisible()
  await expect(visibleStatus).toBeVisible()
  await expect(status).toHaveText('协作者 正在编辑')
  await expect(prompt).toHaveAttribute('data-value', `${editedPrompt}。`)
  await page.screenshot({ path: testInfo.outputPath('video-node-lock-occupied.png') })
  memberLocked = false
  await expect(editContent).not.toHaveAttribute('inert')
  await expect(visibleStatus).toBeHidden()

  await panel.getByTitle('放大输入框').click()
  const expandedPrompt = page.getByRole('dialog', { name: '编辑提示词' })
  await expect(expandedPrompt.getByPlaceholder(/描述你想要生成/)).toHaveAttribute('data-value', `${editedPrompt}。`)
  agentLocked = true
  const readOnly = page.getByText('创作成员 已锁定画布 · 当前只读，可平移、缩放查看', { exact: true })
  await expect(readOnly).toBeVisible()
  await expect(expandedPrompt).toBeHidden()
  await expect(panel).toBeHidden()
  await nodeBody.click()
  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: '管理员解锁' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('video-agent-lock-readonly.png') })

  agentLocked = false
  await expect(readOnly).toBeHidden()
  await nodeBody.click()
  await expect(editContent).not.toHaveAttribute('inert')
  await expect(prompt).toHaveAttribute('data-value', `${editedPrompt}。`)
  await prompt.click()
  await expect(prompt).toBeFocused()
  expect(errors).toEqual([])
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
