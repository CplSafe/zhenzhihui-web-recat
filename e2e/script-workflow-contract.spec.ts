import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('版本5剧本复用附件、校验声明并提交具体付费节点', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          profile: { real_name: '测试', school: '学校', phone: '13800000000' },
          agreement_version: 'v1',
          originality_version: 'originality-v1',
          workflow_synced: true,
        },
      },
    }),
  )
  let body: any = null
  await page.route('**/api/v1/student-applications/90/stages', (route) => {
    body = route.request().postDataJSON()
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.route('**/api/v1/student-applications/90', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 90, state: 'submitted', title: '示例', genre: '悬疑' },
          progress_available: true,
          workflow: {
            status: 1,
            flow_version: 5,
            structured: true,
            current_stage: 'script',
            review_status: body ? 'under_review' : 'awaiting_submission',
            stage: body ? 'waiting_review' : 'script',
            current_task: body
              ? null
              : {
                  task_id: 'script-90',
                  stage: 'script',
                  content: '',
                  data: {
                    title_zh: '示例',
                    genre: '悬疑',
                    planned_episodes: 60,
                    duration_min_seconds: 60,
                    duration_max_seconds: 120,
                    first_paid_episode: 10,
                    act_outline: '大纲',
                    paywall_episodes: [10, 20],
                    attachments: [{ file_id: 9, file_name: '旧稿.txt' }],
                    applicant_phone: '不得跨阶段提交',
                  },
                },
            versions: [],
            reviews: [],
          },
        },
      },
    }),
  )
  await page.goto('/script-ideas/90')
  await expect(page.getByLabel('中文剧名')).toHaveAttribute('readonly', '')
  await expect(page.getByLabel('重点付费 / 追更节点')).toHaveValue('10, 20')
  await page.getByLabel('重点付费 / 追更节点').fill('10,10')
  await page.getByRole('button', { name: '提交剧本' }).click()
  await expect(page.getByText(/请检查标红的剧本内容/)).toBeVisible()
  await page.getByLabel('重点付费 / 追更节点').fill('10,20,35')
  await page.getByRole('button', { name: '提交剧本' }).click()
  await expect(page.getByText('请勾选原创声明后提交。')).toBeVisible()
  await page.getByRole('checkbox', { name: /我确认本剧本为原创/ }).check()
  await page.getByRole('button', { name: '提交剧本' }).click()
  await expect.poll(() => body).not.toBeNull()
  expect(body.task_id).toBe('script-90')
  expect(body.content).toBeUndefined()
  expect(body.data.paywall_episodes).toEqual([10, 20, 35])
  expect(body.data.originality_version).toBe('originality-v1')
  expect(body.data.attachments).toEqual([{ file_id: 9 }])
  expect(body.data.applicant_phone).toBeUndefined()
})

test('服务端要求协议时显示拒绝并保留资料', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) => {
    if (route.request().method() === 'PUT')
      return route.fulfill({ status: 400, json: { code: 400, message: '服务端仍要求同意协议' } })
    return route.fulfill({
      json: {
        code: 0,
        data: { profile: null, agreement_version: 'v1', originality_version: 'o1', workflow_synced: false },
      },
    })
  })
  await page.goto('/script-ideas/join')
  await expect(page.getByRole('button', { name: '一键填入示例' })).toHaveCount(0)
  await page.getByLabel('真实姓名').fill('林知夏')
  await page.getByLabel('学生状态').selectOption({ label: '在校学生' })
  await page.getByLabel('创作身份').selectOption({ label: '自然流创作者' })
  await page.getByLabel('学校全称').fill('测试学校')
  await page.getByLabel('省 / 直辖市').selectOption('山东省')
  await page.getByLabel('城市', { exact: true }).selectOption('济宁市')
  await page.getByLabel('联系手机').fill('13800001111')
  await page.getByLabel('联系邮箱').fill('test@example.com')
  await page.getByLabel(/擅长题材/).fill('悬疑')
  await page.getByLabel(/擅长题材/).press('Enter')
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).check()
  await page.getByRole('button', { name: '提交入驻信息' }).click()
  await expect(page.getByRole('alert')).toContainText('服务端仍要求同意协议')
  await expect(page.getByLabel('真实姓名')).toHaveValue('林知夏')
})

