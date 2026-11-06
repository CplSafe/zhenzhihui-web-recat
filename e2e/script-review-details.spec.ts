import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'
import { formatCardContent } from '../src/utils/scriptCardContent'

for (const width of [1440, 390]) {
  test(`完善剧本填写与审核 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({
        json: { code: 0, data: { profile: null, originality_version: 'test-v1', workflow_synced: false } },
      }),
    )
    let submitted = ''
    await page.route('**/api/v1/student-applications/46/stages', async (route) => {
      const body = route.request().postDataJSON()
      expect(body.stage).toBe('revision')
      submitted = body.content
      await route.fulfill({ json: { code: 0, data: {} } })
    })
    await page.route('**/api/v1/student-applications/46', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 46, state: 'submitted', creative: '剧名：测试剧\n\n题材：悬疑\n\n故事' },
            progress_available: true,
            workflow: {
              status: 1,
              stage: submitted ? 'waiting_review' : 'revision',
              current_task: submitted ? null : { task_id: 'revision-1', stage: 'revision', content: '完整剧本正文' },
              versions: submitted
                ? [{ version: 3, stage: 'revision', task_id: 'revision-1', content: submitted, submitted_at: 3 }]
                : [],
              reviews: [{ status: 2, stage: 'script', version: 2, reason: '请完善第九集的情节。', finished_at: 2 }],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas/46')
    await expect(page.getByText('请完善第九集的情节。').first()).toBeVisible()
    await expect(page.getByLabel('剧本正文', { exact: false })).toHaveValue('完整剧本正文')
    await page.getByLabel('本次修改说明', { exact: false }).fill('已补充第九集剧情')
    await page.getByLabel('我确认本剧本为原创，并同意平台用于后续制作评估').check()
    await page.screenshot({ path: testInfo.outputPath(`revision-form-${width}.png`) })
    await page.getByRole('button', { name: '提交终稿' }).click()
    await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
    await expect(page.locator('.si-readonly')).toContainText('已补充第九集剧情')
    await expect(page.locator('.si-readonly')).toContainText('已确认')
    await expect(page.locator('.si-readonly')).toContainText('完整剧本正文')
    await page.reload()
    await expect(page.locator('.si-readonly')).toContainText('已补充第九集剧情')
    await page.screenshot({ path: testInfo.outputPath(`revision-review-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expectNoUnexpectedApi(api)
  })
}

for (const width of [1440, 390]) {
  test(`剧本字段和继承正文 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({
        json: { code: 0, data: { profile: null, originality_version: 'test-v1', workflow_synced: false } },
      }),
    )
    let stage = 'revision'
    let approved = false
    const card = formatCardContent({ 中文剧名: '测试剧', 英文剧名: 'Test', 核心卖点: '故事冲突' })
    let submitted = ''
    await page.route('**/api/v1/student-applications/45/stages', async (route) => {
      submitted = route.request().postDataJSON().content
      await route.fulfill({ json: { code: 0, data: {} } })
    })
    await page.route('**/api/v1/student-applications/45', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 45, state: 'submitted', creative: '剧名：测试剧\n\n题材：悬疑\n\n故事' },
            progress_available: true,
            workflow: {
              status: 1,
              stage: approved ? 'revision' : submitted ? 'waiting_review' : stage,
              current_task: approved
                ? { task_id: 'revision-1', stage: 'revision', content: submitted }
                : submitted
                  ? null
                  : { task_id: 'task-1', stage, content: card },
              versions: submitted
                ? [{ version: 2, stage: 'script', task_id: 'task-1', content: submitted, submitted_at: 2 }]
                : [],
              reviews: approved ? [{ status: 2, stage: 'script', version: 2, finished_at: 3 }] : [],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas/45')
    await expect(page.getByLabel('正文', { exact: false }).first()).toHaveValue(/中文剧名：测试剧/)
    await expect(page.getByLabel('正文', { exact: false }).first()).not.toHaveValue(/结构化正文/)
    stage = 'script'
    await page.reload()
    await expect(page.getByRole('heading', { name: '填写剧本' })).toBeVisible()
    for (const [label, value] of [
      ['预计集数', '55'],
      ['单集最短时长', '65'],
      ['单集最长时长', '72'],
      ['首个付费解锁集', '10'],
      ['分幕大纲', '第一幕'],
    ])
      await page.getByLabel(label, { exact: false }).fill(value)
    await page.screenshot({ path: testInfo.outputPath(`script-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '提交剧本' }).click()
    await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
    await expect(page.locator('.si-readonly')).toContainText('第一幕')
    approved = true
    await page.reload()
    await expect(page.getByRole('heading', { name: '本阶段已通过' })).toBeVisible()
    await expect(page.locator('.si-readonly')).toContainText('第一幕')
    await page.screenshot({ path: testInfo.outputPath(`script-approved-${width}.png`) })
    await page.getByRole('button', { name: '继续完善剧本 →' }).click()
    await expect(page.getByRole('heading', { name: '填写完善剧本' })).toBeVisible()
    await expect(page.getByLabel('正文', { exact: false }).first()).toHaveValue(/分幕大纲：第一幕/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expectNoUnexpectedApi(api)
  })
}

