import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`阅读临时协议并提交入驻资料 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    let submitted: any = null
    await page.route('**/api/v1/script-creators/me', (route) => {
      if (route.request().method() === 'PUT') {
        submitted = route.request().postDataJSON()
        return route.fulfill({
          json: {
            code: 0,
            data: { profile: submitted, agreement_version: 'v1', originality_version: 'o1', workflow_synced: true },
          },
        })
      }
      return route.fulfill({
        json: {
          code: 0,
          data: {
            profile: {
              real_name: '林知夏',
              identity_type: 'student',
              school: '测试学校',
              phone: '13800001111',
              email: 'test@example.com',
              specialties: ['悬疑'],
            },
            agreement_version: 'v1',
            originality_version: 'o1',
            workflow_synced: true,
          },
        },
      })
    })
    await page.goto('/script-ideas/join')
    await expect(page.getByLabel('真实姓名')).toHaveValue('林知夏')
    await expect(page.getByLabel('创作者入驻协议内容')).toContainText('临时版')
    await expect(page.getByRole('checkbox', { name: /我已阅读并同意/ })).not.toBeChecked()
    await page.getByLabel('真实姓名').fill('林知秋')
    await page.screenshot({ path: testInfo.outputPath(`join-${width}.png`), fullPage: true })
    await page.getByRole('checkbox', { name: /我已阅读并同意/ }).check()
    await page.getByRole('button', { name: '保存修改' }).click()
    await expect(page.getByRole('heading', { name: '资料已保存' })).toBeVisible()
    expect(submitted.real_name).toBe('林知秋')
    expect(submitted.agreement_accepted).toBe(true)
    expect(submitted.agreement_version).toBe('v1')
    expectNoUnexpectedApi(api)
  })
}
