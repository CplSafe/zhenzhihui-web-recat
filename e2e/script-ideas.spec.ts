import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

test('各阶段驳回后可编辑本机草稿，但没有待办时不可重新提交', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  let stage = 'creative'
  let version = 1
  let restored = false
  await page.route('**/api/v1/student-applications/30', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 30, state: 'submitted', creative: '原始创意' },
          progress_available: true,
          workflow: {
            status: restored ? 1 : 3,
            stage: restored ? stage : 'finished',
            current_task: restored ? { task_id: 'new-task', stage, content: '被驳回的正文' } : null,
            versions: [{ version, stage, content: '被驳回的正文', task_id: 'old', submitted_at: 1793760000000 }],
            reviews: [{ status: restored ? 5 : 3, version, reason: '请修改剧情', finished_at: 1793760200000 }],
          },
        },
      },
    }),
  )
  for (const [value, title] of [
    ['creative', '创意'],
    ['draft', '一卡初稿'],
    ['revision', '完善剧本'],
  ]) {
    stage = value
    await page.goto('/script-ideas/30')
    await expect(page.getByRole('heading', { name: `修改被驳回的${title}` })).toBeVisible()
    await expect(page.getByLabel('修改内容')).toHaveValue('被驳回的正文')
    await expect(page.getByRole('button', { name: '重新提交（暂不可用）' })).toBeDisabled()
    await page.getByLabel('修改内容').fill(`修改后的${title}`)
    await page.reload()
    await expect(page.getByLabel('修改内容')).toHaveValue(`修改后的${title}`)
    version++
  }
  await page.screenshot({ path: testInfo.outputPath('rejected-edit.png'), fullPage: true })
  version--
  restored = true
  await page.reload()
  await page.getByRole('button', { name: '使用本机修改内容' }).click()
  await expect(page.getByLabel('正文')).toHaveValue('修改后的完善剧本')
  await expect(page.getByRole('button', { name: '提交完善剧本' })).toBeEnabled()
  expectNoUnexpectedApi(api)
})

test('详情自动更新审核意见并保留未提交正文', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.install()
  const api = await installStrictAuthenticatedApp(page)
  let stage = 'draft'
  let status = 1
  let reason = ''
  let reviewStatus = 2
  await page.route('**/api/v1/student-applications/23', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          application: { id: 23, state: 'submitted', creative: '故事创意' },
          progress_available: true,
          workflow: {
            status,
            stage,
            current_task: stage === 'draft' ? { task_id: 'draft-1', stage: 'draft', content: '' } : null,
            versions: [
              { version: 1, stage: 'creative', content: '故事创意', task_id: '', submitted_at: 1793760000000 },
            ],
            reviews: [{ status: reviewStatus, reason, version: 1, finished_at: 1793760200000 }],
          },
        },
      },
    }),
  )
  await page.goto('/script-ideas/23')
  await expect(page.getByRole('heading', { name: '待提交' })).toBeVisible()
  await page.getByLabel('正文').fill('尚未提交的正文')
  await page.clock.fastForward(15000)
  await expect(page.getByLabel('正文')).toHaveValue('尚未提交的正文')
  status = 3
  stage = 'finished'
  reason = '人物动机需要补充'
  reviewStatus = 3
  await page.clock.fastForward(15000)
  await expect(page.getByRole('heading', { name: '流程未通过' })).toBeVisible()
  await expect(page.locator('.si-status')).toContainText('人物动机需要补充')
  await expect(page.locator('.si-timeline')).toContainText('人物动机需要补充')
  await expect(page.locator('.si-progress [aria-current=step]')).toContainText('提交创意')
  await expect(page.getByLabel('保留的正文')).toHaveValue('尚未提交的正文')
  await page.screenshot({ path: testInfo.outputPath('script-rejected.png'), fullPage: true })
  reason = ''
  await page.clock.fastForward(15000)
  await expect(page.locator('.si-status')).toContainText('未收到审核意见，请联系管理员')
  expectNoUnexpectedApi(api)
})

