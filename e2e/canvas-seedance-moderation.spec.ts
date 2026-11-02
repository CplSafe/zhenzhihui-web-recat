import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const mediaType of ['image', 'video'] as const) {
  for (const outcome of ['approved', 'rejected', 'non-active', 'network-error', 'already-pending'] as const) {
    test(`${mediaType} inline moderation: ${outcome}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: outcome === 'already-pending' ? 900 : 1440, height: 1000 })
      const api = await installStrictAuthenticatedApp(page)
      let submitted = false
      let releaseInitialQuery!: () => void
      const initialQuery = new Promise<void>((resolve) => {
        releaseInitialQuery = resolve
      })
      let releaseResult = false
      let failed = false
      let queryCount = 0
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const calls: string[] = []
      const savedNodes: Array<{ element_id: string; payload?: { data?: Record<string, unknown> } }> = []
      await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
      await page.route('**/api/v1/assets/501/seedance-moderation**', async (route) => {
        calls.push(
          `${route.request().method()} ${new URL(route.request().url()).pathname}${new URL(route.request().url()).search}`,
        )
        if (route.request().method() === 'POST') {
          expect(route.request().postDataJSON()).toEqual({ workspace_id: WORKSPACE_ID })
          submitted = true
          await route.fulfill({ json: { data: { status: 'pending' } } })
          return
        }
        queryCount++
        if (queryCount === 1) await initialQuery
        if (outcome === 'already-pending' || submitted) {
          if (!releaseResult) {
            await route.fulfill({ json: { data: { status: 'pending' } } })
          } else if (outcome === 'network-error' && !failed) {
            failed = true
            await route.fulfill({ status: 503, json: { message: '审核查询暂时不可用' } })
          } else {
            await route.fulfill({
              json: {
                data: {
                  status: outcome === 'rejected' ? 'rejected' : outcome === 'non-active' ? 'approved' : 'active',
                  reason: outcome === 'rejected' ? '测试素材未通过审核' : '',
                },
              },
            })
          }
          return
        }
        if (!submitted) {
          await route.fulfill({ status: 404, json: { message: '尚未提交审核' } })
          return
        }
      })
      await page.route('**/api/v1/canvases/126**', (route) => {
        if (route.request().method() === 'PATCH') {
          savedNodes.push(...(route.request().postDataJSON().mutations || []))
        }
        return route.fulfill({
          json:
            route.request().method() === 'PATCH'
              ? { revision: 2, sync_revision: 2 }
              : new URL(route.request().url()).pathname.endsWith('/elements')
                ? {
                    elements: [
                      {
                        element_id: mediaType,
                        kind: 'node',
                        op: 'upsert',
                        payload: {
                          id: mediaType,
                          type: mediaType,
                          position: { x: 240, y: 150 },
                          style: { width: 320, height: 280 },
                          data: { kind: mediaType, title: '审核素材', assetId: 501, assetWorkspaceId: WORKSPACE_ID },
                        },
                      },
                    ],
                    sync_revision: 1,
                    history_floor_revision: 0,
                    has_more: false,
                  }
                : { id: 126, title: 'Seedance 素材审核', revision: 1 },
        })
      })
      await page.route(`**/api/v1/assets/501/download?workspace_id=${WORKSPACE_ID}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="280"><rect width="320" height="280" fill="#ebfffb"/></svg>',
        }),
      )

      await page.goto('/canvas/126')
      const node = page.locator(`.react-flow__node[data-id="${mediaType}"]`)
      await expect(node).toBeVisible()
      await page.getByRole('combobox', { name: '画布缩放', exact: true }).selectOption('100')
      await node.click()
      const panel = page.locator('[data-canvas-node-panel]')
      const label = `Seedance ${mediaType === 'video' ? '视频' : '图片'}审核`
      const moderationButton = panel.getByRole('button', { name: label })
      await expect(moderationButton).toBeVisible()
      await expect(page.getByRole('toolbar', { name: '节点操作' }).getByRole('button', { name: label })).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath('moderation-button-in-panel.png') })
      await moderationButton.click()
      const pending = node.getByRole('status', { name: '审核中', exact: true })
      await expect(pending).toBeVisible()
      await expect(pending.getByText('审核中', { exact: true })).toBeVisible()
      await expect(pending.locator('.canvas-node-generation-spinner')).toHaveCSS(
        'animation-name',
        'canvas-node-generation-spin',
      )
      await expect(page.getByRole('dialog', { name: label })).toHaveCount(0)
      await moderationButton.click()
      expect(queryCount).toBe(1)
      releaseInitialQuery()
      await expect.poll(() => queryCount).toBeGreaterThanOrEqual(2)
      await page.screenshot({ path: testInfo.outputPath('moderation-pending.png') })
      releaseResult = true
      if (outcome === 'network-error') {
        await expect(node.getByLabel('审核状态待确认', { exact: true })).toBeVisible({ timeout: 10_000 })
        await expect(pending).toHaveCount(0)
        await moderationButton.click()
        await expect(node.getByLabel('合规校验成功', { exact: true })).toBeVisible({ timeout: 10_000 })
      } else {
        await expect(
          node.getByLabel(outcome === 'rejected' || outcome === 'non-active' ? '审核未通过' : '合规校验成功', {
            exact: true,
          }),
        ).toBeVisible({ timeout: 10_000 })
      }
      await expect(pending).toHaveCount(0)
      await expect(page.getByRole('dialog', { name: label })).toHaveCount(0)
      const finalState = outcome === 'rejected' || outcome === 'non-active' ? 'rejected' : 'approved'
      const mediaLabel = mediaType === 'video' ? '视频' : '图片'
      await expect(
        page.getByText(finalState === 'approved' ? `${mediaLabel}认证通过` : new RegExp(`${mediaLabel}认证失败`), {
          exact: finalState === 'approved',
        }),
      ).toBeVisible()
      await expect
        .poll(() =>
          savedNodes.some((mutation) => {
            const data = mutation.payload?.data as Record<string, unknown> | undefined
            return (
              mutation.element_id === mediaType &&
              data?.seedanceModerationStatus === finalState &&
              data?.assetId === 501 &&
              data?.assetWorkspaceId === WORKSPACE_ID
            )
          }),
        )
        .toBe(true)
      expect(calls.filter((call) => call === `POST /api/v1/assets/501/seedance-moderation`)).toHaveLength(
        outcome === 'already-pending' ? 0 : 1,
      )
      expect(
        calls.some((call) => call === `GET /api/v1/assets/501/seedance-moderation?workspace_id=${WORKSPACE_ID}`),
      ).toBe(true)
      await page.screenshot({ path: testInfo.outputPath('moderation-result.png') })
      expect(errors).toEqual([])
      expect(api.paidTaskSubmissions).toBe(0)
      expectNoUnexpectedApi(api)
    })
  }
}
