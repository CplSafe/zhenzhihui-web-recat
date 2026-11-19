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

  const initial = pauseResponse()
  const failure = pauseResponse()
  const recovery = pauseResponse()
  let agentLocked = false
  let selectionRequests = 0
  let revision = 1
  const originalPrompt = '等待权限时仍然显示原提示词'
  const editedPrompt = '恢复后继续编辑的提示词'
  let savedPrompt = originalPrompt
  const granted = { granted: true, nodes: { video: [{ user_id: 7, name: 'E2E 用户', editing: true }] } }
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/canvases/239**', async (route) => {
    const { pathname, searchParams } = new URL(route.request().url())
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
      if (!nodes.includes('video')) return route.fulfill({ json: { granted: true, nodes: {} } })
      const request = ++selectionRequests
      if (request === 1) await initial.done
      if (request === 2) {
        await failure.done
        return route.fulfill({ status: 503, json: { message: '暂时无法获取许可' } })
      }
      if (request === 3) await recovery.done
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

  await page.goto('/canvas/239')
  const node = page.locator('.react-flow__node[data-id="video"]')
  await node.locator('.canvas-node-body').click()
  const panel = page.locator('[data-canvas-node-panel]')
  const editContent = page.locator('.canvas-panel-edit-content')
  const prompt = panel.getByPlaceholder(/描述你想要生成/)
  const pending = page.getByText('正在确认编辑权限，请稍候', { exact: true })
  await expect.poll(() => selectionRequests).toBe(1)
  await expect(pending).toBeVisible()
  await expect(editContent).toHaveAttribute('inert', '')
  await expect(prompt).toBeVisible()
  await expect(prompt).toHaveAttribute('data-value', originalPrompt)
  // The browser itself must reject focus while reading the still-visible panel.
  await prompt.evaluate((element) => (element as HTMLElement).focus())
  await expect(prompt).not.toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('video-node-lock-pending.png') })

  initial.release()
  await expect(pending).toHaveCount(0)
  await expect(editContent).not.toHaveAttribute('inert')
  await prompt.click()
  await expect(prompt).toBeFocused()
  await prompt.fill(editedPrompt)
  await expect.poll(() => savedPrompt).toBe(editedPrompt)

  await expect.poll(() => selectionRequests).toBe(2)
  failure.release()
  await expect(pending).toBeVisible()
  await expect(editContent).toHaveAttribute('inert', '')
  await expect(prompt).toBeVisible()
  await expect(prompt).toHaveAttribute('data-value', editedPrompt)
  await page.screenshot({ path: testInfo.outputPath('video-node-lock-transient-error.png') })

  await expect.poll(() => selectionRequests).toBe(3)
  recovery.release()
  await expect(pending).toHaveCount(0)
  await expect(editContent).not.toHaveAttribute('inert')
  await prompt.click()
  await prompt.press('End')
  await prompt.pressSequentially('。')
  await expect.poll(() => savedPrompt).toBe(`${editedPrompt}。`)
  await page.screenshot({ path: testInfo.outputPath('video-node-lock-recovered.png') })

  await panel.getByTitle('放大输入框').click()
  const expandedPrompt = page.getByRole('dialog', { name: '编辑提示词' })
  await expect(expandedPrompt.getByPlaceholder(/描述你想要生成/)).toHaveAttribute('data-value', `${editedPrompt}。`)
  agentLocked = true
  const readOnly = page.getByText('创作成员 已锁定画布 · 当前只读，可平移、缩放查看', { exact: true })
  await expect(readOnly).toBeVisible()
  await expect(expandedPrompt).toBeHidden()
  await expect(panel).toBeHidden()
  await node.locator('.canvas-node-body').click()
  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: '管理员解锁' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('video-agent-lock-readonly.png') })

  agentLocked = false
  await expect(readOnly).toBeHidden()
  await node.locator('.canvas-node-body').click()
  await expect(editContent).not.toHaveAttribute('inert')
  await expect(prompt).toHaveAttribute('data-value', `${editedPrompt}。`)
  await prompt.click()
  await expect(prompt).toBeFocused()
  expect(errors).toEqual([])
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