test('剧本创意从提交到待办和历史，重试保持幂等快照', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page)
  let stage = 'waiting_review'
  let posts = 0
  let creativeBody = ''
  const requests: Array<{ key: string; body: string }> = []
  await page.route('**/api/v1/student-applications**', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname.endsWith('/stages')) {
      requests.push({ key: request.headers()['x-idempotency-key'], body: request.postData() || '' })
      posts++
      if (posts === 1) return route.fulfill({ status: 503, json: { code: 503 } })
      stage = 'waiting_review'
      return route.fulfill({ json: { code: 0, data: { version: 2 } } })
    }
    if (request.method() === 'POST') {
      creativeBody = request.postData() || ''
      return route.fulfill({ status: 201, json: { code: 0, data: { id: 123, state: 'submitted' } } })
    }
    if (url.pathname.endsWith('/123'))
      return route.fulfill({
        json: {
          code: 0,
          data: {
            application: { id: 123, state: 'submitted', creative: '故事构想' },
            progress_available: true,
            workflow: {
              status: 1,
              stage,
              current_task:
                stage === 'draft' || stage === 'revision'
                  ? {
                      task_id: stage === 'draft' ? 'task-1' : 'task-2',
                      stage,
                      content: stage === 'revision' ? '上一稿内容' : '',
                    }
                  : null,
              versions: [
                { version: 1, stage: 'creative', content: '故事构想', task_id: '', submitted_at: 1793760000000 },
              ],
              reviews: [{ status: 2, reason: '通过', version: 1, finished_at: 1793760000000 }],
            },
          },
        },
      })
    return route.fulfill({ json: { code: 0, data: { items: [{ id: 123, state: 'submitted' }], total: 1 } } })
  })
  await page.goto('/script-ideas')
  await expect(page.getByRole('heading', { name: '剧本创意' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('script-home.png'), fullPage: true })
  await page.getByRole('button', { name: '查看入驻' }).click()
  await expect(page.getByRole('heading', { name: '创作者入驻', exact: true }).first()).toBeVisible()
  await expect(page.getByText('创作者档案功能暂不可用')).toBeVisible()
  await expect(page.getByRole('button', { name: '提交入驻信息' })).toBeDisabled()
  await expect(page.getByRole('combobox', { name: '身份类型' })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('script-join.png') })
  await page.goto('/script-ideas/stage/script')
  await expect(page.getByRole('heading', { name: '剧本表单预览' })).toBeVisible()
  await expect(page.getByRole('button', { name: '提交剧本', exact: true })).toBeDisabled()
  await expect(page.getByRole('spinbutton', { name: '预计集数' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '上传文件（暂不可用）' })).toBeDisabled()
  await expect(page.getByRole('link', { name: /完整剧本标准模板/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('script-stage.png') })
  await page.goto('/script-ideas')
  await page.getByRole('button', { name: /新建创意/ }).click()
  await page.getByLabel('姓名').fill('测试学生')
  await page.getByLabel('联系电话').fill('13800000000')
  await page.getByLabel('学校 / 机构').fill('示例大学')
  await page.getByLabel('剧名').fill('血月故事')
  await page.getByLabel('题材').fill('奇幻')
  await page.getByLabel('故事创意').fill('故事构想')
  await page.getByLabel('第一集剧本剧情（选填）').fill('第一集正文')
  await page.getByLabel('人物、身份、性格（选填）').fill('主角：勇敢')
  await expect(page.getByRole('link', { name: /创意提交模板/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('script-form.png'), fullPage: true })
  await page.getByRole('button', { name: '提交创意', exact: true }).click()
  await expect(page).toHaveURL(/script-ideas\/123/)
  expect(JSON.parse(creativeBody).creative).toContain('剧名：血月故事')
  expect(JSON.parse(creativeBody).creative).toContain('题材：奇幻')
  expect(JSON.parse(creativeBody).creative).toContain('第一集正文')
  expect(JSON.parse(creativeBody).creative).toContain('主角：勇敢')
  await expect(page.getByText('审核中 / 后续制作中')).toBeVisible()
  stage = 'draft'
  await page.getByRole('button', { name: '刷新进度' }).click()
  await expect(page.getByRole('heading', { name: '待提交', exact: true })).toBeVisible()
  await expect(page.locator('.si-progress [aria-current=step]')).toContainText('一卡初稿')
  await expect(page.getByText('节点配置暂不可用')).toBeVisible()
  await expect(page.getByLabel('正文')).toHaveValue('')
  expect(requests).toHaveLength(0)
  await page.getByLabel('正文').fill('一卡完整正文')
  await page.getByRole('button', { name: '刷新进度' }).click()
  await expect(page.getByLabel('正文')).toHaveValue('一卡完整正文')
  await page.screenshot({ path: testInfo.outputPath('script-draft.png'), fullPage: true })
  await page.getByRole('button', { name: '提交一卡初稿' }).click()
  await expect(page.getByRole('alert')).toContainText('服务暂不可用')
  await page.getByRole('button', { name: '重试原提交' }).click()
  await expect(page.getByText('审核中 / 后续制作中')).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual(requests[1])
  await expect(page.getByText('版本 1 · 创意')).toBeVisible()
  stage = 'revision'
  await page.getByRole('button', { name: '刷新进度' }).click()
  await expect(page.getByLabel('正文')).toHaveValue('上一稿内容')
  await page.getByLabel('正文').fill('修改后的完整剧本')
  await page.getByRole('button', { name: '提交完善剧本' }).click()
  await expect(page.getByText('审核中 / 后续制作中')).toBeVisible()
  expect(JSON.parse(requests[2].body)).toMatchObject({
    task_id: 'task-2',
    stage: 'revision',
    content: '修改后的完整剧本',
  })
  await page.goto('/script-ideas/list')
  await expect(page.getByText('已提交创意', { exact: true })).toBeVisible()
  await expect(page.getByText('创意申请', { exact: true })).toBeVisible()
  await expect(page.getByLabel('全部状态')).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('script-list.png') })
  expectNoUnexpectedApi(api)
})