test('真实审核中依据服务端权限撤回并刷新待办', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({ json: { code: 0, data: { profile: null, originality_version: 'o1', workflow_synced: false } } }),
  )
  let withdrawn = false
  await page.route('**/api/v1/student-applications/91/withdraw', (route) => {
    expect(route.request().postDataJSON().task_id).toBe('withdraw-task')
    expect(route.request().headers()['x-idempotency-key']).toBeTruthy()
    withdrawn = true
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.route('**/api/v1/student-applications/91', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 91, state: 'submitted' },
          progress_available: true,
          workflow: {
            status: 1,
            flow_version: 5,
            current_stage: 'card',
            review_status: withdrawn ? 'withdrawn' : 'under_review',
            stage: withdrawn ? 'card' : 'waiting_review',
            can_withdraw: !withdrawn,
            withdraw_task_id: 'withdraw-task',
            current_task: withdrawn ? { task_id: 'card-next', stage: 'card', data: {} } : null,
            versions: [],
            reviews: [],
          },
        },
      },
    }),
  )
  await page.goto('/script-ideas/91')
  await page.getByRole('button', { name: '撤回提交', exact: true }).click()
  await expect(page.getByRole('heading', { name: '已撤回' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '填写一卡' })).toBeVisible()
})

test('列表使用服务端筛选、统计和审核状态', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  let seen = ''
  await page.route('**/api/v1/student-applications?**', (route) => {
    const url = new URL(route.request().url())
    seen = url.search
    return route.fulfill({
      json: {
        code: 0,
        data: {
          items: [
            {
              id: 23,
              state: 'submitted',
              title: '示例剧',
              genre: '悬疑',
              current_stage: 'card',
              review_status: 'needs_changes',
              card_grade: 'A',
            },
          ],
          total: 1,
          stats: { submitted: 8, under_review: 3, needs_changes: 1, approved: 2 },
        },
      },
    })
  })
  await page.goto('/script-ideas/list')
  await expect(page.getByText('示例剧')).toBeVisible()
  await expect(page.getByRole('button', { name: /示例剧/ }).getByText('一卡', { exact: true })).toBeVisible()
  await expect(page.getByText('一卡 · A')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: /示例剧/ }).getByText('一卡', { exact: true })).toBeVisible()
  await expect(page.getByText('一卡 · A')).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(page.locator('.si-list-summary')).toContainText('8')
  await page.getByLabel('全部阶段').selectOption('card')
  await page.getByLabel('全部状态').selectOption('needs_changes')
  await expect(page.getByPlaceholder('输入题材')).toHaveCount(0)
  await expect(page.getByLabel('全部阶段').locator('option')).toHaveText(['全部阶段', '创意', '一卡', '剧本'])
  await expect.poll(() => seen).toContain('stage=card')
  await expect.poll(() => seen).toContain('review_status=needs_changes')
  await expect.poll(() => new URLSearchParams(seen).has('genre')).toBe(false)
  await page.getByRole('button', { name: '重置' }).click()
  await expect(page.getByLabel('全部阶段')).toHaveValue('')
  await expect(page.getByLabel('全部状态')).toHaveValue('')
})

