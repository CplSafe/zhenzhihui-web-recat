import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const kind of ['t1', 't5'] as const) {
  test(`${kind} 通知查看详情并打开交付页`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: kind === 't1' ? 1440 : 390, height: 900 })
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => {
      localStorage.setItem('zzh_guide_seen_home_u7', '1')
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
    })
    await page.route('**/api/v1/ai/tasks**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/v1/ai/tasks' && url.searchParams.get('operation_code') === 'video.t1')
        return route.fulfill({
          json: {
            code: 0,
            data: {
              items: [
                {
                  id: 91,
                  operation_code: 'video.t1',
                  status: 'succeeded',
                  created_at: '2026-11-08T09:00:00Z',
                },
                { id: 99, operation_code: 'video.generate', status: 'succeeded' },
              ],
              total: 2,
            },
          },
        })
      if (url.pathname === '/api/v1/ai/tasks/91')
        return route.fulfill({
          json: {
            code: 0,
            data: {
              id: 91,
              operation_code: 'video.t1',
              status: 'succeeded',
              prompt: '精制产品介绍',
              estimated_cost: 123,
              poll_after_ms: 0,
              outputs: [{ type: 'video', asset_id: 888 }],
            },
          },
        })
      return route.fallback()
    })
    await page.route('**/api/v1/assets/888/download-url**', (route) =>
      route.fulfill({ json: { code: 0, data: { download_url: '/tutorials/smart-create.mp4' } } }),
    )
    await page.route('**/api/v1/promo/orders**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/v1/promo/orders')
        return route.fulfill({
          json: {
            code: 0,
            data: {
              items: [
                {
                  id: 31,
                  task_id: 32,
                  workspace_id: 21,
                  company: '测试单位',
                  status: 'delivered',
                  billing_status: 'settled',
                  is_overdue: false,
                  first_delivered_at: '2026-11-08',
                  promised_date: '2026-11-13',
                  created_at: '2026-11-08T08:00:00Z',
                },
                { id: 44, task_id: 45, workspace_id: 22, status: 'delivered' },
              ],
              total: 2,
            },
          },
        })
      if (url.pathname === '/api/v1/promo/orders/31')
        return route.fulfill({
          json: {
            code: 0,
            data: {
              order: {
                id: 31,
                task_id: 32,
                workspace_id: 21,
                company: '测试单位',
                brief: '介绍企业',
                status: 'delivered',
                billing_status: 'settled',
                is_overdue: false,
                first_delivered_at: '2026-11-08',
                promised_date: '2026-11-13',
                can_rework: false,
              },
              materials: [{ id: 5, name: '参考素材.png', status: 'active', role: 'footage' }],
            },
          },
        })
      return route.fallback()
    })
    await page.route('**/api/v1/promo/config', (route) =>
      route.fulfill({ json: { code: 0, data: { enabled: false, entry_name: '定制宣传片' } } }),
    )
    await page.goto('/home')
    await page.getByRole('button', { name: /^通知/ }).click()
    const panel = page.getByRole('dialog', { name: '通知列表' })
    const message = kind === 't1' ? 'T+1 精制任务 已交付' : 'T+5 宣传片订单 已交付'
    await expect(panel.getByRole('button', { name: new RegExp(message.replace('+', '\\+')) })).toBeVisible()
    await expect(panel.getByText(/#44/)).toHaveCount(0)
    await expect(panel.getByText(/#99/)).toHaveCount(0)
    await panel.getByRole('button', { name: new RegExp(message.replace('+', '\\+')) }).click()
    await expect(
      panel.getByRole('heading', { name: kind === 't1' ? 'T+1 精制任务 #91' : 'T+5 宣传片订单 #31' }),
    ).toBeVisible()
    await expect(panel.getByText(kind === 't1' ? '精制产品介绍' : '介绍企业')).toBeVisible()
    if (kind === 't5') await expect(panel.getByText(/参考素材.png/)).toBeVisible()
    await expect(panel.getByRole('button', { name: '查看任务与交付 →' })).toBeInViewport()
    const panelBox = await panel.boundingBox()
    const actionBox = await panel.getByRole('button', { name: '查看任务与交付 →' }).boundingBox()
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height)
    await page.screenshot({ path: testInfo.outputPath(`delivery-notification-${kind}.png`), animations: 'disabled' })
    await panel.getByRole('button', { name: '查看任务与交付 →' }).click()
    await expect(page).toHaveURL(kind === 't1' ? /\/smart\?manualTask=91/ : /\/promo\?order=31/)
    await expect(page.getByText(kind === 't1' ? /任务 #91/ : '宣传片订单 #31')).toBeVisible()
    await page.getByRole('button', { name: '展开任务管理' }).click()
    const drawer = page.getByRole(kind === 't1' ? 'complementary' : 'dialog', { name: '任务管理', exact: true })
    await drawer.getByRole('tab', { name: '爆款成片', exact: true }).click()
    await expect(drawer.getByRole('tab', { name: '精制交付', exact: true })).toHaveCount(0)
    await expect(
      drawer.getByRole('tabpanel', { name: '爆款成片任务' }).getByRole('button', { name: /任务 #91/ }),
    ).toBeVisible()
    await expect(
      drawer
        .getByRole('tabpanel', { name: '爆款成片任务' })
        .getByRole('button', { name: /任务 #91/ })
        .locator('video'),
    ).toHaveAttribute('src', '/tutorials/smart-create.mp4')
    await expect
      .poll(() =>
        drawer
          .getByRole('tabpanel', { name: '爆款成片任务' })
          .getByRole('button', { name: /任务 #91/ })
          .locator('video')
          .evaluate((video) => (video as HTMLVideoElement).readyState),
      )
      .toBeGreaterThanOrEqual(2)
    if (kind === 't5') await drawer.getByRole('tab', { name: '宣传片', exact: true }).click()
    const taskList = drawer.getByRole('tabpanel', { name: kind === 't1' ? '爆款成片任务' : '宣传片任务' })
    await expect(taskList.getByRole('button', { name: kind === 't1' ? /任务 #91/ : /测试单位/ })).toBeVisible()
    if (kind === 't1')
      await expect(taskList.getByRole('button', { name: /任务 #91/ }).locator('video')).toHaveAttribute(
        'src',
        '/tutorials/smart-create.mp4',
      )
    await page.screenshot({ path: testInfo.outputPath(`delivery-task-list-${kind}.png`), animations: 'disabled' })
  })
}