test('游客入驻前登录，登录后返回入驻页，直链也受保护', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  let loggedIn = false
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ json: { code: 0, data: null } }))
  await page.route('**/api/v1/banners**', (route) => route.fulfill({ json: { code: 0, data: [] } }))
  await page.route(
    (url) => url.pathname === '/api/v1/auth/session' || url.pathname === '/api/v1/auth/refresh',
    (route) =>
      loggedIn
        ? route.fallback()
        : route.fulfill({
            status: 401,
            json: { code: 10101, code_string: 'UNAUTHORIZED', message: 'session expired' },
          }),
  )
  await page.route('**/api/v1/auth/oauth-start?**', (route) =>
    route.fulfill({ json: { code: 0, data: { client_id: 'browser-test', return_to: '/auth/callback' } } }),
  )
  await page.route('**/deepauth/api/v1/public/auth/login', (route) => {
    loggedIn = true
    return route.fulfill({ json: { code: 0, data: { success: true } } })
  })
  await page.goto('/script-ideas')
  await page.getByRole('button', { name: '查看入驻' }).click()
  await expect(page.getByText('登录后即可使用此功能')).toBeVisible()
  await expect(page.getByRole('heading', { name: '创作者入驻' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('guest-join-login-prompt.png') })
  await page.getByRole('button', { name: '去登录' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('tab', { name: '密码登录' }).click()
  await page.getByRole('textbox', { name: '手机号' }).fill('13800000000')
  await page.getByLabel('密码', { exact: true }).fill('test-password-only')
  await page.getByRole('checkbox', { name: /已经阅读并同意/ }).check()
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/script-ideas\/join$/)
  await expect(page.getByRole('heading', { name: '创作者入驻', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '提交入驻信息' })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('authenticated-join.png') })
  loggedIn = false
  await page.goto('/script-ideas/join')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: '创作者入驻' })).toHaveCount(0)
  expectNoUnexpectedApi(api)
})

test('剧本创意首页在窄屏正常显示', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const api = await installStrictAuthenticatedApp(page)
  await page.goto('/script-ideas')
  await expect(page.getByRole('heading', { name: '剧本创意' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看入驻' })).toBeVisible()
  await expect(page.getByRole('button', { name: '新建创意' })).toBeVisible()
  expect(await page.locator('.home__content').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  )
  await page.screenshot({ path: testInfo.outputPath('script-mobile.png') })
  expectNoUnexpectedApi(api)
})

test('返回按钮遵循浏览历史并支持无历史回首页', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.goto('/script-ideas/stage/script')
  await expect(page.getByRole('heading', { name: '剧本表单预览' })).toBeVisible()
  await page.getByRole('button', { name: '← 返回', exact: true }).click()
  await expect(page).toHaveURL(/\/script-ideas$/)
  await page.getByRole('button', { name: '查看完善剧本' }).click()
  await expect(page.getByRole('heading', { name: '完善剧本表单预览' })).toBeVisible()
  await expect(page.getByText('想对评审说的话')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('stage-back.png') })
  await page.getByRole('button', { name: '← 返回', exact: true }).click()
  await expect(page).toHaveURL(/\/script-ideas$/)
  const sidebar = page.locator('.app-sidebar')
  await expect(sidebar.getByText('我的', { exact: true })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: '我的素材' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: '任务中心' })).toHaveCount(0)
  expectNoUnexpectedApi(api)
})
