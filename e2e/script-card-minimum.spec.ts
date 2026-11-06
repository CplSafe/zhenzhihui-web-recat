import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`一卡覆盖集数至少 8 集 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({ json: { code: 0, data: { profile: null, originality_version: 'o1', workflow_synced: false } } }),
    )
    let submitted: any = null
    await page.route('**/api/v1/student-applications/96/stages', (route) => {
      submitted = route.request().postDataJSON()
      return route.fulfill({ json: { code: 0, data: {} } })
    })
    await page.route('**/api/v1/student-applications/96', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 96, state: 'submitted', title: '示例剧' },
            progress_available: true,
            workflow: {
              status: 1,
              flow_version: 5,
              structured: true,
              current_stage: 'card',
              review_status: submitted ? 'under_review' : 'awaiting_submission',
              stage: submitted ? 'waiting_review' : 'card',
              current_task: submitted
                ? null
                : {
                    task_id: 'card-96',
                    stage: 'card',
                    data: {
                      title_zh: '示例剧',
                      title_en: 'Example',
                      covered_episodes: 1,
                      strongest_paywall_episode: 3,
                      synopsis_zh_full: '剧情',
                      selling_points: '卖点',
                      character_bios: '人物',
                      episode_outline_and_paywalls: '大纲',
                      attachments: [{ file_id: 8, file_name: '一卡.txt' }],
                    },
                  },
              versions: [],
              reviews: [],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas/96')
    const episodes = page.getByLabel('一卡覆盖集数')
    const paywall = page.getByLabel('免费段最强付费卡点')
    await expect(episodes).toHaveValue('1')
    const episodesBox = await episodes.boundingBox()
    const paywallBox = await paywall.boundingBox()
    expect(episodesBox).not.toBeNull()
    expect(paywallBox).not.toBeNull()
    expect(Math.abs(episodesBox!.height - paywallBox!.height)).toBeLessThan(1)
    if (width === 1440) expect(Math.abs(episodesBox!.y - paywallBox!.y)).toBeLessThan(1)
    await expect(episodes).toHaveAttribute('min', '8')
    await expect(page.getByText('至少 8 集')).toBeVisible()
    await episodes.fill('7')
    await page.getByRole('button', { name: '提交一卡' }).click()
    expect(await episodes.evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true)
    expect(submitted).toBeNull()
    await page.screenshot({ path: testInfo.outputPath('minimum-episodes.png') })
    await episodes.fill('8')
    await page.getByRole('button', { name: '提交一卡' }).click()
    await expect.poll(() => submitted).not.toBeNull()
    expect(submitted.data.covered_episodes).toBe(8)
  })
}
