import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`创作者学生状态与学校信息 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    let stored: Record<string, unknown> | null = {
      real_name: '测试用户',
      identity_type: 'student',
      school: '原学校',
      grade_major: '大三',
      city: '山东 · 济宁',
      phone: '13800001111',
      email: 'test@example.com',
      specialties: ['悬疑'],
    }
    let requests = 0
    await page.route('**/api/v1/script-creators/me', (route) => {
      if (route.request().method() === 'PUT') {
        requests += 1
        stored = route.request().postDataJSON()
      }
      return route.fulfill({
        json: {
          code: 0,
          data: {
            profile: stored,
            agreement_version: 'v1',
            originality_version: 'o1',
            workflow_synced: true,
          },
        },
      })
    })
    await page.goto('/script-ideas/join')
    await expect(page.getByText('原所在地：山东 · 济宁。请重新选择省市。')).toBeVisible()
    await expect(page.getByText('先选学生状态，再选创作身份；在校与毕业后填写内容不同。')).toHaveCount(0)
    await expect(page.getByText('用于创作者城市分布统计。')).toHaveCount(0)
    await expect(page.getByLabel('学生状态')).toHaveValue('在校学生')
    await expect(page.getByLabel('创作身份')).toHaveValue('')
    await expect(page.getByLabel('学校全称')).toHaveValue('原学校')
    await expect(page.getByLabel('学校全称')).toHaveAttribute('required', '')
    await expect(page.getByLabel('年级 / 专业（选填）')).toHaveValue('大三')
    await page.getByLabel('学生状态').click()
    await page.screenshot({ path: testInfo.outputPath(`student-select-open-${width}.png`) })
    await page.keyboard.press('Escape')
    const genreInput = page.getByLabel('擅长题材（可多选）')
    await genreInput.fill('CEO')
    await genreInput.press('ArrowDown')
    await expect(page.getByRole('button', { name: 'CEO豪门' })).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath(`genre-options-${width}.png`) })
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: '移除题材 CEO豪门' })).toBeVisible()
    await page.getByRole('button', { name: '移除题材 CEO豪门' }).click()
    await genreInput.focus()
    await expect(genreInput).toHaveAttribute('aria-expanded', 'true')
    await genreInput.press('Escape')
    await expect(genreInput).toHaveAttribute('aria-expanded', 'false')
    await page.getByLabel('创作身份').selectOption('团队编剧')
    await page.getByLabel('学生状态').selectOption('已毕业')
    await expect(page.getByLabel('机构 / 公司（选填）')).toHaveValue('')
    await expect(page.getByLabel('机构 / 公司（选填）')).not.toHaveAttribute('required', '')
    await expect(page.getByLabel('年级 / 专业（选填）')).toHaveCount(0)
    await expect(page.getByText('个人创作者可填「个人创作者」')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`graduated-${width}.png`), fullPage: true })
    await page.getByLabel('学生状态').selectOption('在校学生')
    await expect(page.getByLabel('学校全称')).toHaveValue('')
    await expect(page.getByLabel('年级 / 专业（选填）')).toHaveValue('')
    await page.getByLabel('学校全称').fill('测试学校')
    await page.getByRole('checkbox', { name: /我已阅读并同意/ }).check()
    await page.getByLabel('省 / 直辖市').selectOption('山东省')
    await page.getByRole('button', { name: '保存修改' }).click()
    expect(requests).toBe(0)
    expect(
      await page.getByLabel('城市', { exact: true }).evaluate((el: HTMLSelectElement) => el.validity.valueMissing),
    ).toBe(true)
    await page.getByLabel('城市', { exact: true }).selectOption('济宁市')
    await page.getByLabel('省 / 直辖市').selectOption('北京市')
    await expect(page.getByLabel('城市', { exact: true })).toHaveValue('')
    await page.getByLabel('省 / 直辖市').selectOption('台湾省')
    await page.getByLabel('城市', { exact: true }).selectOption('台北市')
    await page.getByLabel('省 / 直辖市').selectOption('香港特别行政区')
    await expect(page.getByLabel('城市', { exact: true })).toHaveValue('')
    await page.getByLabel('城市', { exact: true }).selectOption('香港特别行政区')
    await page.getByLabel('省 / 直辖市').selectOption('新疆维吾尔自治区')
    await page.getByLabel('城市', { exact: true }).selectOption('石河子市')
    await page.getByLabel('省 / 直辖市').selectOption('山东省')
    await page.getByLabel('城市', { exact: true }).selectOption('济宁市')
    await page.getByLabel('年级 / 专业（选填）').fill('大二')
    await page.screenshot({ path: testInfo.outputPath(`student-${width}.png`), fullPage: true })
    await page.getByRole('checkbox', { name: /我已阅读并同意/ }).check()
    await page.getByRole('button', { name: '保存修改' }).click()
    await expect(page.getByRole('heading', { name: '资料已保存' })).toBeVisible()
    expect(stored).toMatchObject({
      identity_type: 'student',
      student_status: 'student',
      creator_type: 'team',
      school: '测试学校',
      grade_major: '大二',
      province: '山东省',
      city: '济宁市',
    })
    expect(requests).toBe(1)
    await page.goto('/script-ideas/join')
    await expect(page.getByLabel('学生状态')).toHaveValue('在校学生')
    await expect(page.getByLabel('创作身份')).toHaveValue('团队编剧')
    await expect(page.getByLabel('学校全称')).toHaveValue('测试学校')
    await expect(page.getByLabel('省 / 直辖市')).toHaveValue('山东省')
    await expect(page.getByLabel('城市', { exact: true })).toHaveValue('济宁市')
    await page.getByLabel('学生状态').selectOption('已毕业')
    await page.getByRole('checkbox', { name: /我已阅读并同意/ }).check()
    await page.getByRole('button', { name: '保存修改' }).click()
    await expect(page.getByRole('heading', { name: '资料已保存' })).toBeVisible()
    expect(stored).toMatchObject({
      identity_type: 'team',
      student_status: 'graduated',
      creator_type: 'team',
      school: '',
      grade_major: '',
    })
    await page.goto('/script-ideas/join')
    await expect(page.getByLabel('学生状态')).toHaveValue('已毕业')
    await expect(page.getByLabel('机构 / 公司（选填）')).toHaveValue('')
    expectNoUnexpectedApi(api)
  })
}