for (const width of [1440, 390]) {
  test(`一卡填写和审核 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({
        json: { code: 0, data: { profile: null, originality_version: 'test-v1', workflow_synced: false } },
      }),
    )
    let submitted = ''
    let approved = false
    await page.route('**/api/v1/student-applications/44/stages', async (route) => {
      submitted = route.request().postDataJSON().content
      await route.fulfill({ json: { code: 0, data: {} } })
    })
    await page.route('**/api/v1/student-applications/44', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 44, state: 'submitted', creative: '剧名：测试剧\n\n题材：悬疑\n\n故事' },
            progress_available: true,
            workflow: {
              status: 1,
              stage: approved ? 'revision' : submitted ? 'waiting_review' : 'draft',
              current_task: approved
                ? { task_id: 'revision-1', stage: 'revision' }
                : submitted
                  ? null
                  : { task_id: 'draft-1', stage: 'draft' },
              versions: submitted
                ? [{ version: 2, stage: 'draft', task_id: 'draft-1', content: submitted, submitted_at: 10 }]
                : [],
              reviews: approved ? [{ status: 2, stage: 'draft', version: 2, finished_at: 11 }] : [],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas/44')
    await expect(page.getByRole('heading', { name: '填写一卡' })).toBeVisible()
    await expect(page.locator('.si-progress .is-done').first()).toContainText('提交创意')
    await expect(page.locator('.si-progress .is-done b').first()).toHaveAttribute('aria-label', '已通过')
    await page.screenshot({ path: testInfo.outputPath(`card-progress-${width}.png`) })
    for (const [label, value] of [
      ['英文剧名', 'Test title'],
      ['一卡覆盖集数', '55'],
      ['免费段最强付费卡点', '9'],
      ['中文完整版剧情简介', '一卡剧情'],
      ['核心卖点', '核心冲突'],
      ['人物小传', '主角'],
      ['分集大纲与付费卡点', '大纲'],
    ])
      await page.getByLabel(label, { exact: false }).fill(value)
    await page.screenshot({ path: testInfo.outputPath(`card-form-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '提交一卡' }).click()
    await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
    await expect(page.locator('.si-readonly')).toContainText('一卡剧情')
    await expect(page.locator('.si-readonly')).toContainText('Test title')
    await page.screenshot({ path: testInfo.outputPath(`card-review-${width}.png`), fullPage: true })
    approved = true
    await page.reload()
    await expect(page.getByRole('heading', { name: '本阶段已通过' })).toBeVisible()
    await expect(page.locator('.si-readonly')).toContainText('一卡剧情')
    await expect(page.locator('.si-progress [aria-current=step]')).toContainText('一卡')
    await expect(page.locator('.si-progress .is-done')).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath(`card-approved-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '去填写「剧本」 →' }).click()
    await expect(page.getByRole('heading', { name: '填写完善剧本' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expectNoUnexpectedApi(api)
  })
}

for (const width of [1440, 390]) {
  test(`创意通过后进入一卡 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({
        json: { code: 0, data: { profile: null, originality_version: 'test-v1', workflow_synced: false } },
      }),
    )
    const creative = '剧名：血月禁域\n\n题材：悬疑\n\n故事简介'
    await page.route('**/api/v1/student-applications/43', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 43, state: 'submitted', name: '林知夏', school: '测试学校', creative },
            progress_available: true,
            workflow: {
              status: 1,
              stage: 'draft',
              current_task: { task_id: 'draft-1', stage: 'draft', content: '' },
              versions: [
                {
                  version: 1,
                  stage: 'creative',
                  content: creative,
                  task_id: 'creative-1',
                  submitted_at: 1793840000000,
                },
              ],
              reviews: [
                { status: 2, version: 1, finished_at: 1793840000001 },
                { status: 5, stage: 'draft', version: 2, finished_at: 1793840000000 },
                { status: 2, stage: 'script', version: 3, finished_at: 1793839999999 },
                { status: 2, version: 99, finished_at: 1793839999998 },
              ],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas/43')
    await expect(page.getByRole('heading', { name: '本阶段已通过' })).toBeVisible()
    const reviewHistory = page.locator('.si-timeline')
    await expect(reviewHistory).toContainText('通过 · 版本 1 · 创意')
    await expect(reviewHistory).toContainText('退回 · 版本 2 · 一卡')
    await expect(reviewHistory).toContainText('通过 · 版本 3 · 剧本')
    await expect(reviewHistory).toContainText('通过 · 版本 99')
    await expect(page.locator('.si-progress [aria-current=step]')).toContainText('提交创意')
    await expect(page.locator('.si-readonly')).toContainText('血月禁域')
    await expect(page.getByRole('heading', { name: '填写一卡' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`approved-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '去填写「一卡」 →' }).click()
    await expect(page.getByRole('heading', { name: '填写一卡' })).toBeVisible()
    await expect(page.locator('.si-progress [aria-current=step]')).toContainText('一卡')
    expectNoUnexpectedApi(api)
  })
}

for (const width of [1440, 390]) {
  test(`提交创意审核详情按字段展示 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/script-creators/me', (route) =>
      route.fulfill({
        json: { code: 0, data: { profile: null, originality_version: 'test-v1', workflow_synced: false } },
      }),
    )
    const original =
      '剧名：血月禁域\n\n题材：悬疑\n\n一段剧情简介\n包含第二行\n\n第一集剧本剧情：\n场景一\n\n人物、身份、性格：\n小林'
    await page.route('**/api/v1/student-applications/41', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 41, state: 'submitted', name: '林知夏', school: '测试学校', creative: original },
            progress_available: true,
            workflow: {
              status: 1,
              stage: 'waiting_review',
              current_task: null,
              versions: [
                {
                  version: 1,
                  stage: 'creative',
                  content: original,
                  task_id: 'creative-1',
                  submitted_at: 1793840000000,
                },
              ],
              reviews: [],
            },
          },
        },
      }),
    )
    await page.goto('/script-ideas/41')
    await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
    await expect(page.getByRole('button', { name: '撤回提交' })).toHaveCount(0)
    await expect(page.locator('.si-progress [aria-current=step]')).toContainText('提交创意 · 当前')
    await expect(page.getByRole('heading', { name: '审批记录' })).toBeVisible()
    const order = await page.locator('.si-content h2').allTextContents()
    expect(order.indexOf('审批记录')).toBeLessThan(order.indexOf('历史版本'))
    const details = page.locator('.si-readonly')
    for (const text of [
      '林知夏',
      '测试学校',
      '血月禁域',
      '悬疑',
      '一段剧情简介',
      '场景一',
      '小林',
      '当前申请未提供附件信息',
    ])
      await expect(details).toContainText(text)
    await page.screenshot({ path: testInfo.outputPath(`progress-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByText('查看提交的完整原文').click()
    await expect(details).toContainText(original)
    await expect(page.locator('.si-progress [aria-current=step]')).toContainText('提交创意')
    await expect(page.locator('.si-progress')).not.toContainText('当前阶段信息不足')
    await expect(page.locator('.si-progress')).not.toContainText('入驻')
    await expect(page.getByText('这一步要交什么')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`review-${width}.png`), fullPage: true })
    expectNoUnexpectedApi(api)
  })
}

for (const width of [1440, 390]) {
  test(`本机演示提交后显示审核字段 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
    await page.goto('/script-ideas/stage/demo')
    await page.getByLabel('申请人').fill('测试申请人')
    await page.getByLabel('学校').fill('测试学校')
    await page.getByLabel('剧名').fill('测试剧')
    await page.getByLabel('题材').fill('悬疑')
    await page.getByLabel('剧情简介').fill('故事简介')
    await page.getByLabel('第一集剧本剧情').fill('第一场')
    await page.getByLabel('人物、身份、性格').fill('主角小林')
    await page
      .getByLabel('剧本文档附件')
      .setInputFiles({ name: '剧本.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('demo') })
    await page.getByRole('button', { name: '提交创意', exact: true }).click()
    await expect(page.getByRole('heading', { name: '审核中' })).toBeVisible()
    await expect(page.locator('.si-readonly')).toContainText('剧本.docx')
    await expect(page.locator('.si-readonly')).toContainText('第一场')
    await expect(page.locator('.si-timeline')).toContainText('模拟审核中')
    await expect(page.locator('.si-timeline')).toContainText('提交了「提交创意」资料')
    await page.screenshot({ path: testInfo.outputPath(`demo-review-${width}.png`), fullPage: true })
    expectNoUnexpectedApi(api)
  })
}

test('审核中依最新版本识别阶段，待办优先且信息不足时不猜测', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({
      json: { code: 0, data: { profile: null, originality_version: 'test-v1', workflow_synced: false } },
    }),
  )
  let versions = [
    { version: 3, stage: 'draft', content: '一卡', task_id: 'draft-3', submitted_at: 3 },
    { version: 1, stage: 'creative', content: '创意', task_id: 'idea-1', submitted_at: 1 },
  ]
  let task: { task_id: string; stage: string; content: string } | null = null
  let progressAvailable = true
  await page.route('**/api/v1/student-applications/42', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 42, state: 'submitted', creative: '创意' },
          progress_available: progressAvailable,
          workflow: { status: 1, stage: 'waiting_review', current_task: task, versions, reviews: [] },
        },
      },
    }),
  )
  await page.goto('/script-ideas/42')
  await expect(page.locator('.si-progress [aria-current=step]')).toContainText('一卡')
  versions = [{ version: 4, stage: 'revision', content: '终稿', task_id: 'revision-4', submitted_at: 4 }]
  await page.reload()
  await expect(page.locator('.si-progress [aria-current=step]')).toContainText('剧本')
  await expect(page.locator('.si-progress [aria-current=step]')).not.toContainText('完善剧本 · 当前')
  await expect(page.locator('.si-progress > div')).toHaveCount(3)
  task = { task_id: 'current-draft', stage: 'draft', content: '' }
  await page.reload()
  await expect(page.locator('.si-progress [aria-current=step]')).toContainText('一卡')
  task = null
  versions = []
  await page.reload()
  await expect(page.locator('.si-progress [aria-current=step]')).toHaveCount(0)
  await expect(page.locator('.si-progress .is-done')).toHaveCount(0)
  await expect(page.getByText('当前阶段信息不足，请以审核记录和待办为准。')).toBeVisible()
  progressAvailable = false
  versions = [{ version: 1, stage: 'creative', content: '创意', task_id: 'idea-1', submitted_at: 1 }]
  await page.reload()
  await expect(page.getByRole('heading', { name: '进度暂不可用' })).toBeVisible()
  await expect(page.locator('.si-progress [aria-current=step]')).toHaveCount(0)
  expectNoUnexpectedApi(api)
})
