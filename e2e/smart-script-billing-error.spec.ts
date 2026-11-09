import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const scenario of ['expired', 'credits'] as const) {
  test(`脚本生成区分会员到期和积分不足：${scenario}`, async ({ page }, testInfo) => {
    await installStrictAuthenticatedApp(page)
    await page.addInitScript(() => localStorage.setItem('zzh_guide_seen_smart_u7', '1'))
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: [
          { id: 801, enabled: true, display_name: '测试脚本模型', operation_codes: ['responses.multimodal'] },
          {
            id: 802,
            enabled: true,
            display_name: '测试视频模型',
            operation_codes: ['video.generate'],
            params_schema: {
              fields: [
                { name: 'duration', type: 'integer', options: [5, 10, 15], default: 5 },
                { name: 'ratio', type: 'string', options: ['16:9'], default: '16:9' },
                { name: 'resolution', type: 'string', options: ['720p'], default: '720p' },
              ],
            },
          },
        ],
      }),
    )
    await page.route('**/api/v1/billing/subscription?**', (route) =>
      route.fulfill({
        json: {
          plan_id: 1,
          active: false,
          current_period_end: '2020-01-01T00:00:00Z',
        },
      }),
    )
    await page.route('**/api/v1/creative/projects**', (route) => {
      if (route.request().method() === 'POST') return route.fulfill({ json: { id: 303, draft_revision: 1 } })
      if (route.request().method() === 'PUT' || route.request().method() === 'PATCH')
        return route.fulfill({ json: { id: 303, draft_revision: 2 } })
      return route.fallback()
    })
    let requests = 0
    await page.route('**/api/v1/ai/responses**', (route) => {
      requests++
      return route.fulfill({
        status: 403,
        json:
          scenario === 'credits'
            ? { code: 10402, message: '余额不足' }
            : { message: '该模型需要付费套餐，请先开通套餐后再试。' },
      })
    })
    await page.goto('/smart')
    await page.getByRole('textbox', { name: '创作需求' }).fill('测试脚本生成')
    await page.getByRole('button', { name: /^生成模型，/ }).click()
    await page.getByRole('option', { name: '测试视频模型' }).click()
    await page.getByRole('slider', { name: '视频时长' }).press('End')
    await expect(page.getByRole('slider', { name: '视频时长' })).toHaveAttribute('aria-valuetext', '15s')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '去制作' }).click()
    const message = scenario === 'credits' ? '积分不足，请充值积分后再试' : '当前会员已到期，请续费或购买其他会员'
    await expect(page.getByText(message, { exact: false })).toBeVisible()
    expect(requests).toBeGreaterThan(0)
    await page.screenshot({ path: testInfo.outputPath(`${scenario}.png`) })
    await page.getByRole('button', { name: '重新生成', exact: true }).click()
    await expect.poll(() => requests).toBeGreaterThan(1)
    await expect(page.getByText(message, { exact: false })).toBeVisible()
  })
}
