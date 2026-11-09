import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`查看入驻协议并提交入驻资料 ${width}px`, async ({ page }, testInfo) => {
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
              student_status: 'student',
              creator_type: 'creator',
              province: '山东省',
              city: '济宁市',
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
    await expect(page.getByText('账号级动作，只需一次，不计入「我的创意」。')).toHaveCount(0)
    await expect(page.getByText('资料提交后保存到服务端')).toHaveCount(0)
    await expect(page.getByText('填写一次创作者资料，之后可随时修改。')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '关于信息同步' })).toBeVisible()
    await expect(page.getByText('创作者入驻协议（临时版）')).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: /我已阅读并同意/ })).not.toBeChecked()
    await page.getByLabel('真实姓名').fill('林知秋')
    const popupPromise = page.waitForEvent('popup')
    await page.getByRole('link', { name: '《创作者入驻协议》' }).click()
    const agreementPage = await popupPromise
    await agreementPage.setViewportSize({ width, height: 900 })
    await expect(agreementPage.getByRole('heading', { name: '创作者入驻协议' })).toBeVisible()
    await expect(agreementPage.getByText('第六条　权利归属')).toBeVisible()
    await expect(agreementPage.getByText('所在城市为省·市两级必填', { exact: false })).toBeAttached()
    await expect(agreementPage.getByText('5. 使用边界：', { exact: false })).toBeAttached()
    await expect(agreementPage.getByText('所在城市为选填', { exact: false })).toHaveCount(0)
    await expect(page.getByLabel('真实姓名')).toHaveValue('林知秋')
    await expect(page.getByRole('checkbox', { name: /我已阅读并同意/ })).not.toBeChecked()
    await agreementPage.screenshot({ path: testInfo.outputPath(`agreement-${width}.png`) })
    await agreementPage.close()
    await page.screenshot({ path: testInfo.outputPath(`join-${width}.png`), fullPage: true })
    await page.getByRole('checkbox', { name: /我已阅读并同意/ }).check()
    await page.getByRole('button', { name: '保存修改' }).click()
    await expect(page.getByRole('heading', { name: '资料已保存' })).toBeVisible()
    await expect(page.getByRole('button', { name: '修改入驻信息' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '去提交第一个创意' })).toBeVisible()
    const success = page.locator('.si-join-success')
    const bounds = (await success.boundingBox())!
    if (width === 1440) expect(bounds.width).toBeGreaterThan(690)
    expect(await page.locator('.home__content').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`join-success-${width}.png`), fullPage: true })
    expect(submitted.real_name).toBe('林知秋')
    expect(submitted.agreement_accepted).toBe(true)
    expect(submitted.agreement_version).toBe('v1')
    expectNoUnexpectedApi(api)
  })
}
