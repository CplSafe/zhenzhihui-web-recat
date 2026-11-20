import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`Agent 运行中保留草稿，补充要求与失败后重新发送 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await installStrictAuthenticatedApp(page)
    await page.addInitScript(() => {
      sessionStorage.setItem('dodo-conversation:' + JSON.stringify(['/agent-studio', 'composer-test', 110]), 'working')
    })
    const updates = new Map<string, (status: string, cursor: number) => void>()
    const selection = { image: 29, video: 18, mode: 'manual' }
    await page.routeWebSocket('**/agent-studio/**', (ws) => {
      const id = new URL(ws.url()).pathname.split('/').at(-2) || ''
      updates.set(id, (status, cursor) =>
        ws.send(
          JSON.stringify({
            event: 'snapshot',
            cursor,
            data: {
              id,
              status,
              selection,
              skill_name: 'method-a',
              cursor,
              events: [],
            },
          }),
        ),
      )
    })
    await page.route('**/api/v1/canvases/110**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
          : { id: 110, title: '输入和技能', status: 'active', revision: 1 },
      }),
    )
    const posts: Array<{ path: string; body: Record<string, unknown> }> = []
    let starts = 0
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/agent-studio/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (route.request().method() !== 'GET') {
        if (path.endsWith('/api/attachments')) {
          return route.fulfill({ json: { id: 'episode-file', asset_id: 42, type: 'prompt', characters: 40 } })
        }
        if (path.endsWith('/api/episodes/preview')) {
          return route.fulfill({
            json: {
              fingerprint: 'real-selection-scope',
              episodes: [1, 2, 3].map((number) => ({
                id: `42:${number}`,
                number,
                title: `第${number}集`,
                file_name: 'episodes.txt',
                characters: 40,
              })),
            },
          })
        }
        posts.push({ path, body: route.request().postDataJSON() })
        if (path.endsWith('/api/runs')) {
          return route.fulfill({ json: { id: ['next', 'recovered', 'saved-settings'][starts++] } })
        }
        return route.fulfill({ json: { ok: true } })
      }
      if (path.endsWith('/api/bootstrap')) return route.fulfill({ json: { ready: true } })
      if (path.endsWith('/media-retries')) return route.fulfill({ json: { items: [], candidates: [] } })
      if (path.endsWith('/api/state'))
        return route.fulfill({
          json: {
            connected: true,
            workspace_id: 21,
            session_scope: 'composer-test',
            runs: [{ id: 'working', title: '正在制作', status: 'running' }],
          },
        })
      if (path.endsWith('/api/catalog'))
        return route.fulfill({
          json: {
            models: [
              { id: 29, model: 'Image', operation_codes: ['image.text_to_image'] },
              { id: 18, model: 'Video', operation_codes: ['video.generate'] },
              { id: 19, model: 'Video Alternative', operation_codes: ['video.generate'] },
            ],
            skills: [
              { id: 1, name: 'method-a', description: '剧本分析' },
              { id: 2, name: 'method-b', description: '分镜设计' },
            ],
            planning_model: { id: 52, model: 'GPT', operation_codes: ['agent.chat'] },
          },
        })
      if (path.endsWith('/api/runs/working'))
        return route.fulfill({ json: { id: 'working', status: 'running', selection, cursor: 0, events: [] } })
      if (path.endsWith('/api/runs/next') || path.endsWith('/api/runs/recovered'))
        return route.fulfill({
          json: { id: path.split('/').at(-1), status: 'running', selection, cursor: 0, events: [] },
        })
      if (path.endsWith('/api/runs/saved-settings')) {
        return route.fulfill({ json: { id: 'saved-settings', status: 'complete', selection, cursor: 0, events: [] } })
      }
      return route.abort()
    })
    await page.goto('/canvas/110')
    await page.getByRole('button', { name: '打开 DoDo Agent' }).click()
    const agent = page.getByRole('region', { name: 'DoDo Agent' })
    const input = agent.getByRole('textbox', { name: '创作要求' })
    await expect(agent.getByRole('button', { name: '停止回复' })).toBeVisible()
    await expect.poll(() => updates.has('working')).toBe(true)
    await expect(input).toBeEnabled()
    await input.fill('先分析剧本，再整理分镜，不生成视频。')
    for (const name of ['剧本分析', '分镜设计']) {
      await agent.getByRole('button', { name: 'Skill', exact: true }).click()
      await page.getByRole('button', { name: new RegExp(name) }).click()
    }
    await expect(agent.getByRole('button', { name: '移除 Skill 剧本分析' })).toHaveCount(1)
    await expect(agent.getByRole('button', { name: '移除 Skill 分镜设计' })).toHaveCount(1)
    await agent.getByRole('button', { name: '移除 Skill 剧本分析' }).click()
    await agent.getByRole('button', { name: 'Skill', exact: true }).click()
    await page.getByRole('button', { name: /剧本分析/ }).click()
    await input.press('Enter')
    expect(posts).toEqual([])
    updates.get('working')!('running', 1)
    await expect(input).toHaveValue('先分析剧本，再整理分镜，不生成视频。')
    await agent.getByRole('button', { name: '收起 DoDo Agent' }).click()
    await page.getByRole('button', { name: '打开 DoDo Agent' }).click()
    await expect(input).toHaveValue('先分析剧本，再整理分镜，不生成视频。')
    updates.get('working')!('complete', 2)
    await agent.getByRole('button', { name: '发送创作要求' }).click()
    await agent.getByRole('button', { name: '保持协作并运行' }).click()
    await expect.poll(() => posts.length).toBe(1)
    expect(posts[0]).toMatchObject({
      path: '/agent-studio/api/runs',
      body: {
        message: '先分析剧本，再整理分镜，不生成视频。',
        skills: ['method-b', 'method-a'],
        previous: 'working',
      },
    })
    await expect(input).toHaveValue('')
    await expect(agent.getByRole('button', { name: /^移除 Skill/ })).toHaveCount(0)
    await expect.poll(() => updates.has('next')).toBe(true)
    await input.fill('调整当前工作，只分析第二集。')
    await agent.getByRole('button', { name: '发送补充要求' }).click()
    await expect.poll(() => posts.length).toBe(2)
    expect(posts[1]).toMatchObject({
      path: '/agent-studio/api/runs/next/steer',
      body: { message: '调整当前工作，只分析第二集。', message_id: expect.any(String) },
    })
    await expect(agent.getByText('补充要求已发送。已提交的素材任务仍可能继续完成。')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('agent-steering.png') })
    await input.fill('旧任务停止后，改做新的第三集。')
    await agent.getByRole('button', { name: '停止回复' }).click()
    await expect.poll(() => posts.length).toBe(3)
    expect(posts[2]).toMatchObject({ path: '/agent-studio/api/runs/next/stop' })
    updates.get('next')!('error', 2)
    await expect(input).toHaveValue('旧任务停止后，改做新的第三集。')
    await expect(agent.getByText('新要求将发到新对话。原会话保留在历史记录中。')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('agent-recovery.png') })
    await agent.getByRole('button', { name: '发送到新对话' }).click()
    await agent.getByRole('button', { name: '保持协作并运行' }).click()
    await expect.poll(() => posts.length).toBe(4)
    expect(posts[3]).toMatchObject({
      path: '/agent-studio/api/runs',
      body: { message: '旧任务停止后，改做新的第三集。', previous: null },
    })

    if (width === 1440) {
      await expect.poll(() => updates.has('recovered')).toBe(true)
      updates.get('recovered')!('complete', 2)
      await expect(agent.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled()
      await agent.locator('input[type="file"]').setInputFiles({
        name: 'episodes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('第1集\n开场\n第2集\n对话\n第3集\n结尾'),
      })
      await agent.getByRole('button', { name: /剧本集数与模型/ }).click()
      await agent.getByRole('checkbox', { name: '选择 第1集' }).check()
      await agent.getByRole('checkbox', { name: '选择 第3集' }).check()
      await agent.getByRole('button', { name: '批量设置' }).click()
      await agent.getByRole('combobox', { name: '批量视频模型' }).selectOption('19')
      await page.screenshot({ path: testInfo.outputPath('agent-episode-batch.png') })
      await agent.getByRole('button', { name: '应用到所选集数' }).click()
      await agent.getByRole('button', { name: '保存到对话' }).click()
      await expect.poll(() => posts.length).toBe(5)
      expect(posts[4]).toMatchObject({
        path: '/agent-studio/api/runs',
        body: {
          episode_plan: {
            fingerprint: 'real-selection-scope',
            episodes: [
              { id: '42:1', video: 19 },
              { id: '42:3', video: 19 },
            ],
          },
          previous: 'recovered',
        },
      })
    }
  })
}
