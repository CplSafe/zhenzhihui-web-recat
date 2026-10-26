import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const target of ['current', 'new'] as const) {
  test(`到期团队套餐用途明确：${target}`, async ({ page, context }, testInfo) => {
    const api = await installStrictAuthenticatedApp(page)
    await page.addInitScript(() => {
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
      localStorage.setItem('zzh_guide_seen_home_u7', '1')
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await context.route('https://pay.example.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>模拟支付页，不执行真实支付</p>' }),
    )
    await page.route('**/api/v1/billing/subscription?**', (route) => route.fulfill({ json: { active: false } }))
    await page.route('**/api/v1/billing/wallet?**', (route) =>
      route.fulfill({ json: { available: 1234, balance: 1234, frozen: 0 } }),
    )
    await page.route('**/api/v1/billing/plans', (route) =>
      route.fulfill({
        json: [
          {
            id: 91,
            code: 'team-monthly',
            name: '团队月度会员',
            plan_type: 'team',
            period: 'month',
            price_cents: 9900,
            base_credits: 5000,
            status: 'active',
          },
        ],
      }),
    )
    await page.route('**/api/v1/billing/credit-packages', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/billing/payment-orders?**', (route) =>
      route.fulfill({ json: { items: [{ id: 801, workspace_id: WORKSPACE_ID, status: 'pending' }] } }),
    )
    await page.route('**/api/v1/billing/payment-orders/801/reconcile?**', (route) =>
      route.fulfill({ json: { status: 'pending' } }),
    )
    const orders: Array<Record<string, unknown>> = []
    await page.route('**/api/v1/billing/subscription-orders', (route) => {
      orders.push(route.request().postDataJSON())
      return route.fulfill({
        json: {
          order: { id: 801, workspace_id: target === 'current' ? WORKSPACE_ID : 99 },
          pay_url: 'https://pay.example.test/team-membership',
        },
      })
    })
    await page.goto('/home')
    await page.getByRole('button', { name: '会员中心', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '会员中心', exact: true })
    await expect(dialog).toContainText('当前积分余额:1,234')
    await dialog.getByRole('button', { name: '续费当前团队', exact: true }).click()
    await expect(dialog.getByRole('note')).toContainText('右侧操作仅用于当前团队')
    await page.screenshot({ path: testInfo.outputPath(`team-${target}-desktop.png`) })
    await page.setViewportSize({ width: 760, height: 800 })
    await expect(dialog.getByRole('note')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`team-${target}-narrow.png`) })
    const popup = page.waitForEvent('popup')
    const card = dialog.locator('.mc-card').filter({ hasText: '团队版/团队月度会员' })
    await card
      .getByRole('button', {
        name: target === 'current' ? '订阅团队月度会员' : '创建团队',
        exact: true,
      })
      .click()
    const payment = await popup
    await expect(payment).toHaveURL('https://pay.example.test/team-membership')
    expect(orders).toHaveLength(1)
    if (target === 'current') {
      expect(orders[0]).toMatchObject({ intent: 'subscribe', workspace_id: WORKSPACE_ID, plan_id: 91 })
      expect(orders[0]).not.toHaveProperty('new_workspace_name')
    } else {
      expect(orders[0]).toMatchObject({ intent: 'new_team', plan_id: 91 })
      expect(orders[0]).not.toHaveProperty('workspace_id')
      expect(orders[0].new_workspace_name).toBeTruthy()
    }
    await expect(dialog).toContainText('当前积分余额:1,234')
    await payment.close()
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(page.getByRole('button', { name: 'E2E 用户', exact: false })).toBeVisible()
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}