test('创意退回保留结构化字段并复用附件', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({ json: { code: 0, data: { profile: null, originality_version: 'o1', workflow_synced: false } } }),
  )
  let submitted: any = null
  await page.route('**/api/v1/student-applications/92/stages', (route) => {
    submitted = route.request().postDataJSON()
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.route('**/api/v1/student-applications/92', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 92, state: 'submitted' },
          progress_available: true,
          workflow: {
            status: 1,
            flow_version: 5,
            structured: true,
            current_stage: 'creative',
            review_status: submitted ? 'under_review' : 'needs_changes',
            stage: submitted ? 'waiting_review' : 'creative',
            current_task: submitted
              ? null
              : {
                  task_id: 'creative-2',
                  stage: 'creative',
                  data: {
                    applicant_name: '张三',
                    applicant_phone: '13800000000',
                    applicant_school: '学校',
                    title: '故事',
                    genre: '悬疑',
                    synopsis: '旧简介',
                    attachments: [{ file_id: 77, file_name: '故事.txt' }],
                  },
                },
            versions: [],
            reviews: [],
          },
        },
      },
    }),
  )
  await page.goto('/script-ideas/92')
  await expect(page.getByLabel('故事创意')).toHaveValue('旧简介')
  await page.getByLabel('故事创意').fill('新简介')
  await page.getByRole('button', { name: '提交创意' }).click()
  await expect.poll(() => submitted).not.toBeNull()
  expect(submitted.data.synopsis).toBe('新简介')
  expect(submitted.data.attachments).toEqual([{ file_id: 77 }])
  expect(submitted.content).toBeUndefined()
})

test('旧版四阶段终稿必须重新确认声明和版本', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({ json: { code: 0, data: { profile: null, originality_version: 'o-v4', workflow_synced: false } } }),
  )
  let submitted: any = null
  await page.route('**/api/v1/student-applications/93/stages', (route) => {
    submitted = route.request().postDataJSON()
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.route('**/api/v1/student-applications/93', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 93, state: 'submitted' },
          progress_available: true,
          workflow: {
            status: 1,
            flow_version: 4,
            structured: true,
            current_stage: 'final',
            review_status: submitted ? 'under_review' : 'needs_changes',
            stage: submitted ? 'waiting_review' : 'final',
            current_task: submitted
              ? null
              : {
                  task_id: 'final-2',
                  stage: 'final',
                  data: {
                    revision_description: '旧说明',
                    originality_confirmed: true,
                    attachments: [{ file_id: 78, file_name: '终稿.txt' }],
                  },
                },
            versions: [],
            reviews: [],
          },
        },
      },
    }),
  )
  await page.goto('/script-ideas/93')
  const checkbox = page.getByRole('checkbox', { name: /我确认本剧本为原创/ })
  await expect(checkbox).not.toBeChecked()
  await checkbox.check()
  await page.getByRole('button', { name: '提交终稿' }).click()
  await expect.poll(() => submitted).not.toBeNull()
  expect(submitted.stage).toBe('final')
  expect(submitted.data).toEqual({
    revision_description: '旧说明',
    originality_confirmed: true,
    originality_version: 'o-v4',
    attachments: [{ file_id: 78 }],
  })
})

test('一卡评级历史和制剧人分配只读展示', async ({ page }) => {
  await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/script-creators/me', (route) =>
    route.fulfill({ json: { code: 0, data: { profile: null, workflow_synced: false } } }),
  )
  await page.route('**/api/v1/student-applications/94', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 94, state: 'submitted' },
          progress_available: true,
          workflow: {
            status: 2,
            flow_version: 5,
            current_stage: 'script',
            review_status: 'approved',
            stage: 'finished',
            current_task: null,
            card_grade: 'S',
            card_grades: [{ version: 2, grade: 'S', reviewer_name: '审核员', reviewed_at: 1793760200000 }],
            production_assignment: {
              revision: 1,
              producer_name: '制剧人甲',
              director_name: '导演乙',
              assigned_at: 1793760300000,
              remark: '已分配',
            },
            versions: [],
            reviews: [
              { status: 2, stage: 'draft', version: 2, finished_at: 1793760200000 },
              { status: 5, stage: 'draft', version: 1, finished_at: 1793760100000 },
              { status: 2, stage: 'creative', version: 3, finished_at: 1793760000000 },
            ],
          },
        },
      },
    }),
  )
  await page.goto('/script-ideas/94')
  await expect(page.getByRole('heading', { name: '一卡评级与制作安排' })).toHaveCount(0)
  await expect(page.getByText('通过 · 版本 2', { exact: false })).toHaveCount(0)
  await expect(page.getByText('退回 · 版本 1', { exact: false })).toBeVisible()
  await expect(page.getByText('通过 · 版本 3', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: /分配/ })).toHaveCount(0)
})
