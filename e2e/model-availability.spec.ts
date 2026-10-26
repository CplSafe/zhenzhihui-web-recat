import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const scenario of [
  'expired-owner',
  'expired-member',
  'active-empty',
  'subscription-error',
  'configuration-error',
  'catalog-error',
  'never-purchased',
] as const) {
  test(`模型不可用原因与操作：${scenario}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: scenario === 'expired-member' ? 760 : 1440, height: 1000 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/v1/billing/credit-packages', (route) => route.fulfill({ json: [] }))
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    let recovered = false
    let catalogRequests = 0
    let subscriptionRequests = 0
    await page.route('**/api/v1/billing/subscription?**', (route) => {
      subscriptionRequests++
      return route.fulfill(
        scenario === 'subscription-error'
          ? { status: 503, json: { message: '订阅查询失败' } }
          : {
              json:
                scenario === 'never-purchased'
                  ? { active: false }
                  : {
                      plan_id: 10,
                      plan_name: '测试会员',
                      active: recovered || scenario === 'active-empty',
                      expires_at:
                        recovered || scenario === 'active-empty' ? '2099-01-01T00:00:00Z' : '2020-01-01T00:00:00Z',
                    },
            },
      )
    })
    if (scenario === 'expired-member') {
      const workspace = { id: WORKSPACE_ID, name: '测试团队', type: 'team', owner_user_id: 999 }
      await page.route('**/api/v1/auth/session', (route) =>
        route.fulfill({ json: { workspace, workspaces: [workspace], expires_in: 3600 } }),
      )
      await page.route('**/api/v1/workspaces', (route) => route.fulfill({ json: [workspace] }))
      await page.route('**/api/v1/workspaces/*/members', (route) =>
        route.fulfill({ json: [{ user_id: 7, workspace_id: WORKSPACE_ID, role: 'member' }] }),
      )
    }
    await page.route('**/api/v1/ai/models**', (route) => {
      catalogRequests++
      const operation = new URL(route.request().url()).searchParams.get('operation_code')
      if (scenario === 'catalog-error' && !recovered)
        return route.fulfill({ status: 400, json: { message: '模型目录请求失败，请重新加载' } })
      return route.fulfill({
        json: {
          data: recovered
            ? [{ id: 43, display_name: '恢复可用模型', operation_codes: [operation] }]
            : scenario === 'configuration-error'
              ? [{ id: 44, display_name: '配置异常模型', operation_codes: [operation], params_schema: '{invalid' }]
              : [],
        },
      })
    })
    await page.route('**/api/v1/canvases/126**', (route) =>
      route.fulfill({
        json:
          route.request().method() === 'PATCH'
            ? { revision: 2 }
            : new URL(route.request().url()).pathname.endsWith('/elements')
              ? {
                  elements: [
                    {
                      element_id: 'image',
                      kind: 'node',
                      payload: {
                        id: 'image',
                        type: 'image',
                        position: { x: 150, y: 100 },
                        style: { width: 240, height: 200 },
                        data: { kind: 'image', title: '测试图片', prompt: '测试提示词' },
                      },
                    },
                  ],
                  sync_revision: 1,
                  history_floor_revision: 0,
                  has_more: false,
                }
              : { id: 126, title: '模型状态验证', revision: 1 },
      }),
    )
    await page.goto('/canvas/126')
    await page.locator('.react-flow__node[data-id="image"] .canvas-node-header').click()
    const panel = page.locator('[data-canvas-node-panel]')
    const notice = panel
      .locator('[role="status"], [role="alert"]')
      .filter({ has: page.getByRole('button', { name: '重新加载', exact: true }) })
    await expect(panel.locator('[data-canvas-generate]')).toBeDisabled()
    if (scenario === 'expired-owner') {
      await expect(notice).toContainText('当前会员已到期，请续费或购买其他会员')
      await panel.getByRole('button', { name: '续费 / 购买会员' }).click()
      await expect(page.getByText('会员已到期，请续费后继续使用', { exact: true })).toBeVisible()
      await page.getByRole('dialog', { name: '会员中心' }).getByRole('button', { name: '关闭', exact: true }).click()
    } else if (scenario === 'expired-member') {
      await expect(notice).toContainText('请联系团队所有者续费')
      await expect(panel.getByRole('button', { name: '续费 / 购买会员' })).toHaveCount(0)
    } else if (scenario === 'never-purchased') {
      await expect(notice).toContainText('尚未开通会员')
      await expect(panel.getByRole('button', { name: '查看会员', exact: true })).toBeVisible()
    } else {
      await expect(notice).toContainText(
        scenario === 'configuration-error'
          ? '模型参数配置错误'
          : scenario === 'catalog-error'
            ? '模型目录请求失败'
            : '平台管理员',
      )
      await expect(panel.getByRole('button', { name: /续费|查看会员/ })).toHaveCount(0)
    }
    await page.screenshot({ path: testInfo.outputPath(`${scenario}.png`) })
    const reloadBounds = await panel.getByRole('button', { name: '重新加载', exact: true }).boundingBox()
    expect(reloadBounds).not.toBeNull()
    expect(reloadBounds!.x + reloadBounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    const before = catalogRequests
    const beforeSubscription = subscriptionRequests
    recovered = true
    await panel.getByRole('button', { name: '重新加载', exact: true }).click()
    await expect(panel.getByRole('button', { name: '恢复可用模型', exact: true })).toBeVisible()
    await expect(panel.locator('[data-canvas-generate]')).toBeEnabled()
    expect(catalogRequests).toBeGreaterThan(before)
    if (scenario === 'expired-owner') expect(subscriptionRequests).toBeGreaterThanOrEqual(beforeSubscription)
    expect(errors).toEqual([])
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}

for (const path of ['/smart', '/hot-copy', '/studio']) {
  test(`创作入口展示会员到期并刷新恢复 ${path}`, async ({ page }, testInfo) => {
    const api = await installStrictAuthenticatedApp(page)
    await page.addInitScript(() => {
      localStorage.setItem('zzh_guide_seen_home_u7', '1')
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    let recovered = false
    await page.route('**/api/v1/billing/subscription?**', (route) =>
      route.fulfill({
        json: {
          active: recovered,
          plan_id: 10,
          plan_name: '测试会员',
          expires_at: recovered ? '2099-01-01T00:00:00Z' : '2020-01-01T00:00:00Z',
        },
      }),
    )
    await page.route('**/api/v1/ai/models**', (route) => {
      const operation = new URL(route.request().url()).searchParams.get('operation_code')
      return route.fulfill({
        json: { data: recovered ? [{ id: 43, display_name: '恢复可用模型', operation_codes: [operation] }] : [] },
      })
    })
    await page.goto(path)
    const notice = page.getByRole('status').filter({ hasText: '当前会员已到期' }).first()
    await expect(notice).toBeVisible()
    await expect(notice.getByRole('button', { name: '续费 / 购买会员' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`expired-${path.slice(1)}.png`) })
    recovered = true
    await notice.getByRole('button', { name: /重新加载|刷新权益与模型/ }).click()
    await expect(page.getByRole('status').filter({ hasText: '当前会员已到期' })).toHaveCount(0)
    if (path === '/studio') {
      await expect(page.getByRole('button', { name: '选择生成模型', exact: true })).toContainText('恢复可用模型')
    } else {
      const picker = page.getByRole('button', { name: /^生成模型，/ })
      await picker.click()
      const option = page.getByRole('option', { name: /恢复可用模型/ }).first()
      await expect(option).toBeEnabled()
      await option.click()
      await expect(picker).toContainText('恢复可用模型')
    }
    expect(errors).toEqual([])
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