for (const kind of ['personal', 'team'] as const) {
  test(`会员等级操作：${kind}`, async ({ page }, testInfo) => {
    const workspaceId = kind === 'team' ? WORKSPACE_ID : 1
    const api = await installStrictAuthenticatedApp(page, { activeWorkspaceId: workspaceId })
    await page.addInitScript(() => {
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
      localStorage.setItem('zzh_guide_seen_home_u7', '1')
    })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const plans = [
      { id: 91, name: '当前月度会员', tier_rank: 2, period: 'month', price_cents: 1 },
      { id: 92, name: '低等级会员', tier_rank: 1, period: 'month', price_cents: 99999 },
      { id: 93, name: '高等级会员', tier_rank: 3, period: 'month', price_cents: 2 },
      { id: 94, name: '同等级年度会员', tier_rank: 2, period: 'year', price_cents: 9999 },
      { id: 95, name: '其他套餐', tier_rank: null, period: 'month', price_cents: 100 },
    ].map((p) => ({ ...p, code: `plan-${p.id}`, plan_type: kind, base_credits: 1000, status: 'active' }))
    await page.route('**/api/v1/billing/plans', (route) => route.fulfill({ json: plans }))
    await page.route('**/api/v1/billing/subscription?**', (route) =>
      route.fulfill({
        json: {
          active: true,
          plan_id: 91,
          plan_type: kind,
          plan_name: '当前月度会员',
          current_period_end: '2099-01-01T00:00:00Z',
          renew_mode: 'manual',
        },
      }),
    )
    await page.route('**/api/v1/billing/credit-packages', (route) => route.fulfill({ json: [] }))
    const orders: Array<Record<string, unknown>> = []
    await page.route('**/api/v1/billing/subscription-orders', (route) => {
      orders.push(route.request().postDataJSON())
      return route.fulfill({ status: 409, json: { message: '升级暂未开放，请稍后重试' } })
    })
    await page.goto('/home')
    await page.locator('[data-guide="topbar-member"]').click()
    const dialog = page.getByRole('dialog', { name: '会员中心', exact: true })
    if (kind === 'team') await dialog.getByRole('button', { name: '团队版', exact: true }).click()
    await expect(dialog.getByText('手动续费', { exact: true })).toHaveCount(0)
    if (kind === 'team') await expect(dialog.getByRole('button', { name: '续费当前团队', exact: true })).toHaveCount(0)
    const card = (name: string) => dialog.locator('.mc-card').filter({ hasText: name })
    await expect(card('当前月度会员').getByRole('button', { name: /^续费.+/, exact: true })).toBeEnabled()
    await expect(card('低等级会员').getByRole('button', { name: '不可降级', exact: true })).toBeDisabled()
    await expect(card('高等级会员').getByRole('button', { name: '升级至高等级会员', exact: true })).toBeEnabled()
    await expect(card('同等级年度会员').getByRole('button', { name: '订阅同等级年度会员', exact: true })).toBeEnabled()
    if (kind === 'team') {
      await expect(card('低等级会员').getByRole('button', { name: '创建团队', exact: true })).toBeEnabled()
    } else await expect(dialog.getByRole('button', { name: '创建团队', exact: true })).toHaveCount(0)
    await expect(card('其他套餐').getByRole('button', { name: '订阅其他套餐', exact: true })).toBeEnabled()
    await expect(card('其他套餐').locator('.mc-card-action-reason')).toHaveCount(0)
    await expect(dialog.getByText(/无法确认升降级|套餐等级信息缺失/)).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`${kind}-levels-desktop.png`), fullPage: true })
    await page.setViewportSize({ width: 760, height: 800 })
    await page.screenshot({ path: testInfo.outputPath(`${kind}-levels-narrow.png`), fullPage: true })
    await card('其他套餐').getByRole('button', { name: '订阅其他套餐', exact: true }).click()
    await expect(page.getByText('升级暂未开放，请稍后重试', { exact: true })).toBeVisible()
    expect(orders).toEqual([expect.objectContaining({ intent: 'upgrade', workspace_id: workspaceId, plan_id: 95 })])
    await card('高等级会员').getByRole('button', { name: '升级至高等级会员', exact: true }).click()
    await expect(page.getByText('升级暂未开放，请稍后重试', { exact: true })).toBeVisible()
    expect(orders).toEqual([
      expect.objectContaining({ intent: 'upgrade', workspace_id: workspaceId, plan_id: 95 }),
      expect.objectContaining({ intent: 'upgrade', workspace_id: workspaceId, plan_id: 93 }),
    ])
    if (kind === 'team') {
      await card('低等级会员').getByRole('button', { name: '创建团队', exact: true }).click()
      await expect.poll(() => orders.length).toBe(3)
      expect(orders[2]).toMatchObject({ intent: 'new_team', plan_id: 92 })
      expect(orders[2]).not.toHaveProperty('workspace_id')
    }
    await expect(card('当前月度会员').getByRole('button', { name: /^续费.+/, exact: true })).toBeEnabled()
    expect(errors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}

