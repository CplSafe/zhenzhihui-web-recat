import { expect, test } from '@playwright/test'
import {
  HOT_COPY_PROJECT_ID,
  PROJECT_VIDEO_ID,
  SMART_PROJECT_ID,
  WORKSPACE_ID,
  expectNoUnexpectedApi,
  expectScopedRequest,
  installStrictAuthenticatedApp,
  waitForScopedApiResponse,
} from './fixtures/strict-authenticated-app'

test.describe('已认证关键路由与读取链路', () => {
  test('模板库读取在线模板', async ({ page }) => {
    const api = await installStrictAuthenticatedApp(page)

    await page.goto('/templates')

    await expect(page.getByRole('heading', { name: '模板库' })).toBeVisible()
    await expect(page.getByText('在线模板', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /E2E 在线模板/ })).toBeVisible()
    expectScopedRequest(api, { method: 'GET', path: '/api/v1/templates' })
    expectNoUnexpectedApi(api)
  })

  test('项目管理只读取当前团队空间项目', async ({ page }) => {
    // WebKit 并发冷启动时可能在默认 10s 边界后才完成路由 chunk 解析；
    // 继续校验真实标题和当前 workspace 项目，只放宽跨浏览器时间预算。
    test.slow()
    const api = await installStrictAuthenticatedApp(page)

    await page.goto('/projects')

    await expect(page.getByRole('heading', { name: '项目管理' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /E2E 智能项目/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /E2E 爆款项目/ }).first()).toBeVisible()
    expectScopedRequest(api, {
      method: 'GET',
      path: '/api/v1/creative/projects',
      workspaceId: WORKSPACE_ID,
    })
    expectNoUnexpectedApi(api)
  })

  test('项目视频列表与详情保持同一 project/workspace 作用域', async ({ page }) => {
    const api = await installStrictAuthenticatedApp(page)

    const listProjectReady = waitForScopedApiResponse(page, {
      method: 'GET',
      path: `/api/v1/creative/projects/${SMART_PROJECT_ID}`,
      workspaceId: WORKSPACE_ID,
      projectId: SMART_PROJECT_ID,
    })
    await page.goto(`/projects/${SMART_PROJECT_ID}/videos`)
    await listProjectReady
    await expect(page.getByText(/E2E 智能项目（\d+个视频）/)).toBeVisible()
    await expect(page.getByRole('button', { name: '查看视频：E2E 成片视频' })).toBeVisible()
    expectScopedRequest(api, {
      method: 'GET',
      path: `/api/v1/creative/projects/${SMART_PROJECT_ID}`,
      workspaceId: WORKSPACE_ID,
      projectId: SMART_PROJECT_ID,
    })

    const detailProjectReady = waitForScopedApiResponse(page, {
      method: 'GET',
      path: `/api/v1/creative/projects/${SMART_PROJECT_ID}`,
      workspaceId: WORKSPACE_ID,
      projectId: SMART_PROJECT_ID,
    })
    await page.goto(`/projects/${SMART_PROJECT_ID}/videos/${PROJECT_VIDEO_ID}`)
    await detailProjectReady
    await expect(page.getByText('E2E 成片视频', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('视频状态', { exact: true })).toBeVisible()
    expectScopedRequest(api, {
      method: 'GET',
      path: `/api/v1/creative/projects/${SMART_PROJECT_ID}`,
      workspaceId: WORKSPACE_ID,
      projectId: SMART_PROJECT_ID,
    })
    expectNoUnexpectedApi(api)
  })

  test('素材管理按当前 workspace 分页读取并展示素材', async ({ page }) => {
    const api = await installStrictAuthenticatedApp(page)

    const assetsReady = waitForScopedApiResponse(page, {
      method: 'GET',
      path: '/api/v1/assets',
      workspaceId: WORKSPACE_ID,
    })
    const projectsReady = waitForScopedApiResponse(page, {
      method: 'GET',
      path: '/api/v1/creative/projects',
      workspaceId: WORKSPACE_ID,
    })
    await page.goto('/resources')
    await Promise.all([assetsReady, projectsReady])

    await expect(page.getByRole('region', { name: '我的素材' })).toBeVisible()
    await expect(page.getByRole('button', { name: '预览E2E 素材图片' })).toBeVisible()
    expectScopedRequest(api, { method: 'GET', path: '/api/v1/assets', workspaceId: WORKSPACE_ID })
    expectScopedRequest(api, {
      method: 'GET',
      path: '/api/v1/creative/projects',
      workspaceId: WORKSPACE_ID,
    })
    expectNoUnexpectedApi(api)
  })

  test('团队数据看板读取当前团队统计', async ({ page }) => {
    // The dashboard includes charting/date libraries in a separate lazy chunk;
    // WebKit parallel cold-start can finish authentication before that chunk.
    test.slow()
    const api = await installStrictAuthenticatedApp(page)

    await page.goto('/team')

    await expect(page.getByRole('heading', { name: '数据统计' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('总生成视频数', { exact: true }).first()).toBeVisible()
    await expect(page.getByLabel('成员贡献排行榜').getByText('E2E 用户', { exact: true })).toBeVisible()
    expectScopedRequest(api, {
      method: 'GET',
      path: `/api/v1/workspaces/${WORKSPACE_ID}/overview`,
    })
    expectScopedRequest(api, {
      method: 'GET',
      path: '/api/v1/creative/projects',
      workspaceId: WORKSPACE_ID,
    })
    expectNoUnexpectedApi(api)
  })

  test('智能成片项目刷新恢复且不重复提交付费任务', async ({ page }) => {
    // WebKit parallel cold-start must parse the largest lazy editor chunk twice
    // (initial load + reload). Keep the assertion tied to real restored content,
    // but give that lazy boundary a realistic cross-browser budget.
    test.slow()
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/models**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 9801, enabled: true, display_name: 'E2E 脚本模型', operation_codes: ['responses.multimodal'] },
          { id: 9802, enabled: true, display_name: 'E2E 文生图模型', operation_codes: ['image.text_to_image'] },
          { id: 9803, enabled: true, display_name: 'E2E 图生图模型', operation_codes: ['image.image_to_image'] },
          { id: 9804, enabled: true, display_name: 'E2E 视频模型', operation_codes: ['video.generate'] },
          { id: 9805, enabled: true, display_name: 'E2E 视频修改模型', operation_codes: ['video.edit'] },
        ]),
      })
    })

    await page.goto('/smart')
    await expect(page.getByRole('button', { name: /^生成模型，/ })).toBeVisible({ timeout: 30_000 })
    await page.goto(`/smart/${SMART_PROJECT_ID}`)
    await expect(page.getByText('刷新后应恢复的智能成片描述', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('E2E 恢复分镜画面', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^生成模型，/ })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '本次创作使用的模型' })).toHaveCount(0)
    expectScopedRequest(api, {
      method: 'GET',
      path: `/api/v1/creative/projects/${SMART_PROJECT_ID}`,
      workspaceId: WORKSPACE_ID,
      projectId: SMART_PROJECT_ID,
    })

    await page.reload()

    await expect(page.getByText('刷新后应恢复的智能成片描述', { exact: true })).toBeVisible()
    await expect(page.getByText('E2E 恢复分镜画面', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^生成模型，/ })).toHaveCount(0)
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })

  test('制作图片可批量生成、大图预览、下载并多选结果制作视频', async ({ page }) => {
    // WebKit 冷启动大型智能成片 chunk 较慢；本用例还串行覆盖 3 次生成、下载、图生图和跨入口交接。
    test.slow()
    const api = await installStrictAuthenticatedApp(page)
    let projectCreations = 0
    let projectRevision = 0
    let draftConflicts = 0
    const acceptedDraftRevisions: number[] = []
    // 新建项目在真实后端以占位标题返回，随后才由当前页面安全回写 AI 标题。
    // 使用真实初态，避免把测试夹具预置的“正式标题”误判成另一标签页改名。
    let projectTitle = '未命名项目'
    let projectDraft: Record<string, unknown> = {
      flow: 'smart',
      smart: {
        started: true,
        requirement: '生成一张青绿色夏日饮品海报',
        entryMeta: { mode: 'image', ratio: '16:9', images: [], imageAssetIds: [] },
        projectId: 303,
        imageMessages: [],
      },
    }
    const imageTaskBodies: Record<string, unknown>[] = []
    await page.route('**/api/v1/ai/models**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 9901,
            enabled: true,
            provider: 'openai',
            model: 'gpt-image-2',
            display_name: 'E2E 文生图模型',
            operation_codes: ['image.text_to_image'],
          },
          {
            id: 9902,
            enabled: true,
            provider: 'openai',
            model: 'gpt-image-2-edit',
            display_name: 'E2E 图生图模型',
            operation_codes: ['image.image_to_image'],
          },
        ]),
      })
    })
    await page.route('**/api/v1/creative/projects?*', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback()
        return
      }
      projectCreations += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 303, title: projectTitle, draft_revision: projectRevision }),
      })
    })
    await page.route('**/api/v1/creative/projects/303**', async (route) => {
      const request = route.request()
      const method = request.method()
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 303,
            title: projectTitle,
            draft_revision: projectRevision,
            draft_json: projectDraft,
          }),
        })
        return
      }

      const body = (request.postDataJSON() || {}) as Record<string, unknown>
      if (method === 'PATCH') {
        projectTitle = String(body.title || body.name || projectTitle)
        projectRevision += 1
      } else if (method === 'PUT' && request.url().includes('/draft')) {
        const expectedRevision = Number(body.draft_revision)
        if (Number.isFinite(expectedRevision) && expectedRevision !== projectRevision) {
          draftConflicts += 1
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ code: 409, message: 'draft revision conflict' }),
          })
          return
        }
        const nextDraft = typeof body.draft === 'string' ? JSON.parse(body.draft) : body.draft
        if (nextDraft && typeof nextDraft === 'object') projectDraft = nextDraft as Record<string, unknown>
        acceptedDraftRevisions.push(expectedRevision)
        projectRevision += 1
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 303,
          title: projectTitle,
          draft_revision: projectRevision,
          draft_json: projectDraft,
        }),
      })
    })
    await page.route('**/api/v1/ai/tasks', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback()
        return
      }
      const taskBody = route.request().postDataJSON() as Record<string, unknown>
      imageTaskBodies.push(taskBody)
      const taskIndex = imageTaskBodies.length - 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 9902 + taskIndex,
          status: 'succeeded',
          operation_code: String(taskBody.operation_code || ''),
          outputs: [{ asset_id: 703 + taskIndex }],
        }),
      })
    })
    await page.route('**/api/v1/assets/*/download**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      })
    })
    await page.route('**/api/v1/ai/responses', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ output_text: '夏日饮品海报' }),
      })
    })
    // 强制走 fetch + blob + a[download] 的浏览器下载链路，
    // 避免 Chromium 的 File System Access API 在无头测试中弹出不可控的文件选择器。
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: undefined,
      })
    })

    await page.goto('/smart')
    await page.getByRole('tab', { name: '制作图片' }).click()
    const entryModelTrigger = page.getByRole('button', { name: '生成模型，0/1 已选择' })
    await expect(entryModelTrigger).toBeVisible()
    await entryModelTrigger.click()
    await page.getByRole('combobox', { name: '文生图模型' }).selectOption('9901')
    await page.getByRole('button', { name: '关闭模型选择' }).click()
    await page.getByRole('button', { name: '生成图片数量' }).click()
    await page.getByRole('option', { name: '3张' }).click()
    const input = page.getByRole('textbox', { name: '创作需求' })
    await input.fill('生成一张青绿色夏日饮品海报')
    await page.getByRole('button', { name: '去制作' }).click()

    const confirm = page.getByRole('alertdialog', { name: '确认生成图片' })
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('生成 3 张图片')
    await expect(confirm).toContainText('预计共消耗 300 积分')
    expect(
      api.seen.filter(
        (request) =>
          request.method === 'POST' &&
          (request.path === '/api/v1/creative/projects' || request.path === '/api/v1/ai/tasks'),
      ),
    ).toHaveLength(0)

    await confirm.getByRole('button', { name: '取消' }).click()
    await expect(confirm).toBeHidden()
    await expect(input).toHaveValue('生成一张青绿色夏日饮品海报')
    await expect(page).toHaveURL(/\/smart$/)

    await page.getByRole('button', { name: '去制作' }).click()
    await page.getByRole('alertdialog', { name: '确认生成图片' }).getByRole('button', { name: '确认并生成' }).click()
    await expect(page).toHaveURL(/\/smart\/303$/)
    await expect(page.getByRole('button', { name: /^生成模型，/ })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '本次创作使用的模型' })).toHaveCount(0)
    // 串行队列完成前，每个子消息里的首图都会暂时使用“AI 生成图片 1”作为 alt。
    // 先等待真实结果总数，再用第 3 张的唯一选择按钮等待批次合并。
    const generatedImages = page.locator('img[alt^="AI 生成图片 "]')
    await expect(generatedImages).toHaveCount(3)
    for (let index = 0; index < 3; index += 1) await expect(generatedImages.nth(index)).toBeVisible()
    expect(projectCreations).toBe(1)
    expect(imageTaskBodies).toHaveLength(3)
    expect(imageTaskBodies[0]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      operation_code: 'image.text_to_image',
      model_version_id: 9901,
    })
    expect(imageTaskBodies.map((body) => String(body.idempotency_key || ''))).toEqual([
      expect.stringMatching(/^smart_image_.+_01_/),
      expect.stringMatching(/^smart_image_.+_02_/),
      expect.stringMatching(/^smart_image_.+_03_/),
    ])

    const selectThirdForVideo = page.getByRole('button', { name: '选择图片 3 用于制作视频' })
    await expect(selectThirdForVideo).toBeVisible()

    await page.getByRole('button', { name: '预览图片 2' }).click()
    const previewDialog = page.getByRole('dialog', { name: '图片预览' })
    await expect(previewDialog).toBeVisible()
    await expect(previewDialog.getByRole('img', { name: 'AI 生成图片 2大图预览' })).toBeVisible()
    await previewDialog.getByRole('button', { name: '关闭图片预览' }).click()
    await expect(previewDialog).toBeHidden()

    const downloadStarted = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载图片 2' }).click()
    const download = await downloadStarted
    expect(download.suggestedFilename()).toMatch(/\.png$/i)
    expect(await download.failure()).toBeNull()
    expect(await download.path()).toBeTruthy()

    await page.getByRole('button', { name: '修改图片 2' }).click()
    const imageComposer = page.getByRole('textbox', { name: '图片创作描述' })
    await imageComposer.fill('把背景改为海边')
    await page.getByRole('button', { name: '生成图片数量' }).click()
    await page.getByRole('option', { name: '1张' }).click()
    await page.getByRole('button', { name: '生成', exact: true }).click()
    const editConfirm = page.getByRole('alertdialog', { name: '确认生成图片' })
    await expect(editConfirm).toContainText('参考图创作将生成 1 张图片')
    await editConfirm.getByRole('button', { name: '确认并生成' }).click()
    await expect(generatedImages).toHaveCount(4)
    await expect.poll(() => imageTaskBodies.length).toBe(4)
    expect(imageTaskBodies[3]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      operation_code: 'image.image_to_image',
      model_version_id: 9902,
      prompt: '把背景改为海边',
      input_assets: [{ asset_id: 704, role: 'reference_image' }],
    })

    const continueToVideo = page.getByRole('button', { name: '做视频', exact: true })
    await expect(continueToVideo).toBeDisabled()
    await page.getByRole('button', { name: '选择图片 1 用于制作视频' }).click()
    await selectThirdForVideo.click()
    await expect(page.getByText('已选 2 张，最多 9 张', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '取消选择图片 1 用于制作视频' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByRole('button', { name: '取消选择图片 3 用于制作视频' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(continueToVideo).toBeEnabled()
    await continueToVideo.click()
    await expect(page).toHaveURL(/\/smart$/)
    await expect(page.getByRole('tab', { name: '制作视频' })).toHaveAttribute('aria-selected', 'true')
    const carriedImageRemovals = page.getByRole('button', { name: '移除', exact: true })
    await expect(carriedImageRemovals).toHaveCount(2)
    await expect(carriedImageRemovals.nth(0).locator('xpath=preceding-sibling::img[1]')).toHaveAttribute(
      'src',
      /\/api\/v1\/assets\/703\/download/,
    )
    await expect(carriedImageRemovals.nth(1).locator('xpath=preceding-sibling::img[1]')).toHaveAttribute(
      'src',
      /\/api\/v1\/assets\/705\/download/,
    )
    await expect(page.locator('img[src*="/api/v1/assets/704/download"]')).toHaveCount(0)
    await expect(page.locator('img[src*="/api/v1/assets/706/download"]')).toHaveCount(0)
    expect(projectCreations).toBe(1)
    expect(imageTaskBodies).toHaveLength(4)
    expect(draftConflicts).toBe(0)
    expect(acceptedDraftRevisions.length).toBeGreaterThan(0)
    expect(acceptedDraftRevisions).toEqual([...acceptedDraftRevisions].sort((left, right) => left - right))
    expectNoUnexpectedApi(api)
  })

  test('爆款复制项目按 URL 项目恢复且不新建或重复提交付费任务', async ({ page }) => {
    // This route owns another large lazy editor chunk. WebKit can finish the
    // project shell well before the editor chunk under parallel cold-start.
    test.slow()
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/models**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 9701,
            enabled: true,
            display_name: 'E2E 爆款复制模型',
            operation_codes: ['video.replicate'],
          },
        ]),
      })
    })

    await page.goto('/hot-copy')
    await expect(page.getByRole('button', { name: /^生成模型，/ })).toBeVisible({ timeout: 30_000 })
    await page.goto(`/hot-copy/${HOT_COPY_PROJECT_ID}`)

    const resumeGeneration = page.getByRole('button', { name: '返回下一步' })
    await expect(resumeGeneration).toBeVisible({ timeout: 30_000 })
    await resumeGeneration.click()
    await expect(page.getByText('/E2E 爆款项目', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^生成模型，/ })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '本次创作使用的模型' })).toHaveCount(0)
    expectScopedRequest(api, {
      method: 'GET',
      path: `/api/v1/creative/projects/${HOT_COPY_PROJECT_ID}`,
      workspaceId: WORKSPACE_ID,
      projectId: HOT_COPY_PROJECT_ID,
    })
    expect(
      api.seen.filter((request) => request.method === 'POST' && request.path === '/api/v1/creative/projects'),
    ).toHaveLength(0)
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
})
