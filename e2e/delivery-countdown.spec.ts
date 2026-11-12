import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`T+1 倒计时、逾期与交付状态 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.setFixedTime(new Date('2026-11-10T07:30:00Z'))
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.addInitScript(() => {
      localStorage.setItem('zzh_guide_seen_smart_u7', '1')
      localStorage.setItem('zzh.manual.tasks.7.21', JSON.stringify([91]))
    })
    let status = 'awaiting_manual'
    await page.route('**/api/v1/ai/tasks/91**', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            id: 91,
            status,
            created_at: '2026-11-10T07:30:00Z',
            prompt: '产品介绍',
            params: { duration: 60, ratio: '9:16' },
            estimated_cost: 123,
            poll_after_ms: 0,
          },
        },
      }),
    )
    await page.goto('/smart?manualTask=91')
    const timer = page.getByRole('timer')
    await expect(timer).toContainText('成片将于24:00之内完成交付')
    await expect(page.getByText('制作需求：产品介绍')).toBeVisible()
    await expect(page.getByText('成片时长：60 秒')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('t1-countdown.png') })
    await page.clock.setFixedTime(new Date('2026-11-11T06:30:01Z'))
    await expect(timer).toContainText('00:59:59')
    await page.reload()
    await expect(timer).toContainText('00:59:59')
    await page.clock.setFixedTime(new Date('2026-11-11T07:31:01Z'))
    await expect(timer).toContainText('已逾期00:01:01')
    await expect(timer).toContainText('制作中，如有疑问请联系客服。')
    status = 'succeeded'
    await page.getByRole('button', { name: '刷新状态' }).click()
    await expect(page.getByRole('heading', { name: '精修成片' })).toBeVisible()
    await expect(timer).toHaveCount(0)
  })

  test(`T+5 倒计时、逾期与交付状态 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.setFixedTime(new Date('2026-11-10T07:30:00Z'))
    await installStrictAuthenticatedApp(page, { preserveStorage: true })
    let status = 'pending'
    await page.route('**/api/v1/promo/config', (route) =>
      route.fulfill({ json: { code: 0, data: { enabled: false, entry_name: '定制宣传片' } } }),
    )
    await page.route('**/api/v1/promo/orders/31', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            order: {
              id: 31,
              task_id: 32,
              workspace_id: 21,
              status,
              billing_status: 'frozen',
              created_at: '2026-11-10T07:30:00Z',
              promised_date: '2026-11-15',
              is_overdue: false,
              first_delivered_at: status === 'delivered' ? '2026-11-15T07:31:01Z' : null,
              can_rework: false,
            },
            materials: [],
          },
        },
      }),
    )
    await page.goto('/promo?order=31')
    const timer = page.getByRole('timer')
    await expect(timer).toContainText('成片将于05天00之内完成交付')
    await page.screenshot({ path: testInfo.outputPath('t5-countdown.png') })
    await page.clock.setFixedTime(new Date('2026-11-14T08:30:00Z'))
    await expect(timer).toContainText('23:00')
    await page.clock.setFixedTime(new Date('2026-11-15T06:30:01Z'))
    await expect(timer).toContainText('00:59:59')
    await page.reload()
    await expect(timer).toContainText('00:59:59')
    await page.clock.setFixedTime(new Date('2026-11-15T07:31:01Z'))
    await expect(timer).toContainText('已逾期00:01:01')
    status = 'delivered'
    await page.getByRole('button', { name: '刷新状态' }).click()
    await expect(page.getByText('成片视频暂不可用')).toBeVisible()
    await expect(timer).toHaveCount(0)
  })
}