for (const role of ['admin', 'member'] as const) {
  test(`团队充值权限：${role}`, async ({ page, context }, testInfo) => {
    const api = await installStrictAuthenticatedApp(page)
    await page.addInitScript(() => {
      localStorage.setItem('zzh_guide_seen_home_u7', '1')
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
    })
    const workspace = { id: WORKSPACE_ID, type: 'team', name: '管理员充值团队', owner_user_id: 99, status: 'active' }
    await page.route('**/api/v1/auth/session', (route) =>
      route.fulfill({ json: { workspace, workspaces: [workspace], expires_in: 3600 } }),
    )
    await page.route('**/api/v1/workspaces', (route) => route.fulfill({ json: [workspace] }))
    await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/members`, (route) =>
      route.fulfill({ json: [{ user_id: 7, workspace_id: WORKSPACE_ID, workspace_role: role }] }),
    )
    await page.route('**/api/v1/billing/subscription?**', (route) =>
      route.fulfill({
        json: { active: true, id: 80, plan_id: 91, plan_type: 'team', plan_name: '团队月度会员', renew_mode: 'auto' },
      }),
    )
    await page.route('**/api/v1/billing/plans', (route) =>
      route.fulfill({
        json: [
          {
            id: 91,
            name: '团队月度会员',
            plan_type: 'team',
            period: 'month',
            price_cents: 9900,
            base_credits: 1000,
            status: 'active',
          },
        ],
      }),
    )
    await page.route('**/api/v1/billing/credit-packages', (route) =>
      route.fulfill({ json: [{ id: 8, name: '团队积分包', amount_cents: 100, credits: 100 }] }),
    )
    await context.route('https://pay.example.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '模拟支付' }),
    )
    const orders: Array<Record<string, unknown>> = []
    await page.route('**/api/v1/billing/recharge-orders', (route) => {
      orders.push(route.request().postDataJSON())
      return route.fulfill({ json: { order: { id: 901 }, pay_url: 'https://pay.example.test/admin-recharge' } })
    })
    await page.goto('/home')
    await page.locator('[data-guide="topbar-member"]').click()
    const dialog = page.getByRole('dialog', { name: '会员中心', exact: true })
    await dialog.getByRole('button', { name: '团队版', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '取消订阅', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '关闭自动续费', exact: true })).toHaveCount(0)
    if (role === 'admin') {
      await expect(dialog.getByRole('button', { name: /^续费.+/, exact: true })).toBeEnabled()
      await dialog.getByRole('button', { name: '积分充值', exact: true }).click()
      await expect(dialog.getByText('充值到团队「管理员充值团队」')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('admin-recharge.png') })
      await dialog.getByRole('button', { name: '立即充值', exact: true }).click()
      const popup = page.waitForEvent('popup')
      await page.getByRole('button', { name: '确认', exact: true }).click()
      const payment = await popup
      await expect(payment).toHaveURL('https://pay.example.test/admin-recharge')
      expect(orders).toEqual([expect.objectContaining({ workspace_id: WORKSPACE_ID, credit_package_id: 8 })])
      await payment.close()
    } else {
      await expect(dialog.getByRole('button', { name: '仅团主或管理员', exact: true })).toBeDisabled()
      await expect(dialog.getByRole('button', { name: '积分充值', exact: true })).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath('member-no-recharge.png') })
      expect(orders).toEqual([])
    }
    expectNoUnexpectedApi(api)
  })
}
